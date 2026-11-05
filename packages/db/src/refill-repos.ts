// The float refill's state (SPEC §3.7, T-016, migration 0006).
import { randomUUID } from "node:crypto";
import type { Tx } from "./tx.ts";

export type RefillStatus = "approving" | "burning" | "attesting" | "minting" | "crediting" | "completed" | "failed";

export interface RefillRow {
  id: string;
  status: RefillStatus;
  amount6: bigint;
  maxFee6: bigint;
  approve: { xdr: string; hash: string; maxTime: number } | null;
  burn: { xdr: string; hash: string; maxTime: number } | null;
  message: `0x${string}` | null;
  attestation: `0x${string}` | null;
  feeExecuted6: bigint | null;
  mintHash: string | null;
  minted6: bigint | null;
  creditCents: number | null;
  credit6: bigint | null;
  trackId: string | null;
  settled: boolean;
  attempts: number;
  createdAt: string;
  finishedAt: string | null;
}

interface Row {
  id: string;
  status: RefillStatus;
  amount6: string;
  max_fee6: string;
  approve_xdr: string | null;
  approve_hash: string | null;
  approve_max_time: string | null;
  burn_xdr: string | null;
  burn_hash: string | null;
  burn_max_time: string | null;
  message: string | null;
  attestation: string | null;
  fee_executed6: string | null;
  mint_hash: string | null;
  minted6: string | null;
  credit_cents: number | null;
  credit6: string | null;
  track_id: string | null;
  settled: boolean;
  attempts: number;
  created_at: Date;
  finished_at: Date | null;
}

const big = (v: string | null) => (v === null ? null : BigInt(v));
const envelope = (xdr: string | null, hash: string | null, maxTime: string | null) =>
  xdr && hash && maxTime !== null ? { xdr, hash, maxTime: Number(maxTime) } : null;

const fromRow = (r: Row): RefillRow => ({
  id: r.id,
  status: r.status,
  amount6: BigInt(r.amount6),
  maxFee6: BigInt(r.max_fee6),
  approve: envelope(r.approve_xdr, r.approve_hash, r.approve_max_time),
  burn: envelope(r.burn_xdr, r.burn_hash, r.burn_max_time),
  message: r.message as `0x${string}` | null,
  attestation: r.attestation as `0x${string}` | null,
  feeExecuted6: big(r.fee_executed6),
  mintHash: r.mint_hash,
  minted6: big(r.minted6),
  creditCents: r.credit_cents,
  credit6: big(r.credit6),
  trackId: r.track_id,
  settled: r.settled,
  attempts: r.attempts,
  createdAt: r.created_at.toISOString(),
  finishedAt: r.finished_at?.toISOString() ?? null,
});

const COLUMNS = `id, status, amount6::text, max_fee6::text, approve_xdr, approve_hash, approve_max_time::text, burn_xdr, burn_hash,
  burn_max_time::text, message, attestation, fee_executed6::text, mint_hash, minted6::text, credit_cents, credit6::text, track_id,
  settled, attempts, created_at, finished_at`;

/** Starts a refill unless one is already in flight; returns it, or null when another is active. */
export async function startRefill(tx: Tx, amount6: bigint, maxFee6: bigint): Promise<RefillRow | null> {
  const r = await tx.query<Row>(
    `INSERT INTO refills (id, status, amount6, max_fee6) VALUES ($1, 'approving', $2, $3)
     ON CONFLICT DO NOTHING RETURNING ${COLUMNS}`,
    [`rfl_${randomUUID().replaceAll("-", "").slice(0, 20)}`, amount6.toString(), maxFee6.toString()],
  );
  return r.rows[0] ? fromRow(r.rows[0]) : null;
}

export async function activeRefill(tx: Tx): Promise<RefillRow | null> {
  const r = await tx.query<Row>(`SELECT ${COLUMNS} FROM refills WHERE status NOT IN ('completed', 'failed') LIMIT 1`);
  return r.rows[0] ? fromRow(r.rows[0]) : null;
}

/** A refill failed within the last `minutes` (by the database clock): wait before trying again. */
export async function refillFailedRecently(tx: Tx, minutes: number): Promise<boolean> {
  const r = await tx.query(
    "SELECT 1 FROM refills WHERE status = 'failed' AND finished_at > now() - make_interval(mins => $1) LIMIT 1",
    [minutes],
  );
  return r.rows.length > 0;
}

export async function lastRefill(tx: Tx): Promise<RefillRow | null> {
  const r = await tx.query<Row>(`SELECT ${COLUMNS} FROM refills ORDER BY created_at DESC LIMIT 1`);
  return r.rows[0] ? fromRow(r.rows[0]) : null;
}

export interface RefillPatch {
  status?: RefillStatus;
  approve?: { xdr: string; hash: string; maxTime: number };
  burn?: { xdr: string; hash: string; maxTime: number };
  attested?: { message: string; attestation: string; feeExecuted6: bigint };
  minted?: { mintHash: string | null; minted6: bigint };
  credit?: { cents: number; credit6: bigint; trackId: string };
  settled?: true;
  attempt?: true;
  lastError?: string | null;
}

export async function updateRefill(tx: Tx, id: string, p: RefillPatch): Promise<void> {
  const sets: string[] = ["updated_at = now()"];
  const values: unknown[] = [id];
  const set = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };
  if (p.status) {
    set("status", p.status);
    if (p.status === "completed" || p.status === "failed") sets.push("finished_at = now()");
  }
  if (p.approve) {
    set("approve_xdr", p.approve.xdr);
    set("approve_hash", p.approve.hash);
    set("approve_max_time", p.approve.maxTime);
  }
  if (p.burn) {
    set("burn_xdr", p.burn.xdr);
    set("burn_hash", p.burn.hash);
    set("burn_max_time", p.burn.maxTime);
  }
  if (p.attested) {
    set("message", p.attested.message);
    set("attestation", p.attested.attestation);
    set("fee_executed6", p.attested.feeExecuted6.toString());
  }
  if (p.minted) {
    set("mint_hash", p.minted.mintHash);
    set("minted6", p.minted.minted6.toString());
  }
  if (p.credit) {
    set("credit_cents", p.credit.cents);
    set("credit6", p.credit.credit6.toString());
    set("track_id", p.credit.trackId);
  }
  if (p.settled) sets.push("settled = true");
  if (p.attempt) sets.push("attempts = attempts + 1");
  if (p.lastError !== undefined) set("last_error", p.lastError);
  await tx.query(`UPDATE refills SET ${sets.join(", ")} WHERE id = $1`, values);
}
