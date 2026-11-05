// The float (SPEC §3.7, T-015). A funded payment reserves the USDH its payout will take; the payout's end releases it (the
// ledger already holds the debit by then, posted with PayoutCompleted). A payout that takes the float below its minimum
// emits FloatLow once, on the way down: the refill saga's trigger (T-016).
import { floatPosition, getPayment, releaseFloat, reserveFloat, type Tx } from "@vants/db";
import { type DomainEvent, payoutDebit6, topUpNeeded } from "@vants/domain";
import type { FloatDeps } from "./ports.ts";

export const FLOAT_SAGA = "float-saga";
export const FLOAT_EVENTS = ["PayoutRequested", "PayoutCompleted", "PayoutFailed"];

export async function onFloatEvent(tx: Tx, event: DomainEvent, deps: FloatDeps): Promise<void> {
  const paymentId = event.aggregate.id;
  if (event.type === "PayoutRequested") {
    const rec = await getPayment(tx, paymentId);
    if (!rec) throw new Error(`float reservation for unknown payment ${paymentId}`);
    const q = rec.payment.quote;
    await reserveFloat(
      tx,
      paymentId,
      payoutDebit6({ valueCents: q.valueCents, feeCents: q.feeCents, rateMicros: q.rateMicros }),
    );
    return;
  }
  await releaseFloat(tx, paymentId);
  if (event.type !== "PayoutCompleted") return;

  const debit6 = BigInt((event.payload as { debit6?: string }).debit6 ?? "0");
  const pos = await floatPosition(tx);
  const min = deps.float.minMicros;
  if (!pos.opened || pos.balance6 >= min || pos.balance6 + debit6 < min) return; // only on crossing the minimum
  await deps.backbone.publish(tx, [
    {
      type: "FloatLow",
      version: 1,
      aggregate: { type: "float", id: "hodle" },
      correlationId: "float:hodle",
      causationId: event.id,
      payload: {
        balance6: pos.balance6.toString(),
        reserved6: pos.reserved6.toString(),
        min6: min.toString(),
        target6: deps.float.targetMicros.toString(),
        topUp6: topUpNeeded(pos.balance6, { minMicros: min, targetMicros: deps.float.targetMicros }).toString(),
      },
    },
  ]);
}
