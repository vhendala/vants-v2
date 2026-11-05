// INV-05: Vants validates every BR Code before quoting and before paying (the Hodle sandbox accepts anything).
// Cases from the spike's hodle:brcode validation probes (SOURCES.md).
import { describe, expect, it } from "vitest";
import { buildStaticBrCode, withFixedCrc } from "./emv.ts";
import { checkBrCodeForPayout } from "./guard.ts";

const merchant = { key: "pix-spike@vants.example.com", merchantName: "VANTS TESTE", merchantCity: "SAO PAULO" };
const withAmount = buildStaticBrCode({ ...merchant, amountCents: 1234 });
const noAmount = buildStaticBrCode(merchant);

describe("checkBrCodeForPayout", () => {
  it("accepts a valid code whose amount equals the payout value", () => {
    expect(checkBrCodeForPayout(withAmount, 1234)).toMatchObject({
      ok: true,
      amountCents: 1234,
      key: merchant.key,
      merchantName: "VANTS TESTE",
      merchantCity: "SAO PAULO",
      isDynamic: false,
    });
  });

  it("accepts an amount-less code at any positive value", () => {
    expect(checkBrCodeForPayout(noAmount, 700)).toMatchObject({ ok: true, amountCents: undefined });
  });

  it("rejects an amount mismatch (sandbox paid R$ 1.00 against a R$ 12.34 code)", () => {
    expect(checkBrCodeForPayout(withAmount, 100)).toMatchObject({ ok: false, reason: "AMOUNT_MISMATCH" });
  });

  it("rejects a corrupted CRC", () => {
    const bad = `${withAmount.slice(0, -4)}0000`;
    expect(checkBrCodeForPayout(bad, 1234)).toMatchObject({ ok: false, reason: "INVALID_BR_CODE" });
  });

  it("rejects a truncated code and arbitrary text", () => {
    expect(checkBrCodeForPayout(withAmount.slice(0, 40), 1234)).toMatchObject({ ok: false, reason: "INVALID_BR_CODE" });
    expect(checkBrCodeForPayout("not-a-pix", 100)).toMatchObject({ ok: false, reason: "INVALID_BR_CODE" });
  });

  it("rejects a non-positive or fractional payout value", () => {
    expect(checkBrCodeForPayout(noAmount, 0)).toMatchObject({ ok: false, reason: "INVALID_VALUE" });
    expect(checkBrCodeForPayout(noAmount, 12.5)).toMatchObject({ ok: false, reason: "INVALID_VALUE" });
  });

  it("explains invalid codes with the parser's error codes", () => {
    const r = checkBrCodeForPayout(withFixedCrc(withAmount.replace("br.gov.bcb.pix", "br.gov.bcb.xyz")), 1234);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toContain("NOT_PIX");
  });
});
