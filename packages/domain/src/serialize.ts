// Payment ⇄ JSON for persistence (T-010). The domain keeps money in bigint; JSON keeps it as decimal strings.
import type { Payment } from "./payment.ts";

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export function paymentToJson(p: Payment): Json {
  return JSON.parse(JSON.stringify(p, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

const big = (v: unknown): bigint => {
  if (typeof v !== "string" || !/^-?\d+$/.test(v))
    throw new Error(`expected an integer string, got ${JSON.stringify(v)}`);
  return BigInt(v);
};

export function paymentFromJson(json: unknown): Payment {
  const p = json as Payment & Record<string, unknown>;
  return {
    ...p,
    quote: { ...p.quote, assetAmount7: big(p.quote.assetAmount7), rateMicros: big(p.quote.rateMicros) },
    deposits: p.deposits.map((d) => ({ ...d, amount7: big(d.amount7) })),
    refunds: p.refunds.map((r) => ({ ...r, amount7: big(r.amount7) })),
    ...(p.payout ? { payout: { ...p.payout, debit6: big(p.payout.debit6) } } : {}),
  };
}
