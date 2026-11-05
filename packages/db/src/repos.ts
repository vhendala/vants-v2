// Repositories for integrators, keys, quotes, payments and idempotent responses (T-010). Every function takes the caller's
// transaction; payments are saved with an optimistic version check so concurrent writers can't lose an update.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { type Payment, paymentFromJson, paymentToJson } from "@vants/domain";
import type { Tx } from "./tx.ts";

// --- integrators and API keys ---------------------------------------------------------------------------------

export const hashApiKey = (key: string, pepper: string) =>
  createHash("sha256").update(`${pepper}:${key}`).digest("hex");

/** Creates an integrator and its first key. The key is returned once and stored only as a hash. */
export async function createIntegrator(
  tx: Tx,
  name: string,
  pepper: string,
): Promise<{ integratorId: string; apiKey: string }> {
  const integratorId = `int_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const apiKey = `vk_test_${randomBytes(24).toString("hex")}`;
  await tx.query("INSERT INTO integrators (id, name) VALUES ($1, $2)", [integratorId, name]);
  await tx.query("INSERT INTO api_keys (key_hash, integrator_id, prefix) VALUES ($1, $2, $3)", [
    hashApiKey(apiKey, pepper),
    integratorId,
    apiKey.slice(0, 12),
  ]);
  return { integratorId, apiKey };
}

export async function integratorForKey(tx: Tx, apiKey: string, pepper: string): Promise<string | null> {
  const r = await tx.query<{ integrator_id: string }>(
    "SELECT integrator_id FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL",
    [hashApiKey(apiKey, pepper)],
  );
  return r.rows[0]?.integrator_id ?? null;
}

// --- quotes -------------------------------------------------------------------------------------------------------------

export type Destination =
  | { type: "br_code"; brCode: string; payee: { name: string; city: string; key?: string }; isDynamic: boolean }
  | { type: "pix_key"; key: string; keyType: "CPF" | "CNPJ" | "EMAIL" | "PHONE" | "RANDOM" };

export interface QuoteRecord {
  id: string;
  integratorId: string;
  destination: Destination;
  assetName: string;
  assetSac: string;
  valueCents: number;
  feeCents: number;
  rateMicros: bigint;
  assetAmount7: bigint;
  expiresAt: string;
  createdAt: string;
}

export async function insertQuote(tx: Tx, q: Omit<QuoteRecord, "id" | "createdAt">): Promise<QuoteRecord> {
  const id = `qt_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
  const r = await tx.query<{ created_at: Date }>(
    `INSERT INTO quotes (id, integrator_id, destination, asset_name, asset_sac, value_cents, fee_cents, rate_micros, asset_amount7, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING created_at`,
    [
      id,
      q.integratorId,
      JSON.stringify(q.destination),
      q.assetName,
      q.assetSac,
      q.valueCents,
      q.feeCents,
      q.rateMicros.toString(),
      q.assetAmount7.toString(),
      q.expiresAt,
    ],
  );
  return { ...q, id, createdAt: (r.rows[0]?.created_at ?? new Date()).toISOString() };
}

interface QuoteRow {
  id: string;
  integrator_id: string;
  destination: Destination;
  asset_name: string;
  asset_sac: string;
  value_cents: number;
  fee_cents: number;
  rate_micros: string;
  asset_amount7: string;
  expires_at: Date;
  created_at: Date;
}

const quoteFromRow = (r: QuoteRow): QuoteRecord => ({
  id: r.id,
  integratorId: r.integrator_id,
  destination: r.destination,
  assetName: r.asset_name,
  assetSac: r.asset_sac,
  valueCents: r.value_cents,
  feeCents: r.fee_cents,
  rateMicros: BigInt(r.rate_micros),
  assetAmount7: BigInt(r.asset_amount7),
  expiresAt: r.expires_at.toISOString(),
  createdAt: r.created_at.toISOString(),
});

export async function getQuote(tx: Tx, id: string, integratorId: string): Promise<QuoteRecord | null> {
  const r = await tx.query<QuoteRow>("SELECT * FROM quotes WHERE id = $1 AND integrator_id = $2", [id, integratorId]);
  return r.rows[0] ? quoteFromRow(r.rows[0]) : null;
}

// --- payments -------------------------------------------------------------------------------------------------------

export const nextMuxId = async (tx: Tx): Promise<string> =>
  (await tx.query<{ id: string }>("SELECT nextval('payment_mux_seq')::text AS id")).rows[0]?.id ?? "";

export async function insertPayment(tx: Tx, p: Payment, integratorId: string, quoteId: string): Promise<void> {
  await tx.query(
    `INSERT INTO payments (id, integrator_id, quote_id, mux_id, status, version, state) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [p.id, integratorId, quoteId, p.muxId, p.status, p.version, JSON.stringify(paymentToJson(p))],
  );
  await tx.query(
    `INSERT INTO payment_transitions (payment_id, version, from_status, to_status, input_type) VALUES ($1, $2, NULL, $3, 'payment.created')`,
    [p.id, p.version, p.status],
  );
}

export class StaleVersion extends Error {
  constructor(paymentId: string) {
    super(`payment ${paymentId} changed concurrently`);
    this.name = "StaleVersion";
  }
}

/** Saves `next` if the stored version is still `prev.version`, and records the transition. */
export async function savePayment(
  tx: Tx,
  prev: Payment,
  next: Payment,
  inputType: string,
  causationId: string | null,
): Promise<void> {
  if (next.version === prev.version) return;
  const r = await tx.query(
    "UPDATE payments SET status = $3, version = $4, state = $5, updated_at = now() WHERE id = $1 AND version = $2 RETURNING id",
    [prev.id, prev.version, next.status, next.version, JSON.stringify(paymentToJson(next))],
  );
  if (r.rows.length === 0) throw new StaleVersion(prev.id);
  await tx.query(
    `INSERT INTO payment_transitions (payment_id, version, from_status, to_status, input_type, causation_id) VALUES ($1, $2, $3, $4, $5, $6)`,
    [next.id, next.version, prev.status, next.status, inputType, causationId],
  );
}

export interface PaymentRecord {
  payment: Payment;
  integratorId: string;
  quoteId: string;
  createdAt: string;
}

export async function getPayment(
  tx: Tx,
  id: string,
  opts: { integratorId?: string; forUpdate?: boolean } = {},
): Promise<PaymentRecord | null> {
  const r = await tx.query<{ state: unknown; integrator_id: string; quote_id: string; created_at: Date }>(
    `SELECT state, integrator_id, quote_id, created_at FROM payments WHERE id = $1 ${opts.integratorId ? "AND integrator_id = $2" : ""} ${opts.forUpdate ? "FOR UPDATE" : ""}`,
    opts.integratorId ? [id, opts.integratorId] : [id],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    payment: paymentFromJson(row.state),
    integratorId: row.integrator_id,
    quoteId: row.quote_id,
    createdAt: row.created_at.toISOString(),
  };
}

export async function getPaymentByMuxId(
  tx: Tx,
  muxId: string,
  opts: { forUpdate?: boolean } = {},
): Promise<PaymentRecord | null> {
  const r = await tx.query<{ id: string }>("SELECT id FROM payments WHERE mux_id = $1", [muxId]);
  const id = r.rows[0]?.id;
  return id ? getPayment(tx, id, opts) : null;
}

export async function paymentTimeline(tx: Tx, id: string): Promise<{ status: string; at: string }[]> {
  const r = await tx.query<{ to_status: string; at: Date }>(
    "SELECT to_status, at FROM payment_transitions WHERE payment_id = $1 ORDER BY version",
    [id],
  );
  const out: { status: string; at: string }[] = [];
  for (const row of r.rows) {
    if (out.at(-1)?.status !== row.to_status) out.push({ status: row.to_status, at: row.at.toISOString() });
  }
  return out;
}

// --- idempotency ----------------------------------------------------------------------------------------------------

export const requestHash = (method: string, path: string, body: unknown) =>
  createHash("sha256")
    .update(`${method} ${path}\n${JSON.stringify(body ?? null)}`)
    .digest("hex");

export type IdempotencyLookup =
  | { kind: "new" }
  | { kind: "replay"; status: number; body: unknown }
  | { kind: "conflict" };

/** Locks the key's row for this transaction; the first request for a key goes through, later ones replay it. */
export async function lookupIdempotency(
  tx: Tx,
  integratorId: string,
  key: string,
  hash: string,
): Promise<IdempotencyLookup> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${integratorId}:${key}`]);
  const r = await tx.query<{ request_hash: string; status: number; body: unknown }>(
    "SELECT request_hash, status, body FROM idempotency_keys WHERE integrator_id = $1 AND key = $2",
    [integratorId, key],
  );
  const row = r.rows[0];
  if (!row) return { kind: "new" };
  return row.request_hash === hash ? { kind: "replay", status: row.status, body: row.body } : { kind: "conflict" };
}

export async function storeIdempotency(
  tx: Tx,
  integratorId: string,
  key: string,
  hash: string,
  status: number,
  body: unknown,
): Promise<void> {
  await tx.query(
    "INSERT INTO idempotency_keys (integrator_id, key, request_hash, status, body) VALUES ($1, $2, $3, $4, $5)",
    [integratorId, key, hash, status, JSON.stringify(body)],
  );
}
