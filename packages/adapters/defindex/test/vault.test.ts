// Ported from the spike's test/float-defindex.test.ts ("DeFindex share maths", same author), plus a property.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { sharesForUnderlying, underlyingForShares } from "../src/vault.ts";

describe("DeFindex share maths", () => {
  const appreciated = { totalSupply: 1_000_0000000n, totalAmount: 1_037_1234567n }; // share price ≈ 1.0371

  it("is 1:1 on a vault with no yield", () => {
    expect(sharesForUnderlying(25_000_000n, { totalSupply: 10n ** 10n, totalAmount: 10n ** 10n })).toBe(25_000_000n);
  });

  it("rounds shares up so the debit always covers the amount", () => {
    for (const amount of [1n, 2_285_1852n, 18_516_6667n, 999_999_9999n]) {
      const shares = sharesForUnderlying(amount, appreciated);
      expect(underlyingForShares(shares, appreciated)).toBeGreaterThanOrEqual(amount);
      expect(underlyingForShares(shares - 1n, appreciated)).toBeLessThan(amount);
    }
  });

  it("covers any amount with the fewest shares, at any share price", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 15n }),
        fc.bigInt({ min: 1n, max: 10n ** 15n }),
        fc.bigInt({ min: 1n, max: 10n ** 12n }),
        (totalSupply, totalAmount, amount) => {
          const s = { totalSupply, totalAmount };
          const shares = sharesForUnderlying(amount, s);
          expect(underlyingForShares(shares, s)).toBeGreaterThanOrEqual(amount);
          if (shares > 0n) expect(underlyingForShares(shares - 1n, s)).toBeLessThan(amount);
        },
      ),
    );
  });

  it("refuses an empty vault", () => {
    expect(() => sharesForUnderlying(1n, { totalSupply: 0n, totalAmount: 0n })).toThrow();
    expect(underlyingForShares(5n, { totalSupply: 0n, totalAmount: 0n })).toBe(0n);
  });
});
