// §3.4 payment state machine, table-tested (T-005). Every row: (status, input) → (next status, event types).
import { describe, expect, it } from "vitest";
import { decide, InvalidTransition, isSettled, newPayment, type Payment, type PaymentInput } from "./payment.ts";

const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const OTHER = "CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU";
const SENDER = "GCU33SW2MEG4HA2IVAVDLOJ3UF7QDYGXSZTBRKSRQYQ7BI7VJOMFSDJ7";
const REFUND_TO = "GCBWUAIIB6UXWOGJWQDF5MP3DSVXBTOYD5V3A754Q3ON7CGGRUWXVX5S";
const Q = 22_851_852n; // R$ 12.34 at 5.4

const fresh = (over: Partial<Parameters<typeof newPayment>[0]> = {}): Payment =>
  newPayment({
    id: "pay_1",
    muxId: "42",
    quote: {
      asset: USDC,
      assetAmount7: Q,
      valueCents: 1234,
      feeCents: 0,
      rateMicros: 5_400_000n,
      expiresAt: "2026-10-22T12:02:00.000Z",
    },
    ...over,
  });

const deposit = (over: Partial<Extract<PaymentInput, { type: "deposit.observed" }>> = {}): PaymentInput => ({
  type: "deposit.observed",
  depositId: "pier-evt-1",
  asset: USDC,
  amount7: Q,
  from: SENDER,
  ledgerClosedAt: "2026-10-22T12:01:00.000Z",
  txHash: "a".repeat(64),
  ...over,
});
const succeeded: PaymentInput = {
  type: "payout.succeeded",
  transactionId: "hodle_tx_1",
  endToEndId: "SANDBOX123",
  txHash: "0xabc",
  debit6: 2_285_185n,
};

/** Applies inputs in order and returns the final payment plus the event types of the last step. */
function run(start: Payment, ...inputs: PaymentInput[]) {
  let p = start;
  let types: string[] = [];
  let events: ReturnType<typeof decide>["events"] = [];
  for (const i of inputs) {
    const r = decide(p, i);
    p = r.payment;
    events = r.events;
    types = r.events.map((e) => e.type);
  }
  return { p, types, events };
}

const funded = () => run(fresh(), deposit()).p;
const paying = () => run(funded(), { type: "payout.started" }).p;
const completed = () => run(paying(), succeeded).p;

describe("deposits while awaiting", () => {
  it.each([
    ["exact", deposit(), "funded", ["DepositMatched", "PayoutRequested"]],
    ["over", deposit({ amount7: Q + 5n }), "funded", ["DepositMatched", "PayoutRequested", "RefundRequested"]],
    ["under", deposit({ amount7: Q - 1n }), "refunding", ["DepositMatched", "RefundRequested"]],
    [
      "late",
      deposit({ ledgerClosedAt: "2026-10-22T12:02:00.001Z" }),
      "refunding",
      ["DepositMatched", "RefundRequested"],
    ],
    ["wrong asset", deposit({ asset: OTHER }), "refunding", ["DepositMatched", "RefundRequested"]],
  ] as const)("%s → %s", (_, input, status, types) => {
    const r = run(fresh(), input);
    expect(r.p.status).toBe(status);
    expect(r.types).toEqual(types);
  });

  it("labels each deposit with its kind", () => {
    const kind = (input: PaymentInput) => run(fresh(), input).events[0]?.payload as { kind: string };
    expect(kind(deposit()).kind).toBe("exact");
    expect(kind(deposit({ amount7: Q + 5n })).kind).toBe("over");
    expect(kind(deposit({ amount7: Q - 1n })).kind).toBe("under");
    expect(kind(deposit({ ledgerClosedAt: "2026-10-22T13:00:00.000Z" })).kind).toBe("late");
    expect(kind(deposit({ asset: OTHER })).kind).toBe("wrong_asset");
  });

  it("accepts a deposit closed exactly at expiry (INV-11)", () => {
    expect(run(fresh(), deposit({ ledgerClosedAt: "2026-10-22T12:02:00.000Z" })).p.status).toBe("funded");
  });

  it("refunds only the excess of an overpayment", () => {
    const r = run(fresh(), deposit({ amount7: Q + 5n }));
    expect(r.p.refunds).toEqual([expect.objectContaining({ amount7: 5n, reason: "over", status: "requested" })]);
  });

  it("refunds to refundTo when given, else to the sender (INV-10)", () => {
    expect(run(fresh(), deposit({ amount7: 1n })).p.refunds[0]?.to).toBe(SENDER);
    expect(run(fresh({ refundTo: REFUND_TO }), deposit({ amount7: 1n })).p.refunds[0]?.to).toBe(REFUND_TO);
  });

  it("ignores a duplicate observation of the same deposit (INV-04)", () => {
    const once = run(fresh(), deposit()).p;
    const twice = decide(once, deposit());
    expect(twice.events).toEqual([]);
    expect(twice.payment).toBe(once);
  });
});

describe("payout", () => {
  it.each([
    ["funded + payout.started → paying", funded, { type: "payout.started" } as PaymentInput, "paying", []],
    ["paying + succeeded → completed", paying, succeeded, "completed", ["PayoutCompleted", "PaymentCompleted"]],
    [
      "funded + succeeded (start report lost) → completed",
      funded,
      succeeded,
      "completed",
      ["PayoutCompleted", "PaymentCompleted"],
    ],
    [
      "paying + failed → refunding",
      paying,
      { type: "payout.failed", reason: "QR Code inválido" } as PaymentInput,
      "refunding",
      ["PayoutFailed", "RefundRequested"],
    ],
    [
      "completed + reversed (MED) → refunding",
      completed,
      { type: "payout.reversed", reversalId: "med_1", returnedCents: 1234 } as PaymentInput,
      "refunding",
      ["PayoutReversed", "RefundRequested"],
    ],
  ] as const)("%s", (_, start, input, status, types) => {
    const r = run(start(), input);
    expect(r.p.status).toBe(status);
    expect(r.types).toEqual(types);
  });

  it("a failed payout refunds the quoted amount, not the excess already refunded", () => {
    const p = run(
      fresh(),
      deposit({ amount7: Q + 5n }),
      { type: "payout.started" },
      { type: "payout.failed", reason: "x" },
    ).p;
    expect(p.refunds.map((r) => [r.reason, r.amount7])).toEqual([
      ["over", 5n],
      ["payout_failed", Q],
    ]);
  });

  it("a partial MED refunds a proportional amount, never more than the quote", () => {
    const half = run(completed(), { type: "payout.reversed", reversalId: "med_1", returnedCents: 617 }).p;
    expect(half.refunds.at(-1)?.amount7).toBe((Q * 617n) / 1234n);
    const over = run(completed(), { type: "payout.reversed", reversalId: "med_2", returnedCents: 99_999 }).p;
    expect(over.refunds.at(-1)?.amount7).toBe(Q);
  });

  it("records a reversal that returned nothing without a 0 refund that could never be sent (T-034)", () => {
    const start = completed();
    const r = run(start, { type: "payout.reversed", reversalId: "med_0", returnedCents: 0 });
    expect(r.p.status).toBe("completed");
    expect(r.p.refunds).toEqual(start.refunds);
    expect(r.p.reversals).toContain("med_0");
    expect(run(r.p, { type: "payout.reversed", reversalId: "med_0", returnedCents: 0 }).p).toEqual(r.p); // once
  });

  it("repeated success reports are no-ops", () => {
    const done = completed();
    expect(decide(done, succeeded)).toEqual({ payment: done, events: [] });
  });
});

describe("timeouts", () => {
  it("awaiting + timeout → expired", () => {
    const r = run(fresh(), { type: "deposit.timeout" });
    expect(r.p.status).toBe("expired");
    expect(r.types).toEqual(["PaymentExpired"]);
  });

  it("a timeout after funding changes nothing", () => {
    const p = funded();
    expect(decide(p, { type: "deposit.timeout" })).toEqual({ payment: p, events: [] });
  });
});

describe("deposits after the payment moved on are refunded, status unchanged", () => {
  it.each([
    ["completed", completed, "completed"],
    ["expired", () => run(fresh(), { type: "deposit.timeout" }).p, "expired"],
    ["funded", funded, "funded"],
  ] as const)("%s", (_, start, status) => {
    const r = run(start(), deposit({ depositId: "pier-evt-2" }));
    expect(r.p.status).toBe(status);
    expect(r.types).toEqual(["DepositMatched", "RefundRequested"]);
    expect(r.p.refunds.at(-1)?.reason).toBe("unexpected");
  });
});

describe("refunds", () => {
  it("refunding + last refund sent → refunded", () => {
    const p = run(fresh(), deposit({ amount7: 1n })).p;
    const r = run(p, { type: "refund.sent", refundId: p.refunds[0]?.id ?? "", txHash: "b".repeat(64) });
    expect(r.p.status).toBe("refunded");
    expect(r.types).toEqual(["RefundSent", "PaymentRefunded"]);
    expect(isSettled(r.p)).toBe(true);
  });

  it("an excess refund sent while funded keeps the status", () => {
    const p = run(fresh(), deposit({ amount7: Q + 5n })).p;
    const r = run(p, { type: "refund.sent", refundId: p.refunds[0]?.id ?? "", txHash: "c".repeat(64) });
    expect(r.p.status).toBe("funded");
    expect(r.types).toEqual(["RefundSent"]);
  });

  it("a settled payment has a terminal status and no refund still to send", () => {
    expect(isSettled(completed())).toBe(true);
    const withExtra = run(completed(), deposit({ depositId: "pier-evt-9" })).p;
    expect(isSettled(withExtra)).toBe(false);
  });
});

describe("invalid inputs and bookkeeping", () => {
  it.each([
    ["awaiting + payout.succeeded", fresh, succeeded],
    ["awaiting + payout.failed", fresh, { type: "payout.failed", reason: "x" } as PaymentInput],
    [
      "awaiting + payout.reversed",
      fresh,
      { type: "payout.reversed", reversalId: "m", returnedCents: 1 } as PaymentInput,
    ],
    ["awaiting + unknown refund", fresh, { type: "refund.sent", refundId: "nope", txHash: "d" } as PaymentInput],
  ] as const)("%s throws InvalidTransition", (_, start, input) => {
    expect(() => decide(start(), input)).toThrow(InvalidTransition);
  });

  it("bumps the version only when something changed", () => {
    const p0 = fresh();
    const p1 = decide(p0, deposit()).payment;
    expect(p1.version).toBe(p0.version + 1);
    expect(decide(p1, deposit()).payment.version).toBe(p1.version);
  });

  it("events carry the payment as aggregate and correlation", () => {
    const [e] = decide(fresh(), deposit()).events;
    expect(e).toMatchObject({ aggregate: { type: "payment", id: "pay_1" }, correlationId: "pay_1", version: 1 });
  });
});
