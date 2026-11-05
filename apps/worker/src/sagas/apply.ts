// One step of the payment state machine, persisted with its events in the caller's transaction (§3.3).
import { getPayment, savePayment, type Tx } from "@vants/db";
import { decide, type Payment, type PaymentInput } from "@vants/domain";
import type { SagaDeps } from "./ports.ts";

export async function applyToPayment(
  tx: Tx,
  deps: Pick<SagaDeps, "backbone">,
  paymentId: string,
  input: PaymentInput,
  causationId: string | null = null,
): Promise<Payment> {
  const rec = await getPayment(tx, paymentId, { forUpdate: true });
  if (!rec) throw new Error(`no payment ${paymentId}`);
  const d = decide(rec.payment, input, causationId);
  await savePayment(tx, rec.payment, d.payment, input.type, causationId);
  await deps.backbone.publish(tx, d.events);
  return d.payment;
}
