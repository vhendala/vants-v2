// The payout saga (§3.4, DEC-008). `PayoutRequested` puts the payment on the payout list; the pump pays the list oldest
// first, one Hodle call at a time. Hodle is called outside any transaction, after the payment is marked `paying`, and
// always with externalId "vants:<paymentId>", which Hodle deduplicates: a retry after any crash finds the original
// payout instead of paying twice (INV-02). The BR Code is checked again just before the call (INV-05).
import { HodleError, type PayoutRequest, type PayoutResult, toPayoutInput } from "@vants/adapter-hodle";
import { getPayment, getQuote, insertPayout, nextOpenPayout, payoutExternalId, type Tx, updatePayout } from "@vants/db";
import { type DomainEvent, InvalidTransition, type PaymentInput } from "@vants/domain";
import { checkBrCodeForPayout } from "@vants/pix";
import { applyToPayment } from "./apply.ts";
import type { PayoutDeps, SagaDeps } from "./ports.ts";
import { PAYOUT_PUMP } from "./queues.ts";

/** The pump stopped on a payout it can't finish yet (float empty, Hodle busy or down, payout still processing). */
export class PayoutPending extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayoutPending";
  }
}

export async function onPayoutRequested(tx: Tx, event: DomainEvent, deps: SagaDeps): Promise<void> {
  await insertPayout(tx, event.aggregate.id);
  await deps.backbone.enqueue(tx, PAYOUT_PUMP);
}

/** Pays every open payout, oldest first. Throws `PayoutPending` to stop (and be retried) without skipping the queue. */
export async function runPayoutPump(deps: PayoutDeps): Promise<number> {
  let handled = 0;
  for (;;) {
    const paymentId = await deps.backbone.withTransaction((tx) => nextOpenPayout(tx));
    if (!paymentId) return handled;
    await payOne(paymentId, deps);
    handled += 1;
  }
}

const json = (r: PayoutResult) => ({ ...r, debit6: r.debit6.toString() });

async function payOne(paymentId: string, deps: PayoutDeps): Promise<void> {
  const request = await deps.backbone.withTransaction(async (tx): Promise<PayoutRequest | null> => {
    const rec = await getPayment(tx, paymentId, { forUpdate: true });
    if (!rec) throw new Error(`payout for unknown payment ${paymentId}`);
    const p = rec.payment;
    if (p.status !== "funded" && p.status !== "paying") {
      // Settled some other way (e.g. Hodle's PAYOUT_FAILED webhook): nothing left to pay.
      await updatePayout(tx, paymentId, { status: p.status === "completed" ? "completed" : "cancelled" });
      return null;
    }
    const quote = await getQuote(tx, rec.quoteId, rec.integratorId);
    if (!quote) throw new Error(`payment ${paymentId} has no quote`);
    const dest = quote.destination;
    if (dest.type === "br_code") {
      const check = checkBrCodeForPayout(dest.brCode, p.quote.valueCents);
      if (!check.ok) {
        const reason = `BR Code refused before payout (${check.reason}): ${check.message}`;
        await applyToPayment(tx, deps, paymentId, { type: "payout.failed", reason });
        await updatePayout(tx, paymentId, { status: "failed", lastError: reason });
        return null;
      }
    }
    if (p.status === "funded") await applyToPayment(tx, deps, paymentId, { type: "payout.started" });
    await updatePayout(tx, paymentId, { status: "sent", attempt: true });
    return {
      valueCents: p.quote.valueCents,
      externalId: payoutExternalId(paymentId),
      ...(dest.type === "br_code" ? { qrCode: dest.brCode } : { pixKey: { key: dest.key, type: dest.keyType } }),
    };
  });
  if (!request) return;

  let result: PayoutResult;
  try {
    result = await deps.hodle.payout(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof HodleError && (err.kind === "settlement_failed" || err.kind === "invalid_request")) {
      await settle(paymentId, { type: "payout.failed", reason: message }, deps, { lastError: message });
      return;
    }
    // Empty float, busy wallet, Hodle down or an unknown outcome: stop here and ask again later with the same externalId.
    await deps.backbone.withTransaction((tx) => updatePayout(tx, paymentId, { lastError: message }));
    throw new PayoutPending(`payout ${paymentId}: ${message}`);
  }

  const input = toPayoutInput(result);
  if (!input) {
    const message = `Hodle status ${result.status}`;
    await deps.backbone.withTransaction((tx) =>
      updatePayout(tx, paymentId, { response: json(result), transactionId: result.transactionId, lastError: message }),
    );
    throw new PayoutPending(`payout ${paymentId}: ${message}`);
  }
  await settle(paymentId, input, deps, { transactionId: result.transactionId, response: json(result) });
}

async function settle(
  paymentId: string,
  input: PaymentInput,
  deps: PayoutDeps,
  extra: { transactionId?: string; response?: unknown; lastError?: string },
): Promise<void> {
  const status = input.type === "payout.succeeded" ? "completed" : "failed";
  await deps.backbone.withTransaction(async (tx) => {
    try {
      await applyToPayment(tx, deps, paymentId, input);
      await updatePayout(tx, paymentId, { status, ...extra });
    } catch (err) {
      if (!(err instanceof InvalidTransition)) throw err;
      // The payment moved on meanwhile (a webhook settled it): keep Hodle's answer for review, change nothing else.
      await updatePayout(tx, paymentId, { status, ...extra, lastError: `conflict: ${err.message}` });
    }
  });
}
