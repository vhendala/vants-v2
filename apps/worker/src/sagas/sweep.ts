// The sweep (INV-03), every minute: expires payments that never got a deposit, and wakes both pumps so a lost or
// exhausted wake-up job can't leave a payout or refund behind. The work lists are in the database, so waking is enough.
import { expiredAwaitingPayments } from "@vants/db";
import { applyToPayment } from "./apply.ts";
import type { SagaDeps } from "./ports.ts";
import { PAYOUT_PUMP, REFUND_PUMP } from "./queues.ts";

/** How long after its quote expires a payment keeps waiting: a deposit whose ledger closed in time may reach us late. */
export const DEPOSIT_GRACE_SECONDS = 300;

export async function sweep(deps: SagaDeps): Promise<{ expired: number }> {
  const cutoff = new Date(deps.now().getTime() - DEPOSIT_GRACE_SECONDS * 1000);
  const ids = await deps.backbone.withTransaction((tx) => expiredAwaitingPayments(tx, cutoff));
  for (const id of ids) {
    await deps.backbone.withTransaction((tx) => applyToPayment(tx, deps, id, { type: "deposit.timeout" }));
  }
  await deps.backbone.withTransaction(async (tx) => {
    await deps.backbone.enqueue(tx, PAYOUT_PUMP);
    await deps.backbone.enqueue(tx, REFUND_PUMP);
  });
  return { expired: ids.length };
}
