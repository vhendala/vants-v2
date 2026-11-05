// The mini app's records (T-020, migration 0007): used SEP-10 challenges and exits.
import type { Tx } from "./tx.ts";

export const MINI_APP_INTEGRATOR = "int_vants_mini_app";

/** Records a SEP-10 challenge as used; `false` if it already was (one JWT per challenge). */
export async function useChallenge(tx: Tx, hash: string, account: string): Promise<boolean> {
  const r = await tx.query(
    "INSERT INTO auth_challenges (hash, account) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING hash",
    [hash, account],
  );
  return r.rows.length > 0;
}

export interface ExitRecord {
  id: string;
  account: string;
  paymentId: string;
  route: "classic" | "router";
  /** Position ids, or `{ id, amount }` with the amount chosen from it (T-023). */
  picks: (string | { id: string; amount?: string })[];
  txHash: string;
  txXdr: string;
  maxTime: number;
  summary: string[];
  status: "built" | "submitted";
  createdAt: string;
}

export async function insertExit(tx: Tx, e: Omit<ExitRecord, "status" | "createdAt">): Promise<void> {
  await tx.query(
    `INSERT INTO exits (id, account, payment_id, route, picks, tx_hash, tx_xdr, max_time, summary)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      e.id,
      e.account,
      e.paymentId,
      e.route,
      JSON.stringify(e.picks),
      e.txHash,
      e.txXdr,
      e.maxTime,
      JSON.stringify(e.summary),
    ],
  );
}

export async function getExit(
  tx: Tx,
  id: string,
  account: string,
  opts: { forUpdate?: boolean } = {},
): Promise<ExitRecord | null> {
  const r = await tx.query<ExitRow>(
    `SELECT ${EXIT_COLUMNS} FROM exits WHERE id = $1 AND account = $2 ${opts.forUpdate ? "FOR UPDATE" : ""}`,
    [id, account],
  );
  const row = r.rows[0];
  return row ? exitFromRow(row) : null;
}

/**
 * The account's signed exits, newest first (T-023). `before` is the `next` cursor of the previous page: `<created_at>|<id>`.
 * Built-but-unsigned exits are abandoned attempts and are left out.
 */
export async function listExits(
  tx: Tx,
  account: string,
  opts: { limit: number; before?: string },
): Promise<{ items: ExitRecord[]; next: string | null }> {
  const [at, id] = opts.before ? opts.before.split("|") : [];
  const r = await tx.query<ExitRow>(
    `SELECT ${EXIT_COLUMNS} FROM exits
     WHERE account = $1 AND status = 'submitted'
       AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::text))
     ORDER BY created_at DESC, id DESC LIMIT $4`,
    [account, at ?? null, id ?? "", opts.limit + 1],
  );
  const items = r.rows.slice(0, opts.limit).map(exitFromRow);
  const last = items.at(-1);
  return { items, next: r.rows.length > opts.limit && last ? `${last.createdAt}|${last.id}` : null };
}

/**
 * What the account paid this calendar month (São Paulo time), from its signed exits whose payment completed (T-025):
 * the total in centavos and the count.
 */
export async function monthSummary(tx: Tx, account: string): Promise<{ cents: number; count: number }> {
  const r = await tx.query<{ cents: string; count: string }>(
    `SELECT COALESCE(sum(q.value_cents), 0)::text AS cents, count(*)::text AS count
     FROM exits e JOIN payments p ON p.id = e.payment_id JOIN quotes q ON q.id = p.quote_id
     WHERE e.account = $1 AND e.status = 'submitted' AND p.status = 'completed'
       AND e.created_at >= (date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')`,
    [account],
  );
  return { cents: Number(r.rows[0]?.cents ?? 0), count: Number(r.rows[0]?.count ?? 0) };
}

/** Signed exits after a cursor, `limit + 1` rows at most (T-033: Atividade merges them with actions and deposits). */
export async function listExitsBefore(
  tx: Tx,
  account: string,
  opts: { limit: number; before?: string },
): Promise<ExitRecord[]> {
  const page = await listExits(tx, account, { limit: opts.limit + 1, ...(opts.before ? { before: opts.before } : {}) });
  return page.items;
}

const EXIT_COLUMNS =
  "id, account, payment_id, route, picks, tx_hash, tx_xdr, max_time::text, summary, status, created_at";

interface ExitRow {
  id: string;
  account: string;
  payment_id: string;
  route: "classic" | "router";
  picks: ExitRecord["picks"];
  tx_hash: string;
  tx_xdr: string;
  max_time: string;
  summary: string[];
  status: "built" | "submitted";
  created_at: Date;
}

const exitFromRow = (row: ExitRow): ExitRecord => ({
  id: row.id,
  account: row.account,
  paymentId: row.payment_id,
  route: row.route,
  picks: row.picks,
  txHash: row.tx_hash,
  txXdr: row.tx_xdr,
  maxTime: Number(row.max_time),
  summary: row.summary,
  status: row.status,
  createdAt: row.created_at.toISOString(),
});

export async function markExitSubmitted(tx: Tx, id: string): Promise<void> {
  await tx.query("UPDATE exits SET status = 'submitted', submitted_at = now() WHERE id = $1", [id]);
}

// --- Investing and adding money (T-026, migration 0007) ------------------------------------------------------------

export interface ActionRecord {
  id: string;
  account: string;
  kind: "invest" | "redeem" | "trustline" | "trade";
  detail: Record<string, string>;
  txHash: string;
  txXdr: string;
  maxTime: number;
  summary: string[];
  status: "built" | "submitted" | "done" | "failed";
  createdAt: string;
}

export async function insertAction(tx: Tx, a: Omit<ActionRecord, "status" | "createdAt">): Promise<void> {
  await tx.query(
    `INSERT INTO app_actions (id, account, kind, detail, tx_hash, tx_xdr, max_time, summary)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [a.id, a.account, a.kind, JSON.stringify(a.detail), a.txHash, a.txXdr, a.maxTime, JSON.stringify(a.summary)],
  );
}

const ACTION_COLUMNS = "id, account, kind, detail, tx_hash, tx_xdr, max_time::text, summary, status, created_at";
type ActionRow = {
  id: string;
  account: string;
  kind: ActionRecord["kind"];
  detail: Record<string, string>;
  tx_hash: string;
  tx_xdr: string;
  max_time: string;
  summary: string[];
  status: ActionRecord["status"];
  created_at: Date;
};
const actionFromRow = (row: ActionRow): ActionRecord => ({
  id: row.id,
  account: row.account,
  kind: row.kind,
  detail: row.detail,
  txHash: row.tx_hash,
  txXdr: row.tx_xdr,
  maxTime: Number(row.max_time),
  summary: row.summary,
  status: row.status,
  createdAt: row.created_at.toISOString(),
});

export async function getAction(tx: Tx, id: string, account: string): Promise<ActionRecord | null> {
  const r = await tx.query<ActionRow>(`SELECT ${ACTION_COLUMNS} FROM app_actions WHERE id = $1 AND account = $2`, [
    id,
    account,
  ]);
  return r.rows[0] ? actionFromRow(r.rows[0]) : null;
}

/**
 * The account's signed actions (invest, redeem, trade, trustline), newest first, for Atividade (T-033). Built-but-unsigned
 * ones are abandoned attempts and are left out. `before` is a `<created_at>|<id>` cursor, as for exits. Returns `limit + 1`
 * rows at most, so the caller can tell whether more remain.
 */
export async function listActions(
  tx: Tx,
  account: string,
  opts: { limit: number; before?: string },
): Promise<ActionRecord[]> {
  const [at, id] = opts.before ? opts.before.split("|") : [];
  const r = await tx.query<ActionRow>(
    `SELECT ${ACTION_COLUMNS} FROM app_actions
     WHERE account = $1 AND status <> 'built'
       AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::text))
     ORDER BY created_at DESC, id DESC LIMIT $4`,
    [account, at ?? null, id ?? "", opts.limit + 1],
  );
  return r.rows.map(actionFromRow);
}

export async function setActionStatus(tx: Tx, id: string, status: ActionRecord["status"]): Promise<void> {
  await tx.query(
    `UPDATE app_actions SET status = $2,
       submitted_at = CASE WHEN $2 = 'submitted' THEN now() ELSE submitted_at END,
       settled_at = CASE WHEN $2 IN ('done', 'failed') THEN now() ELSE settled_at END
     WHERE id = $1`,
    [id, status],
  );
}

export interface RampCustomer {
  account: string;
  customerId: string;
  bankAccountId: string;
  displayName: string;
  email: string;
}

export async function getRampCustomer(tx: Tx, account: string): Promise<RampCustomer | null> {
  const r = await tx.query<{ customer_id: string; bank_account_id: string; display_name: string; email: string }>(
    "SELECT customer_id, bank_account_id, display_name, email FROM ramp_customers WHERE account = $1",
    [account],
  );
  const row = r.rows[0];
  return row
    ? {
        account,
        customerId: row.customer_id,
        bankAccountId: row.bank_account_id,
        displayName: row.display_name,
        email: row.email,
      }
    : null;
}

export async function saveRampCustomer(tx: Tx, c: RampCustomer): Promise<void> {
  await tx.query(
    `INSERT INTO ramp_customers (account, customer_id, bank_account_id, display_name, email) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (account) DO UPDATE SET customer_id = $2, bank_account_id = $3, display_name = $4, email = $5`,
    [c.account, c.customerId, c.bankAccountId, c.displayName, c.email],
  );
}

export interface RampOrder {
  id: string;
  account: string;
  targetAsset: string;
  amountBrl: string;
  amountAsset: string;
  feeBrl: string;
  status: string;
  pixCode: string | null;
  deliveredTx: string | null;
  createdAt: string;
  updatedAt: string;
}

const RAMP_COLUMNS =
  "id, account, target_asset, amount_brl::text, amount_asset, fee_brl::text, status, pix_code, delivered_tx, created_at, updated_at";
type RampRow = {
  id: string;
  account: string;
  target_asset: string;
  amount_brl: string;
  amount_asset: string;
  fee_brl: string;
  status: string;
  pix_code: string | null;
  delivered_tx: string | null;
  created_at: Date;
  updated_at: Date;
};
const rampFromRow = (r: RampRow): RampOrder => ({
  id: r.id,
  account: r.account,
  targetAsset: r.target_asset,
  amountBrl: r.amount_brl,
  amountAsset: r.amount_asset,
  feeBrl: r.fee_brl,
  status: r.status,
  pixCode: r.pix_code,
  deliveredTx: r.delivered_tx,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

export async function insertRampOrder(
  tx: Tx,
  o: Omit<RampOrder, "createdAt" | "updatedAt" | "deliveredTx">,
): Promise<void> {
  await tx.query(
    `INSERT INTO ramp_orders (id, account, target_asset, amount_brl, amount_asset, fee_brl, status, pix_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [o.id, o.account, o.targetAsset, o.amountBrl, o.amountAsset, o.feeBrl, o.status, o.pixCode],
  );
}

export async function getRampOrder(tx: Tx, id: string, account: string): Promise<RampOrder | null> {
  const r = await tx.query<RampRow>(`SELECT ${RAMP_COLUMNS} FROM ramp_orders WHERE id = $1 AND account = $2`, [
    id,
    account,
  ]);
  return r.rows[0] ? rampFromRow(r.rows[0]) : null;
}

export async function listRampOrders(tx: Tx, account: string, limit: number): Promise<RampOrder[]> {
  const r = await tx.query<RampRow>(
    `SELECT ${RAMP_COLUMNS} FROM ramp_orders WHERE account = $1 ORDER BY created_at DESC LIMIT $2`,
    [account, limit],
  );
  return r.rows.map(rampFromRow);
}

/** The account's Pix deposits, newest first, by the same `<created_at>|<id>` cursor (T-033); `limit + 1` rows at most. */
export async function listRampOrdersBefore(
  tx: Tx,
  account: string,
  opts: { limit: number; before?: string },
): Promise<RampOrder[]> {
  const [at, id] = opts.before ? opts.before.split("|") : [];
  const r = await tx.query<RampRow>(
    `SELECT ${RAMP_COLUMNS} FROM ramp_orders
     WHERE account = $1 AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::text))
     ORDER BY created_at DESC, id DESC LIMIT $4`,
    [account, at ?? null, id ?? "", opts.limit + 1],
  );
  return r.rows.map(rampFromRow);
}

export async function updateRampOrder(tx: Tx, id: string, status: string, deliveredTx: string | null): Promise<void> {
  await tx.query(
    "UPDATE ramp_orders SET status = $2, delivered_tx = COALESCE($3, delivered_tx), updated_at = now() WHERE id = $1",
    [id, status, deliveredTx],
  );
}
