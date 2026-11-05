// INV-05: the check every BR Code passes before Vants quotes it and again before it is paid.
// The Hodle sandbox accepts any string as `qrCode` (amount mismatch, bad CRC, truncated, arbitrary text all paid),
// so this validation can't be delegated to the payout provider. Ported from the spike's checkBrCodeForPayout.
import { type BrCodeErrorCode, parseBrCode } from "./emv.ts";

export type BrCodeCheck =
  | {
      ok: true;
      /** Present when the code fixes its own amount; then the payout value must equal it. */
      amountCents: number | undefined;
      key: string | undefined;
      merchantName: string;
      merchantCity: string;
      isDynamic: boolean;
    }
  | {
      ok: false;
      reason: "INVALID_VALUE" | "INVALID_BR_CODE" | "AMOUNT_MISMATCH";
      message: string;
      errors: BrCodeErrorCode[];
    };

export function checkBrCodeForPayout(code: string, valueCents: number): BrCodeCheck {
  if (!Number.isSafeInteger(valueCents) || valueCents <= 0) {
    return {
      ok: false,
      reason: "INVALID_VALUE",
      message: `payout value must be a positive integer of cents, got ${valueCents}`,
      errors: [],
    };
  }
  const p = parseBrCode(code);
  if (!p.ok) {
    return {
      ok: false,
      reason: "INVALID_BR_CODE",
      message: p.errors.map((e) => `${e.code}: ${e.message}`).join("; "),
      errors: p.errors.map((e) => e.code),
    };
  }
  if (p.code.amountCents !== undefined && p.code.amountCents !== valueCents) {
    return {
      ok: false,
      reason: "AMOUNT_MISMATCH",
      message: `BR Code amount ${p.code.amountCents} ≠ payout value ${valueCents}`,
      errors: [],
    };
  }
  return {
    ok: true,
    amountCents: p.code.amountCents,
    key: p.code.key,
    merchantName: p.code.merchantName,
    merchantCity: p.code.merchantCity,
    isDynamic: p.code.isDynamic,
  };
}
