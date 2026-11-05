// Payments persist as JSON (T-010): bigint amounts become decimal strings and come back exactly.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decide, newPayment, type Payment } from "./payment.ts";
import { paymentFromJson, paymentToJson } from "./serialize.ts";

const big = fc.bigInt({ min: 0n, max: 2n ** 70n });

describe("payment JSON", () => {
  it("round-trips any payment, including every bigint field", () => {
    fc.assert(
      fc.property(big, big, big, big, (assetAmount7, rateMicros, amount7, debit6) => {
        let p: Payment = newPayment({
          id: "pay_x",
          muxId: "18446744073709551615",
          refundTo: "GREFUND",
          quote: {
            asset: "CSAC",
            assetAmount7,
            valueCents: 1234,
            feeCents: 0,
            rateMicros,
            expiresAt: "2026-10-22T12:00:00.000Z",
          },
        });
        p = decide(p, {
          type: "deposit.observed",
          depositId: "d1",
          asset: "CSAC",
          amount7: assetAmount7 + amount7,
          from: "GFROM",
          ledgerClosedAt: "2026-10-22T11:59:00.000Z",
          txHash: "h",
        }).payment;
        if (p.status === "funded") {
          p = decide(p, { type: "payout.succeeded", transactionId: "t", endToEndId: "e", txHash: "x", debit6 }).payment;
        }
        const json = JSON.parse(JSON.stringify(paymentToJson(p)));
        expect(paymentFromJson(json)).toEqual(p);
      }),
    );
  });

  it("writes amounts as decimal strings (JSON-safe, no precision loss)", () => {
    const p = newPayment({
      id: "pay_y",
      muxId: "7",
      quote: {
        asset: "C",
        assetAmount7: 2n ** 64n,
        valueCents: 1,
        feeCents: 0,
        rateMicros: 5_400_000n,
        expiresAt: "t",
      },
    });
    const json = paymentToJson(p) as { quote: { assetAmount7: unknown; rateMicros: unknown } };
    expect(json.quote.assetAmount7).toBe("18446744073709551616");
    expect(json.quote.rateMicros).toBe("5400000");
  });
});
