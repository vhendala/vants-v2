// §3.7 pricing, in integers only: BRL in cents, rates in millionths, Stellar assets in 7-decimal stroops, USDH in
// 6-decimal micros. Ported from the spike's src/float/pricing.ts and expectedUsdhDebit (T-005).

export type FeeModel = "sandbox" | "hodle-default";

/** "5.4" → 5_400_000n (BRL per USD, at most 6 decimals). */
export function rateToMicros(rate: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(rate);
  if (!m) throw new Error(`invalid rate "${rate}"`);
  const micros = BigInt(m[1] ?? "0") * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0"));
  if (micros <= 0n) throw new Error(`rate must be positive, got "${rate}"`);
  return micros;
}

/** Hodle's documented default payout fee on stablecoin networks: R$ 1.50 + 2.5% of the value, rounded up. */
export function hodleFeeCents(valueCents: number, model: FeeModel): number {
  if (model === "sandbox") return 0;
  return 150 + Math.floor((valueCents * 25 + 999) / 1000);
}

export interface PricedQuote {
  valueCents: number;
  feeCents: number;
  totalCents: number;
  rateMicros: bigint;
  /** What the user sends, rounded up to the stroop so it always covers the total. */
  assetAmount7: bigint;
}

export function priceQuote(input: { valueCents: number; rateMicros: bigint; feeModel: FeeModel }): PricedQuote {
  const { valueCents, rateMicros, feeModel } = input;
  if (!Number.isSafeInteger(valueCents) || valueCents <= 0) throw new Error(`invalid value ${valueCents}`);
  if (rateMicros <= 0n) throw new Error("rate must be positive");
  const feeCents = hodleFeeCents(valueCents, feeModel);
  const totalCents = valueCents + feeCents;
  // cents / 100 × 1e7 ÷ (rateMicros / 1e6) = cents × 1e11 ÷ rateMicros, rounded up
  const scaled = BigInt(totalCents) * 10n ** 11n;
  const assetAmount7 = (scaled + rateMicros - 1n) / rateMicros;
  return { valueCents, feeCents, totalCents, rateMicros, assetAmount7 };
}

/** USDH (6 decimals) the float pays for a payout, truncated as the Hodle sandbox does. */
export function payoutDebit6(input: { valueCents: number; feeCents: number; rateMicros: bigint }): bigint {
  // cents / 100 × 1e6 ÷ (rateMicros / 1e6) = cents × 1e10 ÷ rateMicros, truncated
  return (BigInt(input.valueCents + input.feeCents) * 10n ** 10n) / input.rateMicros;
}

export interface FloatPolicy {
  /** Rebalance when the float drops below this (USD micros). */
  minMicros: bigint;
  /** Rebalance up to this (USD micros). */
  targetMicros: bigint;
}

/** USD micros to top up after a payment, or 0 while the float is at or above its minimum. */
export function topUpNeeded(floatMicros: bigint, policy: FloatPolicy): bigint {
  if (policy.targetMicros < policy.minMicros) throw new Error("target must be ≥ min");
  return floatMicros < policy.minMicros ? policy.targetMicros - floatMicros : 0n;
}

/**
 * The largest sandbox USDH deposit (in BRL cents) whose credit is exact at `rateMicros`, and that credit (6 decimals), with
 * credit ≤ `want6`. Hodle answers a deposit with its rate, not the USDH credited, so an exact amount lets the books and the
 * balance poll agree to the unit (T-016). At 5.4 that means multiples of 27 cents (0.05 USDH).
 */
export function exactUsdhDeposit(want6: bigint, rateMicros: bigint): { cents: number; credit6: bigint } {
  if (rateMicros <= 0n) throw new Error("rate must be positive");
  let cents = (want6 * rateMicros) / 10n ** 10n;
  // cents × 1e10 must divide by the rate; the step that guarantees it is rate / gcd(rate, 1e10).
  const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b));
  const step = rateMicros / gcd(rateMicros, 10n ** 10n);
  cents -= cents % step;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("deposit too large");
  return { cents: Number(cents), credit6: (cents * 10n ** 10n) / rateMicros };
}
