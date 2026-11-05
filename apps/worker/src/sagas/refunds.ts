// The refund saga (§3.4, INV-10, DEC-023). `RefundRequested` (from the state machine) and `UnattributedDeposit` (a muxed
// id no payment has) become rows on the refund list; the pump sends the list oldest first, strictly one at a time,
// because every refund spends the treasury's next sequence number. Each envelope is committed before it is submitted and
// resubmitted unchanged until its deadline has passed, so a refund lands at most once whatever crashes.
import { buildRefundTx, classicAsset, refundMemo, sacIdOf } from "@vants/adapter-stellar";
import {
  countUnattributedRefunds,
  depositAssetName,
  getPayment,
  insertRefund,
  nextOpenRefund,
  type RefundRow,
  recordRefundEnvelope,
  setRefundStatus,
  type Tx,
} from "@vants/db";
import type { DomainEvent, EventDraft } from "@vants/domain";
import { applyToPayment } from "./apply.ts";
import type { RefundDeps, SagaDeps } from "./ports.ts";
import { REFUND_PUMP } from "./queues.ts";
import { EnvelopePending, landOnce, NATIVE_SAC, TREASURY_SIGNER } from "./treasury-tx.ts";

/** The pump stopped on a refund whose envelope isn't on the ledger yet: nothing after it may be sent. */
export class RefundPending extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefundPending";
  }
}

interface RefundRequestedPayload {
  refundId: string;
  asset: string;
  amount7: string;
  to: string;
  reason: string;
}

interface UnattributedPayload {
  depositId: string;
  muxId: string;
  assetName: string;
  amount7: string;
  from: string;
}

export async function onRefundEvent(tx: Tx, event: DomainEvent, deps: SagaDeps): Promise<void> {
  if (event.type === "RefundRequested") {
    const r = event.payload as RefundRequestedPayload;
    const rec = await getPayment(tx, event.aggregate.id);
    if (!rec) throw new Error(`refund ${r.refundId} for unknown payment ${event.aggregate.id}`);
    // Every refund returns an asset this payment received, so one of its deposits names the classic asset.
    const assetName = await depositAssetName(tx, rec.payment.id, r.asset);
    if (!assetName) throw new Error(`refund ${r.refundId}: payment ${rec.payment.id} has no deposit of ${r.asset}`);
    const n = Number(r.refundId.slice(r.refundId.lastIndexOf(":rf") + 3));
    await insertRefund(tx, {
      id: r.refundId,
      paymentId: rec.payment.id,
      depositId: null,
      muxId: rec.payment.muxId,
      memo: refundMemo(rec.payment.muxId, n),
      assetName,
      amount7: BigInt(r.amount7),
      toAccount: r.to,
      reason: r.reason,
    });
  } else if (event.type === "UnattributedDeposit") {
    const d = event.payload as UnattributedPayload;
    const n = (await countUnattributedRefunds(tx, d.muxId)) + 1;
    await insertRefund(tx, {
      id: `dep:${d.depositId}`,
      paymentId: null,
      depositId: d.depositId,
      muxId: d.muxId,
      memo: refundMemo(d.muxId, `u${n}`),
      assetName: d.assetName,
      amount7: BigInt(d.amount7),
      toAccount: d.from,
      reason: "unattributed",
    });
  } else {
    return;
  }
  await deps.backbone.enqueue(tx, REFUND_PUMP);
}

/** Sends every open refund in order. Throws `RefundPending` (or the network's error) to stop and be retried. */
export async function runRefundPump(deps: RefundDeps): Promise<number> {
  let sent = 0;
  for (;;) {
    const r = await deps.backbone.withTransaction((tx) => nextOpenRefund(tx));
    if (!r) return sent;
    if (await settleRefund(r, deps)) sent += 1;
  }
}

const nowSeconds = (deps: SagaDeps) => Math.floor(deps.now().getTime() / 1000);

async function settleRefund(r: RefundRow, deps: RefundDeps): Promise<boolean> {
  try {
    const { landed, hash } = await deps.backbone.withLock(TREASURY_SIGNER, () =>
      landOnce({
        stored:
          r.envelopeXdr && r.txHash && r.maxTime !== null
            ? { xdr: r.envelopeXdr, hash: r.txHash, maxTime: r.maxTime }
            : null,
        build: async () =>
          buildRefundTx({
            source: await deps.ledger.account(),
            signer: deps.signer,
            to: r.toAccount,
            asset: classicAsset(r.assetName),
            amount7: r.amount7,
            memo: r.memo,
            nowSeconds: nowSeconds(deps),
          }),
        persist: (built) => deps.backbone.withTransaction((tx) => recordRefundEnvelope(tx, r.id, built)),
        ledger: deps.ledger,
        nowSeconds: nowSeconds(deps),
      }),
    );
    return landed === "success" ? markSent(r, hash, deps) : markFailed(r, hash, deps);
  } catch (err) {
    if (err instanceof EnvelopePending) throw new RefundPending(`refund ${r.id}: ${err.message}`);
    throw err;
  }
}

/** The network fee a landed envelope paid (failed ones too), booked against the treasury's XLM (T-015). */
async function feeEvent(r: RefundRow, hash: string, deps: RefundDeps): Promise<EventDraft> {
  const stroops = await deps.ledger.feeCharged(hash);
  return {
    type: "TreasuryFeePaid",
    version: 1,
    aggregate: { type: "refund", id: r.id },
    correlationId: r.paymentId ?? r.depositId ?? r.id,
    causationId: null,
    payload: { txHash: hash, asset: NATIVE_SAC, amount7: stroops.toString() },
  };
}

async function markSent(r: RefundRow, hash: string, deps: RefundDeps): Promise<boolean> {
  const fee = await feeEvent(r, hash, deps); // before the transaction: a failed lookup leaves the refund to retry
  await deps.backbone.withTransaction(async (tx) => {
    await setRefundStatus(tx, r.id, "sent");
    await deps.backbone.publish(tx, [fee]);
    if (r.paymentId) {
      await applyToPayment(tx, deps, r.paymentId, { type: "refund.sent", refundId: r.id, txHash: hash });
      return;
    }
    await deps.backbone.publish(tx, [
      {
        type: "RefundSent",
        version: 1,
        aggregate: { type: "deposit", id: r.depositId ?? r.id },
        correlationId: r.depositId ?? r.id,
        causationId: null,
        payload: {
          refundId: r.id,
          asset: sacIdOf(classicAsset(r.assetName)),
          assetName: r.assetName,
          amount7: r.amount7.toString(),
          to: r.toAccount,
          txHash: hash,
        },
      },
    ]);
  });
  return true;
}

/** The envelope landed but failed (e.g. no trustline): retrying can't help. Set aside for review; the queue moves on. */
async function markFailed(r: RefundRow, hash: string, deps: RefundDeps): Promise<boolean> {
  const reason = `envelope ${hash} failed on the ledger`;
  console.error(`[refund] ${r.id} needs review: ${reason}`);
  const fee = await feeEvent(r, hash, deps);
  await deps.backbone.withTransaction(async (tx) => {
    await setRefundStatus(tx, r.id, "failed", reason);
    await deps.backbone.publish(tx, [fee]);
  });
  return false;
}
