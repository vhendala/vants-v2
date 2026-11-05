// Saga work lists (T-011, migration 0003): deposits as observed, one payout per payment, refunds with their envelopes.
import type { Tx } from "./tx.ts";

// --- deposits -------------------------------------------------------------------------------------------------------

export interface DepositRow {
  id: string;
  paymentId: string | null;
  muxId: string | null;
  assetSac: string;
  assetName: string;
  amount7: bigint;
  fromAccount: string;
  txHash: string;
  ledgerClosedAt: string;
  kind: string;
}

/** Records a deposit once (by Pier event id); `false` if it was already recorded. */
export async function insertDeposit(tx: Tx, d: DepositRow): Promise<boolean> {
  const r = await tx.query(
    `INSERT INTO deposits (id, payment_id, mux_id, asset_sac, asset_name, amount7, from_account, tx_hash, ledger_closed_at, kind)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (id) DO NOTHING RETURNING id`,
    [
      d.id,
      d.paymentId,
      d.muxId,
      d.assetSac,
      d.assetName,
      d.amount7.toString(),
      d.fromAccount,
      d.txHash,
      d.ledgerClosedAt,
      d.kind,
    ],
  );
  return r.rows.length > 0;
}

/** The classic name ("native" or "CODE:ISSUER") of an asset this payment received: refunds go back in it (DEC-023). */
export async function depositAssetName(tx: Tx, paymentId: string, assetSac: string): Promise<string | null> {
  const r = await tx.query<{ asset_name: string }>(
    "SELECT asset_name FROM deposits WHERE payment_id = $1 AND asset_sac = $2 LIMIT 1",
    [paymentId, assetSac],
  );
  return r.rows[0]?.asset_name ?? null;
}

// --- payouts --------------------------------------------------------------------------------------------------------

export type PayoutStatus = "requested" | "sent" | "completed" | "failed" | "cancelled";

export const payoutExternalId = (paymentId: string) => `vants:${paymentId}`;

export async function insertPayout(tx: Tx, paymentId: string): Promise<void> {
  await tx.query("INSERT INTO payouts (payment_id, external_id) VALUES ($1, $2) ON CONFLICT (payment_id) DO NOTHING", [
    paymentId,
    payoutExternalId(paymentId),
  ]);
}

/** The oldest payout still to drive. Only the single-flight payout pump reads this list (DEC-008). */
export async function nextOpenPayout(tx: Tx): Promise<string | null> {
  const r = await tx.query<{ payment_id: string }>(
    `SELECT payment_id FROM payouts WHERE status IN ('requested', 'sent') ORDER BY created_at, payment_id LIMIT 1`,
  );
  return r.rows[0]?.payment_id ?? null;
}

export async function updatePayout(
  tx: Tx,
  paymentId: string,
  f: {
    status?: PayoutStatus;
    attempt?: boolean;
    transactionId?: string;
    response?: unknown;
    lastError?: string | null;
  },
): Promise<void> {
  await tx.query(
    `UPDATE payouts SET
       status = COALESCE($2, status),
       attempts = attempts + $3,
       transaction_id = COALESCE($4, transaction_id),
       response = COALESCE($5, response),
       last_error = CASE WHEN $6::boolean THEN $7 ELSE last_error END,
       updated_at = now()
     WHERE payment_id = $1`,
    [
      paymentId,
      f.status ?? null,
      f.attempt ? 1 : 0,
      f.transactionId ?? null,
      f.response === undefined ? null : JSON.stringify(f.response),
      f.lastError !== undefined,
      f.lastError ?? null,
    ],
  );
}

export async function getPayoutRow(
  tx: Tx,
  paymentId: string,
): Promise<{ status: PayoutStatus; attempts: number; lastError: string | null } | null> {
  const r = await tx.query<{ status: PayoutStatus; attempts: number; last_error: string | null }>(
    "SELECT status, attempts, last_error FROM payouts WHERE payment_id = $1",
    [paymentId],
  );
  const row = r.rows[0];
  return row ? { status: row.status, attempts: row.attempts, lastError: row.last_error } : null;
}

export async function confirmPayout(tx: Tx, externalId: string): Promise<string | null> {
  const r = await tx.query<{ payment_id: string }>(
    "UPDATE payouts SET confirmed_at = COALESCE(confirmed_at, now()), updated_at = now() WHERE external_id = $1 RETURNING payment_id",
    [externalId],
  );
  return r.rows[0]?.payment_id ?? null;
}

// --- refunds --------------------------------------------------------------------------------------------------------

export type RefundStatus = "requested" | "submitted" | "sent" | "failed";

export interface RefundRow {
  id: string;
  paymentId: string | null;
  depositId: string | null;
  muxId: string;
  memo: string;
  assetName: string;
  amount7: bigint;
  toAccount: string;
  reason: string;
  status: RefundStatus;
  envelopeXdr: string | null;
  txHash: string | null;
  maxTime: number | null;
  attempts: number;
}

export async function insertRefund(
  tx: Tx,
  r: Pick<
    RefundRow,
    "id" | "paymentId" | "depositId" | "muxId" | "memo" | "assetName" | "amount7" | "toAccount" | "reason"
  >,
): Promise<void> {
  await tx.query(
    `INSERT INTO refunds (id, payment_id, deposit_id, mux_id, memo, asset_name, amount7, to_account, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING`,
    [r.id, r.paymentId, r.depositId, r.muxId, r.memo, r.assetName, r.amount7.toString(), r.toAccount, r.reason],
  );
}

/** Refunds already owed for deposits to this muxed id that matched no payment (numbers their memos). */
export async function countUnattributedRefunds(tx: Tx, muxId: string): Promise<number> {
  const r = await tx.query<{ n: string }>(
    "SELECT count(*) AS n FROM refunds WHERE mux_id = $1 AND payment_id IS NULL",
    [muxId],
  );
  return Number(r.rows[0]?.n ?? 0);
}

interface RefundDbRow {
  id: string;
  payment_id: string | null;
  deposit_id: string | null;
  mux_id: string;
  memo: string;
  asset_name: string;
  amount7: string;
  to_account: string;
  reason: string;
  status: RefundStatus;
  envelope_xdr: string | null;
  tx_hash: string | null;
  max_time: string | null;
  attempts: number;
}

const refundFromRow = (r: RefundDbRow): RefundRow => ({
  id: r.id,
  paymentId: r.payment_id,
  depositId: r.deposit_id,
  muxId: r.mux_id,
  memo: r.memo,
  assetName: r.asset_name,
  amount7: BigInt(r.amount7),
  toAccount: r.to_account,
  reason: r.reason,
  status: r.status,
  envelopeXdr: r.envelope_xdr,
  txHash: r.tx_hash,
  maxTime: r.max_time === null ? null : Number(r.max_time),
  attempts: r.attempts,
});

const REFUND_COLUMNS =
  "id, payment_id, deposit_id, mux_id::text, memo, asset_name, amount7::text, to_account, reason, status, envelope_xdr, tx_hash, max_time::text, attempts";

/** The oldest refund not yet settled: the treasury sends them strictly one after another (one sequence number). */
export async function nextOpenRefund(tx: Tx): Promise<RefundRow | null> {
  const r = await tx.query<RefundDbRow>(
    `SELECT ${REFUND_COLUMNS} FROM refunds WHERE status IN ('requested', 'submitted') ORDER BY created_at, id LIMIT 1`,
  );
  return r.rows[0] ? refundFromRow(r.rows[0]) : null;
}

export async function getRefund(tx: Tx, id: string): Promise<RefundRow | null> {
  const r = await tx.query<RefundDbRow>(`SELECT ${REFUND_COLUMNS} FROM refunds WHERE id = $1`, [id]);
  return r.rows[0] ? refundFromRow(r.rows[0]) : null;
}

/** Persists a signed envelope before it is submitted (INV-10). */
export async function recordRefundEnvelope(
  tx: Tx,
  id: string,
  e: { xdr: string; hash: string; maxTime: number },
): Promise<void> {
  await tx.query(
    `UPDATE refunds SET status = 'submitted', envelope_xdr = $2, tx_hash = $3, max_time = $4, attempts = attempts + 1,
       updated_at = now() WHERE id = $1`,
    [id, e.xdr, e.hash, e.maxTime],
  );
}

export async function setRefundStatus(tx: Tx, id: string, status: RefundStatus, lastError?: string): Promise<void> {
  await tx.query(
    "UPDATE refunds SET status = $2, last_error = COALESCE($3, last_error), updated_at = now() WHERE id = $1",
    [id, status, lastError ?? null],
  );
}

// --- sweeps ---------------------------------------------------------------------------------------------------------

/** Payments still waiting for a deposit whose quote expired before `before`. */
export async function expiredAwaitingPayments(tx: Tx, before: Date): Promise<string[]> {
  const r = await tx.query<{ id: string }>(
    `SELECT p.id FROM payments p JOIN quotes q ON q.id = p.quote_id
     WHERE p.status = 'awaiting_deposit' AND q.expires_at < $1 ORDER BY q.expires_at`,
    [before.toISOString()],
  );
  return r.rows.map((row) => row.id);
}
