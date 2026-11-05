// §3.7 pricing. The expected figures are the spike's measured sandbox debits and its tested quote maths (SOURCES.md).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { exactUsdhDeposit, hodleFeeCents, payoutDebit6, priceQuote, rateToMicros, topUpNeeded } from "./pricing.ts";

const SANDBOX = rateToMicros("5.4");

describe("rateToMicros", () => {
  it("parses decimal rates exactly, without floats", () => {
    expect(rateToMicros("5.4")).toBe(5_400_000n);
    expect(rateToMicros("5.123456")).toBe(5_123_456n);
    expect(rateToMicros("6")).toBe(6_000_000n);
    expect(() => rateToMicros("0")).toThrow();
    expect(() => rateToMicros("5.1234567")).toThrow();
    expect(() => rateToMicros("abc")).toThrow();
  });
});

describe("priceQuote (7-decimal asset to collect, rounded up)", () => {
  it("matches the spike at the sandbox rate", () => {
    expect(priceQuote({ valueCents: 1234, rateMicros: SANDBOX, feeModel: "sandbox" }).assetAmount7).toBe(22_851_852n);
    expect(priceQuote({ valueCents: 9999, rateMicros: SANDBOX, feeModel: "sandbox" }).assetAmount7).toBe(185_166_667n);
    expect(priceQuote({ valueCents: 5400, rateMicros: SANDBOX, feeModel: "sandbox" }).assetAmount7).toBe(100_000_000n);
  });

  it("adds Hodle's documented default fee, R$ 1.50 + 2.5%", () => {
    expect(hodleFeeCents(5000, "hodle-default")).toBe(275); // the docs' worked example
    const q = priceQuote({ valueCents: 1000, rateMicros: SANDBOX, feeModel: "hodle-default" });
    expect(q.feeCents).toBe(175);
    expect(q.totalCents).toBe(1175);
  });

  it("rejects non-integer or non-positive values", () => {
    expect(() => priceQuote({ valueCents: 12.5, rateMicros: SANDBOX, feeModel: "sandbox" })).toThrow();
    expect(() => priceQuote({ valueCents: 0, rateMicros: SANDBOX, feeModel: "sandbox" })).toThrow();
  });

  it("always collects at least what the total is worth (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10_000_000 }), fc.integer({ min: 1_000_000, max: 20_000_000 }), (v, r) => {
        const q = priceQuote({ valueCents: v, rateMicros: BigInt(r), feeModel: "sandbox" });
        // assetAmount7 / 1e7 * rate >= totalCents / 100, i.e. assetAmount7 * rateMicros >= totalCents * 1e11
        expect(q.assetAmount7 * BigInt(r)).toBeGreaterThanOrEqual(BigInt(q.totalCents) * 10n ** 11n);
        // ...and by less than one stroop's worth
        expect((q.assetAmount7 - 1n) * BigInt(r)).toBeLessThan(BigInt(q.totalCents) * 10n ** 11n);
      }),
    );
  });
});

describe("payoutDebit6 (6-decimal USDH the float pays, truncated)", () => {
  it("matches the sandbox's measured debits", () => {
    expect(payoutDebit6({ valueCents: 100, feeCents: 0, rateMicros: SANDBOX })).toBe(185_185n);
    expect(payoutDebit6({ valueCents: 1234, feeCents: 0, rateMicros: SANDBOX })).toBe(2_285_185n);
    expect(payoutDebit6({ valueCents: 700, feeCents: 0, rateMicros: SANDBOX })).toBe(1_296_296n);
    expect(payoutDebit6({ valueCents: 6000, feeCents: 0, rateMicros: SANDBOX })).toBe(11_111_111n);
  });
});

describe("topUpNeeded", () => {
  const policy = { minMicros: 15_000_000n, targetMicros: 30_000_000n };
  it("tops up to the target only below the minimum", () => {
    expect(topUpNeeded(15_000_000n, policy)).toBe(0n);
    expect(topUpNeeded(13_844_446n, policy)).toBe(16_155_554n);
    expect(() => topUpNeeded(1n, { minMicros: 2n, targetMicros: 1n })).toThrow();
  });
});

describe("exactUsdhDeposit (T-016)", () => {
  it("buys at most the wanted USDH, exactly, at any rate", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 100_000_000_000n }),
        fc.bigInt({ min: 1_000_000n, max: 9_999_999n }),
        (want6, rate) => {
          const { cents, credit6 } = exactUsdhDeposit(want6, rate);
          expect(credit6).toBeLessThanOrEqual(want6);
          expect((BigInt(cents) * 10n ** 10n) % rate).toBe(0n);
          expect((BigInt(cents) * 10n ** 10n) / rate).toBe(credit6);
        },
      ),
    );
  });

  it("at the sandbox rate 5.4, 1 USDC buys exactly 1 USDH for R$ 5.40", () => {
    expect(exactUsdhDeposit(1_000_000n, 5_400_000n)).toEqual({ cents: 540, credit6: 1_000_000n });
    expect(exactUsdhDeposit(1_234_567n, 5_400_000n)).toEqual({ cents: 648, credit6: 1_200_000n });
  });
});
