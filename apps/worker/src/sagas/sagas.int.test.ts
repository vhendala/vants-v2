// T-011: the payment and refund sagas on a real Postgres, driven step by step so every crash point is reproducible.
// Hodle and the Stellar network are fakes (test/fakes.ts) that enforce what the real ones enforce.
import { classicAsset, sacIdOf } from "@vants/adapter-stellar";
import {
  type Backbone,
  createBackbone,
  createIntegrator,
  accountBalances,
  activeRefill,
  type Destination,
  floatPosition,
  getPayment,
  insertPayment,
  insertQuote,
  migrate,
  nextMuxId,
} from "@vants/db";
import {
  BASE_USDC,
  BASE_WALLET_ACCOUNT,
  BRIDGE_ACCOUNT,
  CAPITAL_ACCOUNT,
  type DomainEvent,
  FEES_ACCOUNT,
  FLOAT_ACCOUNT,
  isSettled,
  newPayment,
  payoutDebit6,
  priceQuote,
  TREASURY_ACCOUNT,
  USDH,
} from "@vants/domain";
import { buildStaticBrCode } from "@vants/pix";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startPostgres, type TestPostgres } from "../../../../packages/db/test/postgres.ts";
import { FakeCctp, FakeFloat, FakeHodle, FakeLedger, transferEnvelope } from "../../test/fakes.ts";
import { onPierRecord } from "./deposits.ts";
import { onHodleRecord } from "./hodle-events.ts";
import { onPayoutRequested, PayoutPending, runPayoutPump } from "./payouts.ts";
import { PAYOUT_PUMP, REFUND_PUMP } from "./queues.ts";
import { onRefundEvent, RefundPending, runRefundPump } from "./refunds.ts";
import { DEPOSIT_GRACE_SECONDS, sweep } from "./sweep.ts";
import { onFloatEvent } from "./float.ts";
import { RefillPending, runRefillPump } from "./refill.ts";
import { openLedger, reconcile } from "../books.ts";
import { topUpFloat } from "../float-topup.ts";

const CIRCLE = "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const CIRCLE_SAC = sacIdOf(classicAsset(CIRCLE));
const NATIVE_SAC = sacIdOf(classicAsset("native"));
const RATE = 5_400_000n;
const merchant = { key: "pix-spike@vants.example.com", merchantName: "VANTS TESTE", merchantCity: "SAO PAULO" };

const signer = Keypair.random();
const treasury = signer.publicKey();
const payer = Keypair.random().publicKey();

let pgc: TestPostgres;
let bb: Backbone;
let integratorId = "";
let clock = new Date("2026-10-22T12:00:00.000Z");
const now = () => clock;
let ledger: FakeLedger;
let hodle: FakeHodle;
let seq = 0;

let floatPolicy = { minMicros: 0n, targetMicros: 0n };
const deps = () => ({ backbone: bb, treasury, now, ledger, signer, hodle, float: floatPolicy });

/** The books start from these balances (opened once, in beforeAll). */
const OPENING = { usdc7: 1_000_0000000n, xlm7: 10_000_0000000n, usdh6: 100_000000n };

beforeAll(async () => {
  pgc = await startPostgres();
  await migrate(pgc.url);
  bb = createBackbone({ databaseUrl: pgc.url });
  await bb.start();
  for (const q of [PAYOUT_PUMP, REFUND_PUMP]) await bb.ensureQueue(q, { policy: "stately" });
  ({ integratorId } = await bb.withTransaction((tx) => createIntegrator(tx, "Saga tests", "p".repeat(32))));
  await openLedger({
    backbone: bb,
    sources: {
      treasury: async () => [
        { asset: CIRCLE_SAC, assetName: CIRCLE, amount7: OPENING.usdc7 },
        { asset: NATIVE_SAC, assetName: "native", amount7: OPENING.xlm7 },
      ],
      float: async () => OPENING.usdh6,
    },
  });
}, 120_000);

afterAll(async () => {
  await bb?.stop();
  await pgc?.stop();
});

beforeEach(async () => {
  clock = new Date(clock.getTime() + 3_600_000); // a fresh hour per test: earlier payments are long expired
  ledger = new FakeLedger(treasury, () => Math.floor(clock.getTime() / 1000));
  hodle = new FakeHodle();
  floatPolicy = { minMicros: 0n, targetMicros: 0n };
  // Each test starts with empty work lists, so a pump only sees its own test's rows.
  await bb.pool.query("UPDATE payouts SET status = 'cancelled' WHERE status IN ('requested', 'sent')");
  await bb.pool.query("UPDATE refunds SET status = 'failed' WHERE status IN ('requested', 'submitted')");
});

async function createPayment(o: { valueCents?: number; destination?: Destination; refundTo?: string } = {}) {
  const valueCents = o.valueCents ?? 1234;
  const destination: Destination = o.destination ?? {
    type: "br_code",
    brCode: buildStaticBrCode({ ...merchant, amountCents: valueCents }),
    payee: { name: merchant.merchantName, city: merchant.merchantCity, key: merchant.key },
    isDynamic: false,
  };
  const price = priceQuote({ valueCents, rateMicros: RATE, feeModel: "sandbox" });
  const expiresAt = new Date(clock.getTime() + 120_000).toISOString();
  return bb.withTransaction(async (tx) => {
    const quote = await insertQuote(tx, {
      integratorId,
      destination,
      assetName: CIRCLE,
      assetSac: CIRCLE_SAC,
      valueCents,
      feeCents: price.feeCents,
      rateMicros: RATE,
      assetAmount7: price.assetAmount7,
      expiresAt,
    });
    const payment = newPayment({
      id: `pay_saga_${++seq}`,
      muxId: await nextMuxId(tx),
      quote: {
        asset: CIRCLE_SAC,
        assetAmount7: price.assetAmount7,
        valueCents,
        feeCents: price.feeCents,
        rateMicros: RATE,
        expiresAt,
      },
      ...(o.refundTo ? { refundTo: o.refundTo } : {}),
    });
    await insertPayment(tx, payment, integratorId, quote.id);
    return payment;
  });
}

/** A transfer into the treasury, as the Pier inbox consumer receives it. */
async function deposit(t: {
  muxId?: string;
  amount7: bigint;
  assetName?: string;
  from?: string;
  to?: string;
  at?: Date;
  /** The contract that emitted the event; a real transfer's is the named asset's SAC. */
  sac?: string;
}) {
  const assetName = t.assetName ?? CIRCLE;
  const event = transferEnvelope({
    from: t.from ?? payer,
    to: t.to ?? treasury,
    assetName,
    sac: t.sac ?? sacIdOf(classicAsset(assetName)),
    amount7: t.amount7,
    ...(t.muxId ? { muxId: t.muxId } : {}),
    ledgerClosedAt: (t.at ?? clock).toISOString(),
  });
  const record = {
    id: String(++seq),
    source: "pier",
    dedupeKey: event.id,
    payload: { subscriptionId: "sub", event },
    receivedAt: clock.toISOString(),
  };
  await bb.withTransaction((tx) => onPierRecord(tx, record, deps()));
  return record;
}

const dispatched = new Set<string>();

/** Delivers new outbox events to the saga consumers, as pg-boss would (each in its own transaction). */
async function dispatch(): Promise<void> {
  for (;;) {
    const rows = await bb.pool.query<{
      id: string;
      type: string;
      version: number;
      occurred_at: Date;
      aggregate_type: string;
      aggregate_id: string;
      correlation_id: string;
      causation_id: string | null;
      payload: unknown;
    }>(
      `SELECT * FROM outbox WHERE type IN ('PayoutRequested', 'PayoutCompleted', 'PayoutFailed', 'RefundRequested', 'UnattributedDeposit')
       ORDER BY occurred_at`,
    );
    const fresh = rows.rows.filter((r) => !dispatched.has(r.id));
    if (fresh.length === 0) return;
    for (const r of fresh) {
      dispatched.add(r.id);
      const event: DomainEvent = {
        id: r.id,
        type: r.type,
        version: r.version,
        occurredAt: r.occurred_at.toISOString(),
        aggregate: { type: r.aggregate_type, id: r.aggregate_id },
        correlationId: r.correlation_id,
        causationId: r.causation_id,
        payload: r.payload,
      };
      // Fan-out as pg-boss does it: each consumer gets its own delivery (and transaction).
      if (r.type.startsWith("Payout")) await bb.withTransaction((tx) => onFloatEvent(tx, event, deps()));
      if (r.type === "PayoutRequested") await bb.withTransaction((tx) => onPayoutRequested(tx, event, deps()));
      if (r.type === "RefundRequested" || r.type === "UnattributedDeposit") {
        await bb.withTransaction((tx) => onRefundEvent(tx, event, deps()));
      }
    }
  }
}

/** Runs the sagas until nothing moves: consumers, then the payout pump, then the refund pump. */
async function settleAll() {
  await dispatch();
  await runPayoutPump(deps());
  await dispatch();
  await runRefundPump(deps());
  await dispatch();
}

const load = async (id: string) => {
  const rec = await bb.withTransaction((tx) => getPayment(tx, id));
  if (!rec) throw new Error(`no payment ${id}`);
  return rec.payment;
};
const eventsOf = async (id: string) =>
  (
    await bb.pool.query<{ type: string }>("SELECT type FROM outbox WHERE correlation_id = $1 ORDER BY occurred_at", [
      id,
    ])
  ).rows.map((r) => r.type);
const memo36 = (muxId: string) => BigInt(muxId).toString(36);

describe("a funded payment is paid once (INV-01, INV-02)", () => {
  it("exact deposit → one Hodle payout of the quoted BRL to the BR Code, keyed by the payment id", async () => {
    const p = await createPayment();
    await deposit({ muxId: p.muxId, amount7: p.quote.assetAmount7 });
    expect((await load(p.id)).status).toBe("funded");

    await settleAll();
    const done = await load(p.id);
    expect(done.status).toBe("completed");
    expect(done.payout?.transactionId).toBe("hodle-tx-1");
    expect(hodle.calls).toEqual([
      { valueCents: 1234, externalId: `vants:${p.id}`, qrCode: buildStaticBrCode({ ...merchant, amountCents: 1234 }) },
    ]);
    expect(await eventsOf(p.id)).toEqual(["DepositMatched", "PayoutRequested", "PayoutCompleted", "PaymentCompleted"]);
    expect(ledger.payments).toEqual([]);
  });

  it("pays a Pix key destination with the key and its type", async () => {
    const p = await createPayment({
      valueCents: 5400,
      destination: { type: "pix_key", key: "a@b.co", keyType: "EMAIL" },
    });
    await deposit({ muxId: p.muxId, amount7: p.quote.assetAmount7 });
    await settleAll();
    expect(hodle.calls[0]).toEqual({
      valueCents: 5400,
      externalId: `vants:${p.id}`,
      pixKey: { key: "a@b.co", type: "EMAIL" },
    });
    expect((await load(p.id)).status).toBe("completed");
  });

  it("a crash after Hodle paid but before we recorded it re-asks Hodle with the same externalId: one payout", async () => {
    const p = await createPayment();
    await deposit({ muxId: p.muxId, amount7: p.quote.assetAmount7 });
    await dispatch();
    hodle.next.push("throw_after_paying");
    await expect(runPayoutPump(deps())).rejects.toBeInstanceOf(PayoutPending);
    expect((await load(p.id)).status).toBe("paying");

    await runPayoutPump(deps());
    expect((await load(p.id)).status).toBe("completed");
    expect(hodle.calls).toHaveLength(2);
    expect(new Set(hodle.calls.map((c) => c.externalId))).toEqual(new Set([`vants:${p.id}`]));
    expect(hodle.paid.size).toBe(1);
  });

  it("the same Pier event twice changes nothing the second time (INV-04)", async () => {
    const p = await createPayment();
    const record = await deposit({ muxId: p.muxId, amount7: p.quote.assetAmount7 });
    await bb.withTransaction((tx) => onPierRecord(tx, record, deps()));
    await settleAll();
    expect((await load(p.id)).deposits).toHaveLength(1);
    expect(hodle.calls).toHaveLength(1);
  });

  it("re-validates the BR Code right before paying (INV-05): a bad stored code is refunded, never sent to Hodle", async () => {
    const good = buildStaticBrCode({ ...merchant, amountCents: 1234 });
    const p = await createPayment({
      destination: {
        type: "br_code",
        brCode: `${good.slice(0, -4)}0000`,
        payee: { name: "X", city: "Y" },
        isDynamic: false,
      },
    });
    await deposit({ muxId: p.muxId, amount7: p.quote.assetAmount7 });
    await settleAll();
    expect(hodle.calls).toEqual([]);
    const done = await load(p.id);
    expect(done.status).toBe("refunded");
    expect(done.refunds.map((r) => r.reason)).toEqual(["payout_failed"]);
    expect(ledger.payments).toHaveLength(1);
  });
});

describe("Hodle outcomes", () => {
  it("a settlement failure refunds the quoted amount to the sender", async () => {
    const p = await createPayment();
    await deposit({ muxId: p.muxId, amount7: p.quote.assetAmount7 });
    hodle.next.push("settlement_failed");
    await settleAll();
    const done = await load(p.id);
    expect(done.status).toBe("refunded");
    expect(ledger.payments).toEqual([
      {
        hash: expect.any(String),
        to: payer,
        asset: CIRCLE,
        amount: "2.2851852",
        memo: `vants:rf:${memo36(p.muxId)}:1`,
      },
    ]);
  });

  it("an empty float stops the queue in order and resumes it later (one payout in flight, DEC-008)", async () => {
    const first = await createPayment();
    const second = await createPayment();
    await deposit({ muxId: first.muxId, amount7: first.quote.assetAmount7 });
    await deposit({ muxId: second.muxId, amount7: second.quote.assetAmount7 });
    await dispatch();
    hodle.next.push("insufficient_float");
    await expect(runPayoutPump(deps())).rejects.toBeInstanceOf(PayoutPending);
    expect([(await load(first.id)).status, (await load(second.id)).status]).toEqual(["paying", "funded"]);

    await runPayoutPump(deps()); // the float was refilled
    expect([(await load(first.id)).status, (await load(second.id)).status]).toEqual(["completed", "completed"]);
    expect(hodle.calls.map((c) => c.externalId)).toEqual([
      `vants:${first.id}`,
      `vants:${first.id}`,
      `vants:${second.id}`,
    ]);
  });

  it("a payout still processing is asked again later, not failed", async () => {
    const p = await createPayment();
    await deposit({ muxId: p.muxId, amount7: p.quote.assetAmount7 });
    await dispatch();
    hodle.next.push("processing");
    await expect(runPayoutPump(deps())).rejects.toBeInstanceOf(PayoutPending);
    await runPayoutPump(deps());
    expect((await load(p.id)).status).toBe("completed");
  });

  it("PAYOUT_FAILED from Hodle for a payout in flight refunds it; PAYOUT_SUCCESSFUL for a paid one only confirms", async () => {
    const stuck = await createPayment();
    const paid = await createPayment();
    await deposit({ muxId: paid.muxId, amount7: paid.quote.assetAmount7 });
    await settleAll();
    await deposit({ muxId: stuck.muxId, amount7: stuck.quote.assetAmount7 });
    await dispatch();
    hodle.next.push("unavailable");
    await expect(runPayoutPump(deps())).rejects.toBeInstanceOf(PayoutPending);

    const hook = (event: string, externalId: string) => ({
      id: String(++seq),
      source: "hodle",
      dedupeKey: `${event}:${externalId}`,
      payload: { event, data: { externalId, success: event === "PAYOUT_SUCCESSFUL" }, deliveryAttempt: 1 },
      receivedAt: clock.toISOString(),
    });
    await bb.withTransaction((tx) => onHodleRecord(tx, hook("PAYOUT_FAILED", `vants:${stuck.id}`), deps()));
    await bb.withTransaction((tx) => onHodleRecord(tx, hook("PAYOUT_SUCCESSFUL", `vants:${paid.id}`), deps()));
    await settleAll();

    expect((await load(stuck.id)).status).toBe("refunded");
    expect((await load(paid.id)).status).toBe("completed");
    const confirmed = await bb.pool.query("SELECT confirmed_at FROM payouts WHERE payment_id = $1", [paid.id]);
    expect(confirmed.rows[0]?.confirmed_at).toBeInstanceOf(Date);
    expect(hodle.calls.filter((c) => c.externalId === `vants:${stuck.id}`)).toHaveLength(1);
  });
});

describe("bad deposits are refunded, tagged with the payment (D5, INV-10, INV-11)", () => {
  it("underpaid: the whole deposit goes back, nothing is paid", async () => {
    const p = await createPayment();
    await deposit({ muxId: p.muxId, amount7: p.quote.assetAmount7 - 1n });
    await settleAll();
    const done = await load(p.id);
    expect(done.status).toBe("refunded");
    expect(isSettled(done)).toBe(true);
    expect(hodle.calls).toEqual([]);
    expect(ledger.payments).toEqual([
      {
        hash: expect.any(String),
        to: payer,
        asset: CIRCLE,
        amount: "2.2851851",
        memo: `vants:rf:${memo36(p.muxId)}:1`,
      },
    ]);
    expect(done.refunds[0]?.txHash).toBe(ledger.payments[0]?.hash);
  });

  it("late (ledger closed after the quote expired): refunded, never re-priced", async () => {
    const p = await createPayment();
    await deposit({
      muxId: p.muxId,
      amount7: p.quote.assetAmount7,
      at: new Date(Date.parse(p.quote.expiresAt) + 1000),
    });
    await settleAll();
    expect((await load(p.id)).status).toBe("refunded");
    expect(hodle.calls).toEqual([]);
    expect(ledger.payments.map((x) => x.amount)).toEqual(["2.2851852"]);
  });

  it("wrong asset: refunded in that asset", async () => {
    const p = await createPayment();
    await deposit({ muxId: p.muxId, amount7: 15_000_000n, assetName: "native" });
    await settleAll();
    expect((await load(p.id)).status).toBe("refunded");
    expect(ledger.payments.map((x) => [x.asset, x.amount])).toEqual([["native", "1.5000000"]]);
  });

  it("over: pays the Pix and returns only the excess, to refundTo when given", async () => {
    const refundTo = Keypair.random().publicKey();
    const p = await createPayment({ refundTo });
    await deposit({ muxId: p.muxId, amount7: p.quote.assetAmount7 + 5_000_000n });
    await settleAll();
    const done = await load(p.id);
    expect(done.status).toBe("completed");
    expect(isSettled(done)).toBe(true);
    expect(hodle.calls).toHaveLength(1);
    expect(ledger.payments.map((x) => [x.to, x.amount])).toEqual([[refundTo, "0.5000000"]]);
  });

  it("unknown muxed id: refunded to the sender with a u-tagged memo (testnet policy, §11 Q6)", async () => {
    await deposit({ muxId: "999999999", amount7: 10_000_000n });
    await settleAll();
    expect(ledger.payments).toEqual([
      {
        hash: expect.any(String),
        to: payer,
        asset: CIRCLE,
        amount: "1.0000000",
        memo: `vants:rf:${memo36("999999999")}:u1`,
      },
    ]);
    const outbox = await bb.pool.query("SELECT type FROM outbox WHERE aggregate_type = 'deposit' ORDER BY occurred_at");
    expect(outbox.rows.slice(-2).map((r) => r.type)).toEqual(["UnattributedDeposit", "RefundSent"]);
  });

  it("no muxed id (a top-up) is recorded but not refunded; our own outgoing transfers are ignored", async () => {
    await deposit({ amount7: 10_000_000n });
    await deposit({ muxId: "1000", amount7: 10_000_000n, from: treasury, to: payer });
    await settleAll();
    expect(ledger.payments).toEqual([]);
    const kinds = await bb.pool.query("SELECT kind FROM deposits ORDER BY created_at DESC LIMIT 1");
    expect(kinds.rows[0]?.kind).toBe("unmarked");
  });
});

describe("transfer events from a contract that isn't the named asset's SAC (T-047)", () => {
  const OTHER_CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 7));
  const depositRows = async (from: string) =>
    (await bb.pool.query("SELECT id FROM deposits WHERE from_account = $1", [from])).rows;

  it("an unknown muxed id: no deposit, no refund", async () => {
    const attacker = Keypair.random().publicKey();
    await deposit({ muxId: "900000001", amount7: 50_000_000n, from: attacker, sac: OTHER_CONTRACT });
    await settleAll();
    expect(await depositRows(attacker)).toEqual([]);
    expect(ledger.payments).toEqual([]);
  });

  it("a live payment's muxed id: the payment stays awaiting its deposit, nothing is refunded", async () => {
    const attacker = Keypair.random().publicKey();
    const p = await createPayment();
    await deposit({ muxId: p.muxId, amount7: 50_000_000n, from: attacker, sac: OTHER_CONTRACT });
    await settleAll();
    expect((await load(p.id)).status).toBe("awaiting_deposit");
    expect(await depositRows(attacker)).toEqual([]);
    expect(ledger.payments).toEqual([]);
  });

  it("no muxed id: nothing is booked to capital", async () => {
    const attacker = Keypair.random().publicKey();
    await deposit({ amount7: 50_000_000n, from: attacker, sac: OTHER_CONTRACT });
    expect(await depositRows(attacker)).toEqual([]);
  });

  it("an asset name that isn't one: ignored, not thrown (the job would retry forever)", async () => {
    const attacker = Keypair.random().publicKey();
    await deposit({ muxId: "900000002", amount7: 1n, from: attacker, assetName: "garbage", sac: OTHER_CONTRACT });
    expect(await depositRows(attacker)).toEqual([]);
  });
});

describe("refunds land at most once (INV-10)", () => {
  it("a crash before submitting resubmits the persisted envelope, not a new one", async () => {
    const p = await createPayment();
    await deposit({ muxId: p.muxId, amount7: 1n });
    await dispatch();
    ledger.throwBeforeSubmit = 1;
    await expect(runRefundPump(deps())).rejects.toThrow(/network error/);
    const stored = await bb.pool.query<{ tx_hash: string }>("SELECT tx_hash FROM refunds WHERE payment_id = $1", [
      p.id,
    ]);
    clock = new Date(clock.getTime() + 60_000); // later, but before the deadline: a rebuilt envelope would differ
    await runRefundPump(deps());
    expect(ledger.payments.map((x) => x.hash)).toEqual([stored.rows[0]?.tx_hash]);
    expect((await load(p.id)).status).toBe("refunded");
  });

  it("a crash after the envelope landed finds it on the ledger instead of paying again", async () => {
    const p = await createPayment();
    await deposit({ muxId: p.muxId, amount7: 1n });
    await dispatch();
    ledger.throwAfterLand = 1;
    await expect(runRefundPump(deps())).rejects.toThrow(/crashed/);
    await runRefundPump(deps());
    expect(ledger.payments).toHaveLength(1);
    expect((await load(p.id)).status).toBe("refunded");
  });

  it("an envelope that lands just after we looked for it is resubmitted, not rebuilt: one payment", async () => {
    const p = await createPayment();
    await deposit({ muxId: p.muxId, amount7: 1n });
    await dispatch();
    ledger.landLate = 1;
    await expect(runRefundPump(deps())).rejects.toBeInstanceOf(RefundPending);
    clock = new Date(clock.getTime() + 60_000);
    await runRefundPump(deps()); // lookup: not on the ledger yet; it lands before our next write
    expect(ledger.payments).toHaveLength(1);
    expect((await load(p.id)).status).toBe("refunded");
  });

  it("an envelope lost in flight is resubmitted until its deadline, then rebuilt; one payment either way", async () => {
    const p = await createPayment();
    await deposit({ muxId: p.muxId, amount7: 1n });
    await dispatch();
    ledger.dropNext = 2;
    await expect(runRefundPump(deps())).rejects.toBeInstanceOf(RefundPending);
    await expect(runRefundPump(deps())).rejects.toBeInstanceOf(RefundPending); // same envelope again
    const first = ledger.submitted[0];
    expect(ledger.submitted).toEqual([first, first]);

    clock = new Date(clock.getTime() + 331_000); // past maxTime (300 s) + grace (30 s): the old envelope is dead
    await runRefundPump(deps());
    expect(ledger.payments).toHaveLength(1);
    expect(ledger.payments[0]?.hash).not.toBe(first);
    expect((await load(p.id)).status).toBe("refunded");
  });

  it("refunds go out strictly one after another: a pending one holds the next (one sequence number)", async () => {
    const a = await createPayment();
    const b = await createPayment();
    await deposit({ muxId: a.muxId, amount7: 1n });
    await deposit({ muxId: b.muxId, amount7: 2n });
    await dispatch();
    ledger.dropNext = 1;
    await expect(runRefundPump(deps())).rejects.toBeInstanceOf(RefundPending);
    const bRow = await bb.pool.query("SELECT status FROM refunds WHERE payment_id = $1", [b.id]);
    expect(bRow.rows[0]?.status).toBe("requested");

    await runRefundPump(deps());
    expect(ledger.payments.map((x) => x.amount)).toEqual(["0.0000001", "0.0000002"]);
  });

  it("an envelope that lands but fails is set aside for review, and the queue moves on", async () => {
    const a = await createPayment();
    const b = await createPayment();
    await deposit({ muxId: a.muxId, amount7: 1n });
    await deposit({ muxId: b.muxId, amount7: 2n });
    await dispatch();
    ledger.failOnLedger = 1;
    await runRefundPump(deps());
    const rows = await bb.pool.query<{ payment_id: string; status: string }>(
      "SELECT payment_id, status FROM refunds WHERE payment_id IN ($1, $2) ORDER BY created_at",
      [a.id, b.id],
    );
    expect(rows.rows.map((r) => r.status)).toEqual(["failed", "sent"]);
    expect((await load(a.id)).status).toBe("refunding");
    expect((await load(b.id)).status).toBe("refunded");
  });
});

describe("the sweep (INV-03)", () => {
  it("expires payments with no deposit once the quote expired plus the grace period, and only then", async () => {
    const p = await createPayment();
    clock = new Date(Date.parse(p.quote.expiresAt) + (DEPOSIT_GRACE_SECONDS - 1) * 1000);
    await sweep(deps());
    expect((await load(p.id)).status).toBe("awaiting_deposit");

    clock = new Date(Date.parse(p.quote.expiresAt) + (DEPOSIT_GRACE_SECONDS + 1) * 1000);
    await sweep(deps());
    expect((await load(p.id)).status).toBe("expired");
    expect((await eventsOf(p.id)).at(-1)).toBe("PaymentExpired");

    await deposit({ muxId: p.muxId, amount7: p.quote.assetAmount7 }); // after expiry: refunded, status unchanged
    await settleAll();
    const done = await load(p.id);
    expect([done.status, isSettled(done), done.refunds[0]?.reason]).toEqual(["expired", true, "unexpected"]);
  });

  it("wakes both pumps, so a payout whose wake-up job was lost is still paid", async () => {
    const p = await createPayment();
    await deposit({ muxId: p.muxId, amount7: p.quote.assetAmount7 });
    await dispatch();
    await bb.pool.query("DELETE FROM pgboss.job WHERE name IN ($1, $2)", [PAYOUT_PUMP, REFUND_PUMP]);
    await sweep(deps());
    const woken = await bb.pool.query<{ name: string }>("SELECT DISTINCT name FROM pgboss.job WHERE name IN ($1, $2)", [
      PAYOUT_PUMP,
      REFUND_PUMP,
    ]);
    expect(woken.rows.map((r) => r.name).sort()).toEqual([PAYOUT_PUMP, REFUND_PUMP].sort());
  });
});

describe("the books (T-015, INV-06)", () => {
  const books = async () => {
    const t = await bb.withTransaction((tx) => accountBalances(tx, TREASURY_ACCOUNT));
    const f = await bb.withTransaction((tx) => accountBalances(tx, FLOAT_ACCOUNT));
    return { usdc: t.get(CIRCLE_SAC) ?? 0n, xlm: t.get(NATIVE_SAC) ?? 0n, usdh: f.get(USDH) ?? 0n };
  };
  const clearing = async (id: string) =>
    [...(await bb.withTransaction((tx) => accountBalances(tx, `clearing:${id}`))).values()].reduce((a, b) => a + b, 0n);
  /** What actually left the treasury in this test: refunds paid on the fake ledger, and 100 stroops per landed envelope. */
  const paidOut = () => ({
    usdc: ledger.payments.filter((p) => p.asset === CIRCLE).reduce((a, p) => a + BigInt(p.amount.replace(".", "")), 0n),
    fees: BigInt(ledger.results.size) * 100n,
  });

  it("an over-payment: deposit in, Pix paid from the float, excess and fee out; clearing back to zero", async () => {
    const before = await books();
    const p = await createPayment();
    const excess = 5_000_000n;
    await deposit({ muxId: p.muxId, amount7: p.quote.assetAmount7 + excess });
    await settleAll();
    const after = await books();
    const debit = hodle.paid.get(`vants:${p.id}`)?.debit6 ?? -1n;
    expect(after.usdc - before.usdc).toBe(p.quote.assetAmount7 + excess - paidOut().usdc);
    expect(paidOut().usdc).toBe(excess);
    expect(after.xlm - before.xlm).toBe(-paidOut().fees);
    expect(after.usdh - before.usdh).toBe(-debit);
    expect(await clearing(p.id)).toBe(0n);
  });

  it("an unattributed deposit and its refund net to zero except the fee; a top-up is capital", async () => {
    const before = await books();
    const capitalBefore =
      (await bb.withTransaction((tx) => accountBalances(tx, CAPITAL_ACCOUNT))).get(CIRCLE_SAC) ?? 0n;
    await deposit({ muxId: "888888888", amount7: 3_000_000n });
    await deposit({ amount7: 7_000_000n }); // no muxed id: a top-up
    await settleAll();
    const after = await books();
    expect(after.usdc - before.usdc).toBe(7_000_000n);
    expect(after.xlm - before.xlm).toBe(-100n);
    const capitalAfter = (await bb.withTransaction((tx) => accountBalances(tx, CAPITAL_ACCOUNT))).get(CIRCLE_SAC) ?? 0n;
    expect(capitalAfter - capitalBefore).toBe(-7_000_000n);
    const fees = await bb.withTransaction((tx) => accountBalances(tx, FEES_ACCOUNT));
    expect(fees.get(NATIVE_SAC)).toBeGreaterThan(0n);
  });

  it("every committed event balances: the whole ledger sums to zero per asset", async () => {
    const r = await bb.pool.query<{ asset: string; total: string }>(
      "SELECT asset, sum(amount)::text AS total FROM ledger_entries GROUP BY asset",
    );
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows.filter((row) => row.total !== "0")).toEqual([]);
  });
});

describe("the float (T-015, §3.7)", () => {
  it("reserves a funded payment's USDH until its payout ends", async () => {
    const p = await createPayment();
    await deposit({ muxId: p.muxId, amount7: p.quote.assetAmount7 });
    const base = await bb.withTransaction((tx) => floatPosition(tx));
    await dispatch();
    const held = await bb.withTransaction((tx) => floatPosition(tx));
    const need = payoutDebit6({
      valueCents: p.quote.valueCents,
      feeCents: p.quote.feeCents,
      rateMicros: p.quote.rateMicros,
    });
    expect(held.reserved6 - base.reserved6).toBe(need);
    expect(held.available6).toBe(held.balance6 - held.reserved6);
    await settleAll();
    const done = await bb.withTransaction((tx) => floatPosition(tx));
    expect(done.reserved6).toBe(base.reserved6);
  });

  it("releases the reservation when the payout fails", async () => {
    const p = await createPayment();
    await deposit({ muxId: p.muxId, amount7: p.quote.assetAmount7 });
    const base = await bb.withTransaction((tx) => floatPosition(tx));
    hodle.next.push("settlement_failed");
    await settleAll();
    expect((await bb.withTransaction((tx) => floatPosition(tx))).reserved6).toBe(base.reserved6);
  });

  it("emits FloatLow once, when a payout takes the balance below the minimum", async () => {
    const pos = await bb.withTransaction((tx) => floatPosition(tx));
    floatPolicy = { minMicros: pos.balance6 - 1n, targetMicros: pos.balance6 + 50_000_000n };
    const low = async () =>
      Number((await bb.pool.query("SELECT count(*) AS n FROM outbox WHERE type = 'FloatLow'")).rows[0]?.n ?? 0);
    const before = await low();
    for (const _ of [1, 2]) {
      const p = await createPayment();
      await deposit({ muxId: p.muxId, amount7: p.quote.assetAmount7 });
      await settleAll();
    }
    expect((await low()) - before).toBe(1);
    const event = await bb.pool.query<{ payload: { topUp6: string; min6: string } }>(
      "SELECT payload FROM outbox WHERE type = 'FloatLow' ORDER BY occurred_at DESC LIMIT 1",
    );
    expect(event.rows[0]?.payload.min6).toBe(floatPolicy.minMicros.toString());
    expect(BigInt(event.rows[0]?.payload.topUp6 ?? "0")).toBeGreaterThan(50_000_000n);
  });
});

describe("reconciliation (T-015, D7)", () => {
  /** The outside world as it would be if it matched the books, give or take `skew` on the float. */
  const sourcesMatching = async (skew = 0n) => {
    const t = await bb.withTransaction((tx) => accountBalances(tx, TREASURY_ACCOUNT));
    const f = (await bb.withTransaction((tx) => accountBalances(tx, FLOAT_ACCOUNT))).get(USDH) ?? 0n;
    return {
      treasury: async () => [
        { asset: CIRCLE_SAC, assetName: CIRCLE, amount7: t.get(CIRCLE_SAC) ?? 0n },
        { asset: NATIVE_SAC, assetName: "native", amount7: t.get(NATIVE_SAC) ?? 0n },
      ],
      float: async () => f + skew,
    };
  };

  it("is ok when Horizon and Hodle match the books", async () => {
    const report = await reconcile({ backbone: bb, sources: await sourcesMatching() });
    expect(report?.rows.map((r) => [r.scope, r.assetName, r.status])).toEqual([
      ["treasury", expect.any(String), "ok"],
      ["treasury", expect.any(String), "ok"],
      ["float", USDH, "ok"],
    ]);
  });

  it("calls a difference a mismatch first (money in flight), drift when it persists, and raises ReconciliationDrift", async () => {
    const sources = await sourcesMatching(-1234n);
    const first = await reconcile({ backbone: bb, sources });
    expect(first?.rows.find((r) => r.scope === "float")).toMatchObject({ status: "mismatch", diff: -1234n });
    const second = await reconcile({ backbone: bb, sources });
    expect(second?.rows.find((r) => r.scope === "float")?.status).toBe("drift");
    const raised = await bb.pool.query<{ payload: { diff: string } }>(
      "SELECT payload FROM outbox WHERE type = 'ReconciliationDrift' ORDER BY occurred_at DESC LIMIT 1",
    );
    expect(raised.rows[0]?.payload.diff).toBe("-1234");
    expect(
      (await reconcile({ backbone: bb, sources: await sourcesMatching() }))?.rows.every((r) => r.status === "ok"),
    ).toBe(true);
  });

  it("opens the books once", async () => {
    const again = await openLedger({ backbone: bb, sources: await sourcesMatching() });
    expect(again).toBe("already-open");
  });
});

describe("the float refill (T-016, D6)", () => {
  let cctp: FakeCctp;
  let float: FakeFloat;
  const refillDeps = () => ({ ...deps(), refill: { cctp, float }, capMicros: 1_000_000n, rateMicros: 5_400_000n });
  const balancesOf = async (account: string) => bb.withTransaction((tx) => accountBalances(tx, account));

  beforeEach(async () => {
    const pos = await bb.withTransaction((tx) => floatPosition(tx));
    float = new FakeFloat(pos.balance6, hodle); // the sandbox agrees with the books when a test starts
    cctp = new FakeCctp(ledger, signer);
    // Below the minimum, wanting 5 USDH more: the cap (1 USDC) decides the size.
    floatPolicy = { minMicros: pos.balance6 + 1n, targetMicros: pos.balance6 + 5_000_000n };
    await bb.pool.query(
      "UPDATE refills SET status = 'failed', finished_at = now() - interval '1 day' WHERE status <> 'completed'",
    );
  });

  it("burns, attests, mints and credits 1 USDC exactly; the books follow every leg", async () => {
    const before = {
      treasury: await balancesOf(TREASURY_ACCOUNT),
      float: (await bb.withTransaction((tx) => floatPosition(tx))).balance6,
    };
    const done = await runRefillPump(refillDeps());
    expect(done?.status).toBe("completed");
    expect([...cctp.burns.values()]).toEqual([10_000_000n]);
    expect(cctp.mints).toHaveLength(1);
    expect([...float.deposits.values()]).toEqual([{ cents: 540, settled: true }]);

    const treasury = await balancesOf(TREASURY_ACCOUNT);
    expect((before.treasury.get(CIRCLE_SAC) ?? 0n) - (treasury.get(CIRCLE_SAC) ?? 0n)).toBe(10_000_000n);
    expect((before.treasury.get(NATIVE_SAC) ?? 0n) - (treasury.get(NATIVE_SAC) ?? 0n)).toBe(200n); // approve + burn fees
    expect((await balancesOf(BRIDGE_ACCOUNT)).get(CIRCLE_SAC) ?? 0n).toBe(0n);
    expect((await balancesOf(BASE_WALLET_ACCOUNT)).get(BASE_USDC)).toBe(1_000_000n);
    const after = (await bb.withTransaction((tx) => floatPosition(tx))).balance6;
    expect(after - before.float).toBe(1_000_000n);
    expect(await float.balance()).toBe(after); // Hodle and the books agree to the unit

    expect(await runRefillPump(refillDeps())).toBeNull(); // still below target but above the minimum: nothing to do
  });

  it("a manual top-up credits the sandbox float and books it, so the float and the books still agree", async () => {
    const topUp = (want6: bigint) =>
      topUpFloat({ backbone: bb, float, rateMicros: 5_400_000n, pause: async () => {}, confirmTries: 2 }, want6);
    const before = (await bb.withTransaction((tx) => floatPosition(tx))).balance6;
    const done = await topUp(20_000_000n);
    expect(done).toMatchObject({ ok: true, cents: 10_800, credit6: 20_000_000n });
    expect(await float.balance()).toBe(before + 20_000_000n);
    expect((await bb.withTransaction((tx) => floatPosition(tx))).balance6).toBe(before + 20_000_000n);

    float.balance6 += 1n; // something the books don't know about: refuse rather than book a guess
    expect(await topUp(1_000_000n)).toEqual({
      ok: false,
      reason: "the float differs from the books by 1: run pnpm reconcile",
    });
    float.balance6 -= 1n;
    float.rate = "5.5";
    expect(await topUp(1_000_000n)).toMatchObject({ ok: false });
    expect([...float.deposits.values()].filter((d) => d.settled)).toHaveLength(1); // the mispriced one was never settled
  });

  it("waits for Circle's attestation without blocking payouts (D6)", async () => {
    cctp.holdAttestation = true;
    await expect(runRefillPump(refillDeps())).rejects.toBeInstanceOf(RefillPending);
    expect((await bb.withTransaction((tx) => activeRefill(tx)))?.status).toBe("attesting");

    const p = await createPayment();
    await deposit({ muxId: p.muxId, amount7: p.quote.assetAmount7 });
    await settleAll();
    expect((await load(p.id)).status).toBe("completed");

    cctp.holdAttestation = false;
    expect((await runRefillPump(refillDeps()))?.status).toBe("completed");
    expect(await float.balance()).toBe((await bb.withTransaction((tx) => floatPosition(tx))).balance6);
  });

  it("a crash after the burn landed finds it on the ledger: one burn, one fee", async () => {
    cctp.allowance7 = 10_000_000n; // no approve needed
    ledger.throwAfterLand = 1;
    const xlmBefore = (await balancesOf(TREASURY_ACCOUNT)).get(NATIVE_SAC) ?? 0n;
    await expect(runRefillPump(refillDeps())).rejects.toThrow(/crashed/);
    expect((await runRefillPump(refillDeps()))?.status).toBe("completed");
    expect(cctp.burns.size).toBe(1);
    expect(xlmBefore - ((await balancesOf(TREASURY_ACCOUNT)).get(NATIVE_SAC) ?? 0n)).toBe(100n);
  });

  it("a crash after the mint was broadcast finds the nonce used: one mint", async () => {
    cctp.throwAfterMint = 1;
    await expect(runRefillPump(refillDeps())).rejects.toThrow(/mint/);
    expect((await runRefillPump(refillDeps()))?.status).toBe("completed");
    expect(cctp.mints).toHaveLength(1);
    expect((await balancesOf(BASE_WALLET_ACCOUNT)).get(BASE_USDC)).toBeGreaterThan(0n);
  });

  it("a crash after settling the deposit credits the float once", async () => {
    float.throwOnBalance = 1;
    await expect(runRefillPump(refillDeps())).rejects.toThrow(/balance/);
    expect((await runRefillPump(refillDeps()))?.status).toBe("completed");
    expect(float.deposits.size).toBe(1);
    expect(await float.balance()).toBe((await bb.withTransaction((tx) => floatPosition(tx))).balance6);
  });

  it("refuses a deposit priced at another rate before settling it (nothing is credited)", async () => {
    float.rate = "5.5";
    expect((await runRefillPump(refillDeps()))?.status).toBe("failed");
    expect([...float.deposits.values()].every((d) => !d.settled)).toBe(true);
  });

  it("a burn that fails on the ledger fails the refill (fee booked, no USDC moved) and cools down", async () => {
    cctp.allowance7 = 10_000_000n;
    ledger.failOnLedger = 1;
    const usdcBefore = (await balancesOf(TREASURY_ACCOUNT)).get(CIRCLE_SAC) ?? 0n;
    expect((await runRefillPump(refillDeps()))?.status).toBe("failed");
    expect((await balancesOf(TREASURY_ACCOUNT)).get(CIRCLE_SAC)).toBe(usdcBefore);
    expect(await runRefillPump(refillDeps())).toBeNull(); // within the cool-down, no new refill starts
  });
});
