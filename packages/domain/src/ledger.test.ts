// INV-06 and INV-03 as properties: over random payment histories, every event's postings sum to zero per asset, and a
// settled payment leaves its clearing account at exactly zero (each deposit was either used for the payout or refunded).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  BASE_USDC,
  BASE_WALLET_ACCOUNT,
  BRIDGE_ACCOUNT,
  balances,
  CAPITAL_ACCOUNT,
  FEES_ACCOUNT,
  FLOAT_ACCOUNT,
  postingsFor,
  SANDBOX_STANDIN_ACCOUNT,
  sumByAsset,
  TREASURY_ACCOUNT,
  USDH,
} from "./ledger.ts";
import { decide, isSettled, newPayment, type Payment, type PaymentInput } from "./payment.ts";

const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const OTHER = "CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU";
const EXPIRES = "2026-10-22T12:02:00.000Z";

const depositArb = fc.record({
  rightAsset: fc.boolean(),
  /** amount relative to the quote: under, exact or over */
  delta: fc.oneof(fc.constant(0n), fc.bigInt({ min: -1_000_000n, max: -1n }), fc.bigInt({ min: 1n, max: 1_000_000n })),
  late: fc.boolean(),
});

const scenarioArb = fc.record({
  assetAmount7: fc.bigInt({ min: 1_000_001n, max: 10_000_000_000n }),
  deposits: fc.array(depositArb, { minLength: 0, maxLength: 3 }),
  timeoutFirst: fc.boolean(),
  outcome: fc.constantFrom("succeeded", "failed", "reversed"),
  returnedCents: fc.integer({ min: 1, max: 2000 }),
});

describe("ledger", () => {
  it("postings balance per asset, and settled payments leave clearing at zero", () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        let p: Payment = newPayment({
          id: "pay_p",
          muxId: "7",
          quote: {
            asset: USDC,
            assetAmount7: s.assetAmount7,
            valueCents: 1234,
            feeCents: 0,
            rateMicros: 5_400_000n,
            expiresAt: EXPIRES,
          },
        });
        const postings: ReturnType<typeof postingsFor> = [];
        const apply = (input: PaymentInput) => {
          const r = decide(p, input);
          p = r.payment;
          for (const e of r.events) {
            const ps = postingsFor(e);
            for (const v of sumByAsset(ps).values()) expect(v).toBe(0n);
            postings.push(...ps);
          }
        };

        if (s.timeoutFirst) apply({ type: "deposit.timeout" });
        for (const [i, d] of s.deposits.entries()) {
          apply({
            type: "deposit.observed",
            depositId: `dep_${i}`,
            asset: d.rightAsset ? USDC : OTHER,
            amount7: s.assetAmount7 + d.delta,
            from: "GSENDER",
            ledgerClosedAt: d.late ? "2026-10-22T12:05:00.000Z" : "2026-10-22T12:01:00.000Z",
            txHash: `tx_${i}`,
          });
        }
        if (!s.timeoutFirst) apply({ type: "deposit.timeout" });
        if (p.status === "funded") {
          apply({ type: "payout.started" });
          if (s.outcome === "failed") apply({ type: "payout.failed", reason: "x" });
          else {
            apply({ type: "payout.succeeded", transactionId: "t", endToEndId: "e", txHash: "h", debit6: 2_285_185n });
            if (s.outcome === "reversed")
              apply({ type: "payout.reversed", reversalId: "m", returnedCents: s.returnedCents });
          }
        }
        for (const r of p.refunds.filter((x) => x.status === "requested")) {
          apply({ type: "refund.sent", refundId: r.id, txHash: `rf_${r.id}` });
        }

        expect(isSettled(p)).toBe(true);
        const b = balances(postings);
        for (const v of sumByAsset(postings).values()) expect(v).toBe(0n);
        for (const asset of [USDC, OTHER]) expect(b.get(`clearing:pay_p|${asset}`) ?? 0n).toBe(0n);
        // The float only ever loses what payouts debited (reversals are refunded from the treasury in the PoC).
        expect((b.get(`${FLOAT_ACCOUNT}|USDH`) ?? 0n) <= 0n).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });
});

describe("money outside a payment (T-015)", () => {
  const draft = (type: string, payload: object, aggregate = { type: "deposit", id: "dep-1" }) => ({
    type,
    version: 1,
    aggregate,
    correlationId: aggregate.id,
    causationId: null,
    payload,
  });
  const zero = (type: string, payload: object) => {
    const sums = sumByAsset(postingsFor(draft(type, payload)));
    expect([...sums.values()].every((v) => v === 0n)).toBe(true);
    return balances(postingsFor(draft(type, payload)));
  };

  it("opens the books against capital, per account and asset", () => {
    const b = zero("LedgerOpened", {
      balances: [
        { account: TREASURY_ACCOUNT, asset: USDC, amount: "25000000" },
        { account: FLOAT_ACCOUNT, asset: USDH, amount: "22129634" },
      ],
    });
    expect(b.get(`${TREASURY_ACCOUNT}|${USDC}`)).toBe(25_000_000n);
    expect(b.get(`${CAPITAL_ACCOUNT}|${USDH}`)).toBe(-22_129_634n);
  });

  it("an unattributed deposit and its refund leave its clearing account at zero", () => {
    const inBooks = zero("UnattributedDeposit", { asset: USDC, amount7: "1000000" });
    const out = zero("RefundSent", { asset: USDC, amount7: "1000000" });
    expect((inBooks.get(`clearing:dep-1|${USDC}`) ?? 0n) + (out.get(`clearing:dep-1|${USDC}`) ?? 0n)).toBe(0n);
    expect(inBooks.get(`${TREASURY_ACCOUNT}|${USDC}`)).toBe(1_000_000n);
  });

  it("a top-up credits the treasury from capital; a network fee debits it to expenses", () => {
    expect(zero("TreasuryCredited", { asset: USDC, amount7: "5" }).get(`${CAPITAL_ACCOUNT}|${USDC}`)).toBe(-5n);
    const fee = zero("TreasuryFeePaid", { asset: OTHER, amount7: "100" });
    expect([fee.get(`${TREASURY_ACCOUNT}|${OTHER}`), fee.get(`${FEES_ACCOUNT}|${OTHER}`)]).toEqual([-100n, 100n]);
  });
});

describe("the refill (T-016)", () => {
  const ev = (type: string, payload: object) => ({
    type,
    version: 1,
    aggregate: { type: "refill", id: "rf-1" },
    correlationId: "rf-1",
    causationId: null,
    payload,
  });
  const balanced = (type: string, payload: object) => {
    const postings = postingsFor(ev(type, payload));
    expect(postings.length).toBeGreaterThan(0);
    expect([...sumByAsset(postings).values()].every((v) => v === 0n)).toBe(true);
    return balances(postings);
  };

  it("a burn moves treasury USDC into the bridge; the mint moves it out as Base USDC; the credit funds the float", () => {
    const burn = balanced("CctpBurned", { asset: USDC, burned7: "10000000" });
    expect(burn.get(`${TREASURY_ACCOUNT}|${USDC}`)).toBe(-10_000_000n);
    expect(burn.get(`${BRIDGE_ACCOUNT}|${USDC}`)).toBe(10_000_000n);

    const mint = balanced("CctpMinted", { asset: USDC, burned7: "10000000", minted6: "1000000" });
    expect(mint.get(`${BRIDGE_ACCOUNT}|${USDC}`)).toBe(-10_000_000n);
    expect(mint.get(`${BASE_WALLET_ACCOUNT}|${BASE_USDC}`)).toBe(1_000_000n);

    const credit = balanced("FloatCredited", { credit6: "1000000" });
    expect(credit.get(`${FLOAT_ACCOUNT}|${USDH}`)).toBe(1_000_000n);
    expect(credit.get(`${SANDBOX_STANDIN_ACCOUNT}|${USDH}`)).toBe(-1_000_000n);
  });
});
