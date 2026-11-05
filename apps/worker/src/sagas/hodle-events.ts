// Hodle payout webhooks (§3.6), the `inbox.hodle` consumer. In the sandbox the payout's 202 response is final, so a
// webhook mostly confirms what we know. It matters when our call's outcome was unknown: PAYOUT_SUCCESSFUL completes a
// payout still in flight, PAYOUT_FAILED fails it (and refunds). Bodies are matched by externalId, or by the payout's
// on-chain hash (`invoice`) when Hodle omits it; which ids the sandbox really sends is T-007's probe (§11 Q1).
// PAYOUT_REFUNDED (a MED reversal) is only logged for review until T-007 records its body. DEPOSIT_* is the refill
// saga's (T-016).
import { parseUnits } from "@vants/adapter-hodle";
import { confirmPayout, getPayment, type InboxRecord, type Tx, updatePayout } from "@vants/db";
import { applyToPayment } from "./apply.ts";
import type { SagaDeps } from "./ports.ts";

const text = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : undefined);

async function paymentFor(tx: Tx, data: Record<string, unknown>): Promise<string | null> {
  const externalId = text(data.externalId);
  if (externalId) {
    const r = await tx.query<{ payment_id: string }>("SELECT payment_id FROM payouts WHERE external_id = $1", [
      externalId,
    ]);
    if (r.rows[0]) return r.rows[0].payment_id;
  }
  const invoice = text(data.invoice) ?? text(data.txHash);
  if (invoice) {
    const r = await tx.query<{ payment_id: string }>("SELECT payment_id FROM payouts WHERE response->>'txHash' = $1", [
      invoice,
    ]);
    if (r.rows[0]) return r.rows[0].payment_id;
  }
  return null;
}

export async function onHodleRecord(tx: Tx, record: InboxRecord, deps: SagaDeps): Promise<void> {
  const { event, data } = record.payload as { event: string; data: Record<string, unknown> };
  if (!event.startsWith("PAYOUT_")) return;
  const paymentId = await paymentFor(tx, data);
  if (!paymentId) {
    console.warn(`[hodle] ${event} (${record.dedupeKey}) matches no payout: kept in the inbox for review`);
    return;
  }
  const rec = await getPayment(tx, paymentId, { forUpdate: true });
  const status = rec?.payment.status;
  const inFlight = status === "funded" || status === "paying";

  if (event === "PAYOUT_SUCCESSFUL") {
    await confirmPayout(tx, `vants:${paymentId}`);
    if (!inFlight) return;
    const quote = data.quote as { assetAmount?: unknown } | undefined;
    await applyToPayment(
      tx,
      deps,
      paymentId,
      {
        type: "payout.succeeded",
        transactionId: text(data.transactionId) ?? "",
        endToEndId: text(data.endToEndId) ?? "",
        txHash: text(data.txHash) ?? text(data.invoice) ?? "",
        debit6: parseUnits(text(quote?.assetAmount) ?? "0", 6),
      },
      record.id,
    );
    await updatePayout(tx, paymentId, { status: "completed", transactionId: text(data.transactionId) ?? "" });
  } else if (event === "PAYOUT_FAILED") {
    const reason = `Hodle PAYOUT_FAILED: ${text(data.errorDescription) ?? text(data.errorCode) ?? "no reason given"}`;
    if (!inFlight) {
      console.error(`[hodle] ${reason} for payment ${paymentId} in ${status}: needs review`);
      return;
    }
    await applyToPayment(tx, deps, paymentId, { type: "payout.failed", reason }, record.id);
    await updatePayout(tx, paymentId, { status: "failed", lastError: reason });
  } else {
    console.error(`[hodle] ${event} for payment ${paymentId}: not handled until T-007 records its body; needs review`);
  }
}
