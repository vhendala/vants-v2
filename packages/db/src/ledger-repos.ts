// The books and the float (SPEC §3.7, INV-06, T-015, migration 0005).
import { FLOAT_ACCOUNT, USDH } from "@vants/domain";
import type { Tx } from "./tx.ts";

export async function ledgerOpened(tx: Tx): Promise<boolean> {
  const r = await tx.query("SELECT 1 FROM ledger_entries WHERE event_type = 'LedgerOpened' LIMIT 1");
  return r.rows.length > 0;
}

/** An account's balance per asset. */
export async function accountBalances(tx: Tx, account: string): Promise<Map<string, bigint>> {
  const r = await tx.query<{ asset: string; total: string }>(
    "SELECT asset, sum(amount)::text AS total FROM ledger_entries WHERE account = $1 GROUP BY asset",
    [account],
  );
  return new Map(r.rows.map((row) => [row.asset, BigInt(row.total)]));
}

export interface FloatPosition {
  /** The books have been opened, so the balance means something. */
  opened: boolean;
  balance6: bigint;
  reserved6: bigint;
  available6: bigint;
}

export async function floatPosition(tx: Tx): Promise<FloatPosition> {
  const r = await tx.query<{ opened: boolean; balance: string; reserved: string }>(
    `SELECT EXISTS (SELECT 1 FROM ledger_entries WHERE event_type = 'LedgerOpened') AS opened,
       (SELECT COALESCE(sum(amount), 0)::text FROM ledger_entries WHERE account = $1 AND asset = $2) AS balance,
       (SELECT COALESCE(sum(amount6), 0)::text FROM float_reservations WHERE released_at IS NULL) AS reserved`,
    [FLOAT_ACCOUNT, USDH],
  );
  const row = r.rows[0];
  const balance6 = BigInt(row?.balance ?? "0");
  const reserved6 = BigInt(row?.reserved ?? "0");
  return { opened: row?.opened ?? false, balance6, reserved6, available6: balance6 - reserved6 };
}

/** Holds USDH for a funded payment's payout; once per payment. */
export async function reserveFloat(tx: Tx, paymentId: string, amount6: bigint): Promise<void> {
  await tx.query(
    "INSERT INTO float_reservations (payment_id, amount6) VALUES ($1, $2) ON CONFLICT (payment_id) DO NOTHING",
    [paymentId, amount6.toString()],
  );
}

/** Ends a payment's reservation: the payout was paid (the ledger now has the debit) or will not happen. */
export async function releaseFloat(tx: Tx, paymentId: string): Promise<void> {
  await tx.query("UPDATE float_reservations SET released_at = now() WHERE payment_id = $1 AND released_at IS NULL", [
    paymentId,
  ]);
}

export type ReconciliationStatus = "ok" | "mismatch" | "drift";

export interface ReconciliationRow {
  scope: "treasury" | "float" | "base";
  asset: string;
  assetName: string;
  ledger: bigint;
  actual: bigint;
  diff: bigint;
  status: ReconciliationStatus;
}

/** The previous difference recorded for this account and asset, if any. */
export async function previousDiff(tx: Tx, scope: string, asset: string): Promise<bigint | null> {
  const r = await tx.query<{ diff: string }>(
    "SELECT diff::text FROM reconciliations WHERE scope = $1 AND asset = $2 ORDER BY at DESC, id DESC LIMIT 1",
    [scope, asset],
  );
  return r.rows[0] ? BigInt(r.rows[0].diff) : null;
}

export async function recordReconciliation(tx: Tx, row: ReconciliationRow): Promise<void> {
  await tx.query(
    `INSERT INTO reconciliations (scope, asset, asset_name, ledger, actual, diff, status) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      row.scope,
      row.asset,
      row.assetName,
      row.ledger.toString(),
      row.actual.toString(),
      row.diff.toString(),
      row.status,
    ],
  );
}

/** Work that needs a person: refunds that landed but failed, webhooks that gave up, reservations open for an hour. */
export async function needsReview(
  tx: Tx,
): Promise<{ failedRefunds: number; failedNotifications: number; staleReservations: number }> {
  const r = await tx.query<{ refunds: number; notifications: number; reservations: number }>(
    `SELECT (SELECT count(*) FROM refunds WHERE status = 'failed')::int AS refunds,
       (SELECT count(*) FROM notifications WHERE status = 'failed')::int AS notifications,
       (SELECT count(*) FROM float_reservations WHERE released_at IS NULL AND created_at < now() - interval '1 hour')::int
         AS reservations`,
  );
  const row = r.rows[0];
  return {
    failedRefunds: row?.refunds ?? 0,
    failedNotifications: row?.notifications ?? 0,
    staleReservations: row?.reservations ?? 0,
  };
}

/** What the treasury owes back in `asset`: the sum of clearing accounts (negative while deposits await payout or refund). */
export async function clearingTotal(tx: Tx, asset: string): Promise<bigint> {
  const r = await tx.query<{ total: string }>(
    "SELECT COALESCE(sum(amount), 0)::text AS total FROM ledger_entries WHERE account LIKE 'clearing:%' AND asset = $1",
    [asset],
  );
  return BigInt(r.rows[0]?.total ?? "0");
}
