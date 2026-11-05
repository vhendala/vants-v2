// The deposit matcher (§3.4): the Pier inbox consumer. Each transfer into the treasury is matched to its payment by
// muxed id (DEC-004) and fed to the state machine, which classifies it (exact, over, under, late, wrong asset,
// unexpected). Runs in the inbox transaction, so the deposit, the payment and its events commit together (INV-04).
import { type PierEnvelope, parseTransfer } from "@vants/adapter-pier";
import { sacMatchesAsset } from "@vants/adapter-stellar";
import { type DepositRow, getPaymentByMuxId, type InboxRecord, insertDeposit, savePayment, type Tx } from "@vants/db";
import { decide } from "@vants/domain";
import type { SagaDeps } from "./ports.ts";

export async function onPierRecord(tx: Tx, record: InboxRecord, deps: SagaDeps): Promise<void> {
  const { event } = record.payload as { event: PierEnvelope };
  const t = parseTransfer(event);
  // Only transfers into the treasury are deposits; our own refunds show up as transfers out of it.
  if (!t || t.to !== deps.treasury || t.from === deps.treasury) return;
  // Any contract can emit a "transfer" naming any asset: only the asset's own contract moves it (T-047, DEC-064).
  if (!sacMatchesAsset(t.asset, t.assetName)) {
    console.warn(`[deposits] ignored event ${t.eventId}: contract ${t.asset} is not the asset contract it names`);
    return;
  }

  const row: Omit<DepositRow, "paymentId" | "kind"> = {
    id: t.eventId,
    muxId: t.muxedId ?? null,
    assetSac: t.asset,
    assetName: t.assetName,
    amount7: t.amount7,
    fromAccount: t.from,
    txHash: t.txHash,
    ledgerClosedAt: t.ledgerClosedAt,
  };

  if (!t.muxedId) {
    // No muxed id: a top-up or a mistake we can't attribute. Recorded and booked to capital, never refunded (§11 Q6).
    if (await insertDeposit(tx, { ...row, paymentId: null, kind: "unmarked" })) {
      await deps.backbone.publish(tx, [
        {
          type: "TreasuryCredited",
          version: 1,
          aggregate: { type: "deposit", id: t.eventId },
          correlationId: t.eventId,
          causationId: record.id,
          payload: {
            depositId: t.eventId,
            asset: t.asset,
            assetName: t.assetName,
            amount7: t.amount7.toString(),
            from: t.from,
          },
        },
      ]);
    }
    return;
  }

  const rec = await getPaymentByMuxId(tx, t.muxedId, { forUpdate: true });
  if (!rec) {
    if (await insertDeposit(tx, { ...row, paymentId: null, kind: "unattributed" })) {
      await deps.backbone.publish(tx, [
        {
          type: "UnattributedDeposit",
          version: 1,
          aggregate: { type: "deposit", id: t.eventId },
          correlationId: t.eventId,
          causationId: record.id,
          payload: {
            depositId: t.eventId,
            muxId: t.muxedId,
            asset: t.asset,
            assetName: t.assetName,
            amount7: t.amount7.toString(),
            from: t.from,
            txHash: t.txHash,
          },
        },
      ]);
    }
    return;
  }

  const d = decide(
    rec.payment,
    {
      type: "deposit.observed",
      depositId: t.eventId,
      asset: t.asset,
      amount7: t.amount7,
      from: t.from,
      ledgerClosedAt: t.ledgerClosedAt,
      txHash: t.txHash,
    },
    record.id,
  );
  const kind = d.payment.deposits.find((x) => x.id === t.eventId)?.kind ?? "unexpected";
  await insertDeposit(tx, { ...row, paymentId: rec.payment.id, kind });
  await savePayment(tx, rec.payment, d.payment, "deposit.observed", record.id);
  await deps.backbone.publish(tx, d.events);
}
