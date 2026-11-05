// Amount formatting for the API and for classic operations (pure, no I/O).

/** 7-decimal integer → the decimal string classic operations take ("2.2851852"). */
export function formatAmount7(amount7: bigint): string {
  if (amount7 <= 0n) throw new Error("amount must be positive");
  const whole = amount7 / 10_000_000n;
  const frac = (amount7 % 10_000_000n).toString().padStart(7, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** BRL cents → "12.34". */
export const formatBrl = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

/** A rate in millionths → its shortest decimal ("5.4"). */
export function formatRate(micros: bigint): string {
  const s = `${micros / 1_000_000n}.${(micros % 1_000_000n).toString().padStart(6, "0")}`.replace(/\.?0+$/, "");
  return s || "0";
}
