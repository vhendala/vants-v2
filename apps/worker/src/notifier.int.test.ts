// T-012: integrator webhooks (§5.2) on a real Postgres and a real HTTP receiver. Every delivery is verified with the
// standardwebhooks library the integrator would use; the body is the payment exactly as GET /v0/payments/:id shows it.
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { classicAsset, depositInstructions, sacIdOf } from "@vants/adapter-stellar";
import {
  type Backbone,
  createBackbone,
  createIntegrator,
  createWebhookEndpoint,
  disableWebhookEndpoint,
  getPayment,
  insertPayment,
  insertQuote,
  migrate,
  nextMuxId,
  paymentResource,
  savePayment,
} from "@vants/db";
import { decide, newPayment, priceQuote } from "@vants/domain";
import { buildStaticBrCode } from "@vants/pix";
import { Keypair } from "@stellar/stellar-sdk";
import { Webhook } from "standardwebhooks";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startPostgres, type TestPostgres } from "../../../packages/db/test/postgres.ts";
import { deliverDue, fanOut, RETRY_SCHEDULE_SECONDS, runNotifier } from "./notifier.ts";

const CIRCLE = "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const CIRCLE_SAC = sacIdOf(classicAsset(CIRCLE));
const treasury = Keypair.random().publicKey();
const deposit = (muxId: string) => depositInstructions(treasury, muxId);

interface Received {
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
}

let pgc: TestPostgres;
let bb: Backbone;
let server: Server;
let base = "";
const received: Received[] = [];
/** Status codes the receiver answers with, in order; 200 once empty. "hang" never answers. */
const replies: (number | "hang")[] = [];
let offsetMs = 0;
const now = () => new Date(Date.now() + offsetMs);
const deps = () => ({ backbone: bb, deposit, now, timeoutMs: 300 });

let integrator = "";
let secret = "";
let endpointId = "";
let endpointPath = "";
let seq = 0;

beforeAll(async () => {
  pgc = await startPostgres();
  await migrate(pgc.url);
  bb = createBackbone({ databaseUrl: pgc.url });
  await bb.start();
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      received.push({ path: req.url ?? "", headers: req.headers, body });
      const r = replies.shift() ?? 200;
      if (r === "hang") return;
      res.writeHead(r).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 120_000);

afterAll(async () => {
  server?.closeAllConnections();
  await new Promise((r) => server?.close(r));
  await bb?.stop();
  await pgc?.stop();
});

beforeEach(async () => {
  received.length = 0;
  replies.length = 0;
  offsetMs = 0;
  // A fresh integrator and endpoint per test, so deliveries from other tests never interfere.
  ({ integratorId: integrator } = await bb.withTransaction((tx) => createIntegrator(tx, `N${++seq}`, "p".repeat(32))));
  endpointPath = `/hooks/${seq}`;
  const e = await bb.withTransaction((tx) => createWebhookEndpoint(tx, integrator, `${base}${endpointPath}`));
  ({ secret, id: endpointId } = e);
  // Drain anything earlier tests left queued.
  await bb.pool.query("UPDATE notifications SET status = 'failed' WHERE status = 'pending'");
  await bb.pool.query("UPDATE payment_transitions SET notified_at = now() WHERE notified_at IS NULL");
});

async function createPayment(owner = integrator) {
  const price = priceQuote({ valueCents: 540, rateMicros: 5_400_000n, feeModel: "sandbox" });
  const expiresAt = new Date(Date.now() + 120_000).toISOString();
  return bb.withTransaction(async (tx) => {
    const quote = await insertQuote(tx, {
      integratorId: owner,
      destination: {
        type: "br_code",
        brCode: buildStaticBrCode({
          key: "k@vants.example.com",
          merchantName: "LOJA",
          merchantCity: "RIO",
          amountCents: 540,
        }),
        payee: { name: "LOJA", city: "RIO", key: "k@vants.example.com" },
        isDynamic: false,
      },
      assetName: CIRCLE,
      assetSac: CIRCLE_SAC,
      valueCents: 540,
      feeCents: 0,
      rateMicros: 5_400_000n,
      assetAmount7: price.assetAmount7,
      expiresAt,
    });
    const p = newPayment({
      id: `pay_note_${++seq}`,
      muxId: await nextMuxId(tx),
      quote: {
        asset: CIRCLE_SAC,
        assetAmount7: price.assetAmount7,
        valueCents: 540,
        feeCents: 0,
        rateMicros: 5_400_000n,
        expiresAt,
      },
    });
    await insertPayment(tx, p, owner, quote.id);
    return p;
  });
}

async function fund(id: string) {
  await bb.withTransaction(async (tx) => {
    const rec = await getPayment(tx, id, { forUpdate: true });
    if (!rec) throw new Error("no payment");
    const d = decide(rec.payment, {
      type: "deposit.observed",
      depositId: `dep-${id}`,
      asset: CIRCLE_SAC,
      amount7: rec.payment.quote.assetAmount7,
      from: Keypair.random().publicKey(),
      ledgerClosedAt: new Date().toISOString(),
      txHash: "ab".repeat(32),
    });
    await savePayment(tx, rec.payment, d.payment, "deposit.observed", null);
  });
}

const verified = (r: Received, key = secret) =>
  new Webhook(key).verify(r.body, {
    "webhook-id": String(r.headers["webhook-id"]),
    "webhook-timestamp": String(r.headers["webhook-timestamp"]),
    "webhook-signature": String(r.headers["webhook-signature"]),
  }) as { type: string; payment: { id: string; status: string } };

const row = async (webhookId: string) =>
  (
    await bb.pool.query<{ status: string; attempts: number; next_attempt_at: Date; last_status: number | null }>(
      "SELECT status, attempts, next_attempt_at, last_status FROM notifications WHERE endpoint_id = $1 AND webhook_id = $2",
      [endpointId, webhookId],
    )
  ).rows[0];

describe("delivery", () => {
  it("sends one signed payment.updated per transition, with the GET body and webhook-id <payment>:<version>", async () => {
    const p = await createPayment();
    await runNotifier(deps());
    await fund(p.id);
    await runNotifier(deps());

    expect(received.map((r) => r.headers["webhook-id"])).toEqual([`${p.id}:0`, `${p.id}:1`]);
    expect(received.map((r) => verified(r).payment.status)).toEqual(["awaiting_deposit", "funded"]);
    const current = await bb.withTransaction((tx) => paymentResource(tx, p.id, { deposit }));
    expect(verified(received[1] as Received)).toEqual({ type: "payment.updated", payment: current });
    expect(received[0]?.headers["content-type"]).toBe("application/json");
  });

  it("goes only to the payment's own integrator, and never to a removed endpoint", async () => {
    const other = await bb.withTransaction((tx) => createIntegrator(tx, `Other${++seq}`, "p".repeat(32)));
    await bb.withTransaction((tx) => createWebhookEndpoint(tx, other.integratorId, `${base}/other`));
    await createPayment();
    await bb.withTransaction((tx) => disableWebhookEndpoint(tx, integrator, endpointId));
    const extra = await bb.withTransaction((tx) => createWebhookEndpoint(tx, integrator, `${base}/second`));
    await runNotifier(deps());
    expect(received.map((r) => r.path)).toEqual(["/second"]);
    expect(verified(received[0] as Received, extra.secret).type).toBe("payment.updated");
  });

  it("an endpoint added later gets only later transitions, not the history", async () => {
    const p = await createPayment();
    await runNotifier(deps());
    await bb.withTransaction((tx) => createWebhookEndpoint(tx, integrator, `${base}/late`));
    await runNotifier(deps());
    await fund(p.id);
    await runNotifier(deps());
    // The two endpoints' deliveries of one transition have no defined order.
    expect(received.map((r) => `${r.path} ${r.headers["webhook-id"]}`).sort()).toEqual(
      [`${endpointPath} ${p.id}:0`, `${endpointPath} ${p.id}:1`, `/late ${p.id}:1`].sort(),
    );
  });

  it("fans out each transition once, however often the notifier runs", async () => {
    const p = await createPayment();
    await Promise.all([fanOut(deps()), fanOut(deps()), fanOut(deps())]);
    await deliverDue(deps());
    await runNotifier(deps());
    expect(received.map((r) => r.headers["webhook-id"])).toEqual([`${p.id}:0`]);
  });
});

describe("retries", () => {
  it("retries a non-2xx answer after the backoff, with the same webhook-id and a fresh signature", async () => {
    const p = await createPayment();
    replies.push(500);
    await runNotifier(deps());
    const after = await row(`${p.id}:0`);
    expect([after?.status, after?.attempts, after?.last_status]).toEqual(["pending", 1, 500]);
    expect(after?.next_attempt_at.getTime()).toBeGreaterThan(
      Date.now() + (RETRY_SCHEDULE_SECONDS[0] ?? 0) * 1000 - 5000,
    );

    await runNotifier(deps()); // not due yet
    expect(received).toHaveLength(1);

    offsetMs = ((RETRY_SCHEDULE_SECONDS[0] ?? 0) + 1) * 1000;
    await runNotifier(deps());
    expect(received.map((r) => r.headers["webhook-id"])).toEqual([`${p.id}:0`, `${p.id}:0`]);
    expect(verified(received[1] as Received).payment.id).toBe(p.id);
    expect((await row(`${p.id}:0`))?.status).toBe("delivered");
  });

  it("treats a timeout or a refused connection like an error answer, and doesn't hold up other endpoints", async () => {
    const p = await createPayment();
    replies.push("hang");
    const dead = await bb.withTransaction((tx) => createWebhookEndpoint(tx, integrator, "http://127.0.0.1:9/refused"));
    await runNotifier(deps());
    expect((await row(`${p.id}:0`))?.attempts).toBe(1);
    const refused = await bb.pool.query<{ status: string; last_error: string }>(
      "SELECT status, last_error FROM notifications WHERE endpoint_id = $1",
      [dead.id],
    );
    expect(refused.rows[0]?.status).toBe("pending");
    expect(refused.rows[0]?.last_error).toBeTruthy();
  });

  it("gives up after the last scheduled retry", async () => {
    const p = await createPayment();
    await fanOut(deps());
    await bb.pool.query("UPDATE notifications SET attempts = $3 WHERE endpoint_id = $1 AND webhook_id = $2", [
      endpointId,
      `${p.id}:0`,
      RETRY_SCHEDULE_SECONDS.length,
    ]);
    replies.push(503);
    await deliverDue(deps());
    expect((await row(`${p.id}:0`))?.status).toBe("failed");
  });
});
