// The Vants Pay v0 resources as integrators see them (SPEC §5.1, §5.2): one read model for `GET /v0/payments/:id` and for
// the notifier's webhook body, so the two can't drift (DEC-026). Muxed-address encoding needs the Stellar SDK, so the
// apps pass it in as `deposit`.
import { formatAmount7, formatBrl, formatRate } from "@vants/domain";
import { getPayment, getQuote, paymentTimeline, type QuoteRecord } from "./repos.ts";
import type { Tx } from "./tx.ts";

/** Where to pay: the treasury's M… address for this muxed id, and the G… + memo-id fallback. */
export type DepositAddress = (muxId: string) => { address: string; account: string; memoId: string };

export interface QuoteResource {
  id: string;
  destination:
    | { type: "br_code"; payee: { name: string; city: string; key?: string }; isDynamic: boolean }
    | { type: "pix_key"; key: string; keyType: "CPF" | "CNPJ" | "EMAIL" | "PHONE" | "RANDOM" };
  amountBrl: string;
  feeBrl: string;
  asset: string;
  assetAmount: string;
  rate: string;
  expiresAt: string;
}

export interface DepositResource {
  address: string;
  account: string;
  memoId: string;
  asset: string;
  amount: string;
  expiresAt: string;
}

export interface PaymentResource {
  id: string;
  status: string;
  quote: QuoteResource;
  deposit: DepositResource;
  funding: { txHash: string; ledgerClosedAt: string; amount: string } | null;
  payout: { endToEndId: string; txHash: string } | null;
  refunds: { amount: string; reason: string; status: "requested" | "sent"; txHash: string | null }[];
  timeline: { status: string; at: string }[];
}

export function quoteResource(q: QuoteRecord): QuoteResource {
  return {
    id: q.id,
    destination:
      q.destination.type === "br_code"
        ? { type: "br_code", payee: q.destination.payee, isDynamic: q.destination.isDynamic }
        : { type: "pix_key", key: q.destination.key, keyType: q.destination.keyType },
    amountBrl: formatBrl(q.valueCents),
    feeBrl: formatBrl(q.feeCents),
    asset: q.assetName,
    assetAmount: formatAmount7(q.assetAmount7),
    rate: formatRate(q.rateMicros),
    expiresAt: q.expiresAt,
  };
}

export function depositResource(q: QuoteRecord, muxId: string, deposit: DepositAddress): DepositResource {
  return { ...deposit(muxId), asset: q.assetName, amount: formatAmount7(q.assetAmount7), expiresAt: q.expiresAt };
}

/** The payment as `GET /v0/payments/:id` returns it; `null` if it doesn't exist (or isn't this integrator's). */
export async function paymentResource(
  tx: Tx,
  id: string,
  opts: { integratorId?: string; deposit: DepositAddress },
): Promise<PaymentResource | null> {
  const rec = await getPayment(tx, id, opts.integratorId ? { integratorId: opts.integratorId } : {});
  if (!rec) return null;
  const q = await getQuote(tx, rec.quoteId, rec.integratorId);
  if (!q) return null;
  const p = rec.payment;
  const funding = p.deposits.find((d) => d.kind === "exact" || d.kind === "over");
  return {
    id: p.id,
    status: p.status,
    quote: quoteResource(q),
    deposit: depositResource(q, p.muxId, opts.deposit),
    funding: funding
      ? { txHash: funding.txHash, ledgerClosedAt: funding.ledgerClosedAt, amount: formatAmount7(funding.amount7) }
      : null,
    payout: p.payout ? { endToEndId: p.payout.endToEndId, txHash: p.payout.txHash } : null,
    refunds: p.refunds.map((r) => ({
      amount: formatAmount7(r.amount7),
      reason: r.reason,
      status: r.status,
      txHash: r.txHash ?? null,
    })),
    timeline: await paymentTimeline(tx, p.id),
  };
}
