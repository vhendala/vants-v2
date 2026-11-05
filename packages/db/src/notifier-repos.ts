// Integrator webhook endpoints and the notification queue (SPEC §5.2, T-012, migration 0004).
import { randomBytes, randomUUID } from "node:crypto";
import type { Tx } from "./tx.ts";

export interface WebhookEndpointRecord {
  id: string;
  url: string;
  createdAt: string;
}

/** Registers an endpoint; the returned secret is never shown again. */
export async function createWebhookEndpoint(
  tx: Tx,
  integratorId: string,
  url: string,
): Promise<WebhookEndpointRecord & { secret: string }> {
  const id = `we_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const secret = `whsec_${randomBytes(32).toString("base64")}`;
  const r = await tx.query<{ created_at: Date }>(
    "INSERT INTO webhook_endpoints (id, integrator_id, url, secret) VALUES ($1, $2, $3, $4) RETURNING created_at",
    [id, integratorId, url, secret],
  );
  return { id, url, secret, createdAt: (r.rows[0]?.created_at ?? new Date()).toISOString() };
}

export async function listWebhookEndpoints(tx: Tx, integratorId: string): Promise<WebhookEndpointRecord[]> {
  const r = await tx.query<{ id: string; url: string; created_at: Date }>(
    "SELECT id, url, created_at FROM webhook_endpoints WHERE integrator_id = $1 AND disabled_at IS NULL ORDER BY created_at, id",
    [integratorId],
  );
  return r.rows.map((row) => ({ id: row.id, url: row.url, createdAt: row.created_at.toISOString() }));
}

/** `false` if there is no such active endpoint for this integrator. */
export async function disableWebhookEndpoint(tx: Tx, integratorId: string, id: string): Promise<boolean> {
  const r = await tx.query(
    "UPDATE webhook_endpoints SET disabled_at = now() WHERE id = $1 AND integrator_id = $2 AND disabled_at IS NULL RETURNING id",
    [id, integratorId],
  );
  return r.rows.length > 0;
}

// --- fan-out --------------------------------------------------------------------------------------------------------

export interface PendingTransition {
  paymentId: string;
  version: number;
  integratorId: string;
}

/** Transitions not yet fanned out, oldest first, locked for this transaction. */
export async function unnotifiedTransitions(tx: Tx, limit = 100): Promise<PendingTransition[]> {
  const r = await tx.query<{ payment_id: string; version: number; integrator_id: string }>(
    `SELECT t.payment_id, t.version, p.integrator_id FROM payment_transitions t JOIN payments p ON p.id = t.payment_id
     WHERE t.notified_at IS NULL ORDER BY t.at, t.payment_id, t.version LIMIT $1 FOR UPDATE OF t SKIP LOCKED`,
    [limit],
  );
  return r.rows.map((row) => ({ paymentId: row.payment_id, version: row.version, integratorId: row.integrator_id }));
}

export async function markTransitionNotified(tx: Tx, paymentId: string, version: number): Promise<void> {
  await tx.query("UPDATE payment_transitions SET notified_at = now() WHERE payment_id = $1 AND version = $2", [
    paymentId,
    version,
  ]);
}

export async function activeEndpointIds(tx: Tx, integratorId: string): Promise<string[]> {
  const r = await tx.query<{ id: string }>(
    "SELECT id FROM webhook_endpoints WHERE integrator_id = $1 AND disabled_at IS NULL ORDER BY id",
    [integratorId],
  );
  return r.rows.map((row) => row.id);
}

export async function insertNotification(
  tx: Tx,
  n: { endpointId: string; webhookId: string; paymentId: string; body: unknown },
): Promise<void> {
  await tx.query(
    `INSERT INTO notifications (endpoint_id, webhook_id, payment_id, body) VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint_id, webhook_id) DO NOTHING`,
    [n.endpointId, n.webhookId, n.paymentId, JSON.stringify(n.body)],
  );
}

// --- delivery -------------------------------------------------------------------------------------------------------

export interface DueNotification {
  endpointId: string;
  webhookId: string;
  url: string;
  secret: string;
  body: unknown;
  attempts: number;
}

/** The oldest notification due by `now` whose endpoint is still active. */
export async function nextDueNotification(tx: Tx, now: Date): Promise<DueNotification | null> {
  const r = await tx.query<{
    endpoint_id: string;
    webhook_id: string;
    url: string;
    secret: string;
    body: unknown;
    attempts: number;
  }>(
    `SELECT n.endpoint_id, n.webhook_id, e.url, e.secret, n.body, n.attempts
     FROM notifications n JOIN webhook_endpoints e ON e.id = n.endpoint_id
     WHERE n.status = 'pending' AND n.next_attempt_at <= $1 AND e.disabled_at IS NULL
     ORDER BY n.next_attempt_at, n.created_at LIMIT 1`,
    [now.toISOString()],
  );
  const row = r.rows[0];
  return row
    ? {
        endpointId: row.endpoint_id,
        webhookId: row.webhook_id,
        url: row.url,
        secret: row.secret,
        body: row.body,
        attempts: row.attempts,
      }
    : null;
}

export async function recordDelivery(
  tx: Tx,
  key: { endpointId: string; webhookId: string },
  outcome:
    | { kind: "delivered"; status: number }
    | { kind: "retry"; status: number | null; error: string; nextAttemptAt: Date }
    | { kind: "failed"; status: number | null; error: string },
): Promise<void> {
  if (outcome.kind === "delivered") {
    await tx.query(
      `UPDATE notifications SET status = 'delivered', attempts = attempts + 1, last_status = $3, last_error = NULL,
         delivered_at = now() WHERE endpoint_id = $1 AND webhook_id = $2`,
      [key.endpointId, key.webhookId, outcome.status],
    );
    return;
  }
  await tx.query(
    `UPDATE notifications SET status = $3, attempts = attempts + 1, last_status = $4, last_error = $5,
       next_attempt_at = COALESCE($6, next_attempt_at) WHERE endpoint_id = $1 AND webhook_id = $2`,
    [
      key.endpointId,
      key.webhookId,
      outcome.kind === "retry" ? "pending" : "failed",
      outcome.status,
      outcome.error,
      outcome.kind === "retry" ? outcome.nextAttemptAt.toISOString() : null,
    ],
  );
}
