// pnpm e2e: the G-B checks D1, D4 and D5 (SPEC §1) on Stellar testnet and the Hodle sandbox, against a running
// `pnpm api` and `pnpm worker`. Writes evidence (tx hashes, timings, verdicts; no keys) to docs/evidence/.
//   D1  an integrator pays a BR Code from testnet USDC; the signed payment.updated webhook arrives with status completed
//   D4  replayed Pier and Hodle deliveries are no-ops; forged ones get 401 and change nothing
//   D5  underpaid, late, unknown muxed id and wrong asset deposits are each refunded within 60 s, tagged with the payment
// Neither provider pushes to us yet: Hodle webhooks are not registered (§11 Q1) and the Pier subscription is pull-only (no
// public URL, so PIER_WEBHOOK_SECRET is empty). D4 then signs with local secrets given to this api run (E2E_HODLE_SECRET,
// E2E_PIER_SECRET; the api gets the same values), and the evidence marks those deliveries as simulated.
import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { depositInstructions } from "@vants/adapter-stellar";
import { createIntegrator } from "@vants/db";
import { buildStaticBrCode } from "@vants/pix";
import { Asset, BASE_FEE, Horizon, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import pg from "pg";
import { Webhook } from "standardwebhooks";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};
const API = `http://127.0.0.1:${process.env.API_PORT ?? "3100"}`;
const USDC = "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const usdc = new Asset("USDC", USDC.split(":")[1] ?? "");
const horizonUrl = process.env.STELLAR_HORIZON_URL ?? "https://horizon-testnet.stellar.org";
if (!new URL(horizonUrl).hostname.includes("testnet")) throw new Error("testnet Horizon only (INV-07)");
const horizon = new Horizon.Server(horizonUrl);
const payer = Keypair.fromSecret(env("TEST_PAYER_SECRET"));
const treasury = env("TREASURY_ACCOUNT");
const db = new pg.Pool({ connectionString: env("DATABASE_URL") });
const hodleSecret = process.env.E2E_HODLE_SECRET ?? "";
const merchant = { key: "pix-spike@vants.example.com", merchantName: "VANTS TESTE", merchantCity: "SAO PAULO" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const secondsBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 100) / 10;
const log = (msg: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${msg}`);
const checks: { check: string; ok: boolean; detail: string }[] = [];
const expectThat = (check: string, ok: boolean, detail = "") => {
  checks.push({ check, ok, detail });
  log(`${ok ? "PASS" : "FAIL"} ${check}${detail ? ` (${detail})` : ""}`);
};

async function waitFor<T>(what: string, read: () => Promise<T | null | undefined>, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await read();
    if (v !== null && v !== undefined) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(1000);
  }
}

// --- the integrator: key, webhook receiver ------------------------------------------------------------------------

const integrator = await (async () => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const r = await createIntegrator(
      { query: async (t, v) => ({ rows: (await client.query(t, v)).rows }) },
      `e2e ${new Date().toISOString()}`,
      env("INTEGRATOR_KEY_PEPPER"),
    );
    await client.query("COMMIT");
    return r;
  } finally {
    client.release();
  }
})();

let idem = 0;
async function api<T>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "x-api-key": integrator.apiKey,
      ...(body === undefined
        ? {}
        : { "content-type": "application/json", "idempotency-key": `e2e-${Date.now()}-${++idem}` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as T };
}

interface Hook {
  at: string;
  id: string;
  verified: boolean;
  payment: { id: string; status: string; payout: { endToEndId: string } | null; refunds: { txHash: string | null }[] };
}
const hooks: Hook[] = [];
let hookSecret = "";
const receiver = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => {
    raw += c;
  });
  req.on("end", () => {
    const headers = {
      "webhook-id": String(req.headers["webhook-id"]),
      "webhook-timestamp": String(req.headers["webhook-timestamp"]),
      "webhook-signature": String(req.headers["webhook-signature"]),
    };
    let verified = false;
    let body: { payment: Hook["payment"] } | undefined;
    try {
      body = new Webhook(hookSecret).verify(raw, headers) as { payment: Hook["payment"] };
      verified = true;
    } catch {
      body = JSON.parse(raw);
    }
    if (body) hooks.push({ at: new Date().toISOString(), id: headers["webhook-id"], verified, payment: body.payment });
    res.writeHead(verified ? 204 : 400).end();
  });
});
await new Promise<void>((r) => receiver.listen(0, "127.0.0.1", r));
const hookUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/vants`;
const endpoint = await api<{ secret: string }>("POST", "/v0/webhook-endpoints", { url: hookUrl });
if (endpoint.status !== 201) throw new Error(`webhook endpoint: HTTP ${endpoint.status} (is pnpm api running?)`);
hookSecret = endpoint.json.secret;
log(`integrator ready; webhook receiver at ${hookUrl}`);

const hookFor = (paymentId: string, status: string) =>
  waitFor(
    `webhook ${paymentId} ${status}`,
    async () => hooks.find((h) => h.payment.id === paymentId && h.payment.status === status),
    150_000,
  );

// --- Stellar ------------------------------------------------------------------------------------------------------

async function pay(destination: string, asset: Asset, amount: string): Promise<{ hash: string; closedAt: string }> {
  const tx = new TransactionBuilder(await horizon.loadAccount(payer.publicKey()), {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({ destination, asset, amount }))
    .setTimeout(60)
    .build();
  tx.sign(payer);
  const r = await horizon.submitTransaction(tx);
  const t = await horizon.transactions().transaction(r.hash).call();
  return { hash: r.hash, closedAt: new Date(t.created_at).toISOString() };
}

/** The treasury's refund to the payer carrying `memo`, with its payment operation. */
async function refundOnLedger(memo: string) {
  return waitFor(
    `refund ${memo}`,
    async () => {
      const page = await horizon.transactions().forAccount(payer.publicKey()).order("desc").limit(30).call();
      const tx = page.records.find((t) => t.memo === memo && t.source_account === treasury && t.successful);
      if (!tx) return null;
      const ops = await horizon.operations().forTransaction(tx.hash).call();
      const op = ops.records[0] as unknown as { to: string; amount: string; asset_type: string; asset_code?: string };
      return {
        hash: tx.hash,
        closedAt: new Date(tx.created_at).toISOString(),
        to: op.to,
        amount: op.amount,
        asset: op.asset_type === "native" ? "native" : (op.asset_code ?? ""),
      };
    },
    120_000,
  );
}

interface Quote {
  id: string;
  expiresAt: string;
}
interface Created {
  id: string;
  deposit: { address: string; memoId: string; amount: string; expiresAt: string };
}

async function newPayment(amountCents: number): Promise<Created> {
  const q = await api<Quote>("POST", "/v0/quotes", {
    destination: { type: "br_code", brCode: buildStaticBrCode({ ...merchant, amountCents }) },
    asset: USDC,
  });
  if (q.status !== 201) throw new Error(`quote: HTTP ${q.status}`);
  const p = await api<Created>("POST", "/v0/payments", { quoteId: q.json.id, refundTo: payer.publicKey() });
  if (p.status !== 201) throw new Error(`payment: HTTP ${p.status}`);
  return p.json;
}

const memoOf = (muxId: string, tag: string | number) => `vants:rf:${BigInt(muxId).toString(36)}:${tag}`;
const evidence: Record<string, unknown> = { startedAt: new Date().toISOString(), network: "testnet", hodle: "sandbox" };

try {
  // The late case needs its quote to expire first: create it now, pay it at the end.
  const late = await newPayment(270);

  // --- D1 -----------------------------------------------------------------------------------------------------------

  log("D1: pay a R$ 2.70 BR Code with 0.5 USDC");
  const d1 = await newPayment(270);
  const d1Deposit = await pay(d1.deposit.address, usdc, d1.deposit.amount);
  const d1Hook = await hookFor(d1.id, "completed");
  const d1View = await api<{ timeline: { status: string; at: string }[]; payout: { endToEndId: string } }>(
    "GET",
    `/v0/payments/${d1.id}`,
  );
  const completedAt = d1View.json.timeline.find((t) => t.status === "completed")?.at ?? "";
  const d1Hooks = hooks.filter((h) => h.payment.id === d1.id);
  evidence.D1 = {
    paymentId: d1.id,
    depositTx: d1Deposit.hash,
    depositLedgerClosedAt: d1Deposit.closedAt,
    payoutCompletedAt: completedAt,
    webhookReceivedAt: d1Hook.at,
    secondsDepositToPayout: secondsBetween(d1Deposit.closedAt, completedAt),
    secondsDepositToWebhook: secondsBetween(d1Deposit.closedAt, d1Hook.at),
    hodleEndToEndId: d1View.json.payout?.endToEndId,
    webhooks: d1Hooks.map((h) => ({ id: h.id, status: h.payment.status, verified: h.verified })),
  };
  expectThat("D1 payout completed and the signed payment.updated webhook says completed", d1Hook.verified, d1.id);
  expectThat(
    "D1 webhooks are all signed and verify",
    d1Hooks.every((h) => h.verified),
    `${d1Hooks.length} received`,
  );

  // --- D5 -----------------------------------------------------------------------------------------------------------

  async function refundCase(
    name: string,
    depositFn: () => Promise<{ hash: string; closedAt: string }>,
    memo: string,
    paymentId?: string,
  ) {
    log(`D5 ${name}`);
    const dep = await depositFn();
    const refund = await refundOnLedger(memo);
    const seconds = secondsBetween(dep.closedAt, refund.closedAt);
    const hook = paymentId ? await hookFor(paymentId, "refunded") : undefined;
    const result = {
      ...(paymentId ? { paymentId } : {}),
      depositTx: dep.hash,
      depositLedgerClosedAt: dep.closedAt,
      refundTx: refund.hash,
      refundLedgerClosedAt: refund.closedAt,
      secondsDepositToRefund: seconds,
      memo,
      refundedTo: refund.to,
      refundAmount: refund.amount,
      refundAsset: refund.asset,
      ...(hook ? { refundedWebhookVerified: hook.verified } : {}),
    };
    expectThat(
      `D5 ${name}: refunded to the sender within 60 s, tagged ${memo}`,
      seconds <= 60 && refund.to === payer.publicKey(),
      `${seconds} s`,
    );
    return result;
  }

  const under = await newPayment(270);
  const d5: Record<string, unknown> = {};
  d5.underpaid = await refundCase(
    "underpaid (0.25 of 0.5 USDC)",
    () => pay(under.deposit.address, usdc, "0.25"),
    memoOf(under.deposit.memoId, 1),
    under.id,
  );

  const unknownMux = (9_000_000_000n + BigInt(Math.floor(Math.random() * 1e9))).toString();
  const unknownAddress = depositInstructions(treasury, unknownMux).address;
  const priorUnattributed = await db.query<{ n: string }>(
    "SELECT count(*) AS n FROM refunds WHERE mux_id = $1 AND payment_id IS NULL",
    [unknownMux],
  );
  d5.unknownMuxedId = await refundCase(
    `unknown muxed id ${unknownMux} (0.1 USDC)`,
    () => pay(unknownAddress, usdc, "0.1"),
    memoOf(unknownMux, `u${Number(priorUnattributed.rows[0]?.n ?? 0) + 1}`),
  );

  const wrong = await newPayment(270);
  d5.wrongAsset = await refundCase(
    "wrong asset (1 XLM to a USDC payment)",
    () => pay(wrong.deposit.address, Asset.native(), "1"),
    memoOf(wrong.deposit.memoId, 1),
    wrong.id,
  );

  const wait = Date.parse(late.deposit.expiresAt) + 5000 - Date.now();
  if (wait > 0) {
    log(`D5 late: waiting ${Math.ceil(wait / 1000)} s for its quote to expire`);
    await sleep(wait);
  }
  d5.late = await refundCase(
    "late (paid after the quote expired)",
    () => pay(late.deposit.address, usdc, late.deposit.amount),
    memoOf(late.deposit.memoId, 1),
    late.id,
  );
  evidence.D5 = d5;

  // --- D4 -----------------------------------------------------------------------------------------------------------

  const snapshot = async (paymentId: string) => {
    const r = await db.query<{
      version: number;
      status: string;
      attempts: number | null;
      inbox: string;
      notes: string;
    }>(
      `SELECT p.version, p.status, o.attempts,
         (SELECT count(*) FROM inbox)::text AS inbox,
         (SELECT count(*) FROM notifications WHERE payment_id = p.id)::text AS notes
       FROM payments p LEFT JOIN payouts o ON o.payment_id = p.id WHERE p.id = $1`,
      [paymentId],
    );
    return r.rows[0];
  };

  log("D4: replay and forge Pier deliveries");
  const pierSecret = process.env.PIER_WEBHOOK_SECRET || env("E2E_PIER_SECRET");
  const pierSimulated = !process.env.PIER_WEBHOOK_SECRET;
  const subscriptionId = env("PIER_SUBSCRIPTION_ID");
  const d1Event = await db.query<{ payload: { event: Record<string, unknown> } }>(
    "SELECT i.payload FROM inbox i JOIN deposits d ON d.id = i.dedupe_key WHERE i.source = 'pier' AND d.tx_hash = $1",
    [d1Deposit.hash],
  );
  const event = d1Event.rows[0]?.payload.event;
  if (!event) throw new Error("D1's Pier event is not in the inbox");
  const pierPost = (raw: string, secret: string, msgId = `msg_${String(event.id)}`) =>
    fetch(`${API}/ingress/pier`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "webhook-id": msgId,
        "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
        "webhook-signature": new Webhook(secret).sign(msgId, new Date(), raw),
      },
      body: raw,
    }).then((r) => r.status);

  const before = await snapshot(d1.id);
  const genuine = JSON.stringify({ subscriptionId, event });
  const replays = [await pierPost(genuine, pierSecret), await pierPost(genuine, pierSecret)];
  const otherKey = `whsec_${randomBytes(32).toString("base64")}`;
  const forgedEvent = { ...event, id: `forged-${Date.now()}`, position: "999999999999" };
  const forgeries = [
    await pierPost(JSON.stringify({ subscriptionId, event: forgedEvent }), otherKey),
    await fetch(`${API}/ingress/pier`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "webhook-id": "msg_tampered",
        "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
        // signed over the genuine body, sent with a different one
        "webhook-signature": new Webhook(pierSecret).sign("msg_tampered", new Date(), genuine),
      },
      body: JSON.stringify({ subscriptionId, event: forgedEvent }),
    }).then((r) => r.status),
  ];
  await sleep(8000); // let the worker drain anything that might have been enqueued
  const after = await snapshot(d1.id);
  const forgedStored = await db.query("SELECT 1 FROM inbox WHERE dedupe_key = $1", [forgedEvent.id]);
  expectThat(
    `D4 Pier replays are accepted (2xx) and change nothing${pierSimulated ? " (simulated)" : ""}`,
    replays.every((s) => s >= 200 && s < 300) && JSON.stringify(before) === JSON.stringify(after),
    `HTTP ${replays.join(", ")}`,
  );
  expectThat(
    `D4 forged Pier deliveries get 401 and store nothing${pierSimulated ? " (simulated)" : ""}`,
    forgeries.every((s) => s === 401) && forgedStored.rows.length === 0,
    `HTTP ${forgeries.join(", ")}`,
  );
  const d4: Record<string, unknown> = {
    pier: {
      simulated: pierSimulated,
      replayStatuses: replays,
      forgedStatuses: forgeries,
      paymentBefore: before,
      paymentAfter: after,
    },
  };

  if (hodleSecret) {
    log("D4: replay and forge Hodle deliveries (simulated: local secret, §11 Q1)");
    const hodlePost = (eventName: string, body: unknown, secret: string) => {
      const raw = JSON.stringify(body);
      const ts = String(Math.floor(Date.now() / 1000));
      return fetch(`${API}/ingress/hodle/${eventName}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hodle-timestamp": ts,
          "x-hodle-signature": createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex"),
        },
        body: raw,
      }).then((r) => r.status);
    };
    const hBefore = await snapshot(d1.id);
    const success = {
      event: "PAYOUT_SUCCESSFUL",
      data: { success: true, transactionId: `e2e-${d1.id}`, externalId: `vants:${d1.id}`, status: "COMPLETED" },
    };
    const hReplays = [
      await hodlePost("PAYOUT_SUCCESSFUL", success, hodleSecret),
      await hodlePost("PAYOUT_SUCCESSFUL", success, hodleSecret),
    ];
    const failed = {
      event: "PAYOUT_FAILED",
      data: { success: false, externalId: `vants:${d1.id}`, errorCode: "PAYOUT_FAILED" },
    };
    const hForged = [await hodlePost("PAYOUT_FAILED", failed, randomBytes(16).toString("hex"))];
    await sleep(8000);
    const hAfter = await snapshot(d1.id);
    const inboxRows = await db.query("SELECT 1 FROM inbox WHERE source = 'hodle' AND dedupe_key = $1", [
      `PAYOUT_SUCCESSFUL:e2e-${d1.id}`,
    ]);
    // The genuine PAYOUT_SUCCESSFUL is stored once and only confirms; nothing else may move.
    const unchanged =
      hBefore?.version === hAfter?.version &&
      hBefore?.status === hAfter?.status &&
      hBefore?.attempts === hAfter?.attempts;
    expectThat(
      "D4 Hodle replays are stored once and change nothing (simulated)",
      hReplays.every((s) => s === 200) && inboxRows.rows.length === 1 && unchanged,
      `HTTP ${hReplays.join(", ")}`,
    );
    expectThat(
      "D4 forged Hodle PAYOUT_FAILED gets 401; the payment stays completed (simulated)",
      hForged.every((s) => s === 401) && hAfter?.status === "completed",
      `HTTP ${hForged.join(", ")}`,
    );
    d4.hodle = {
      simulated: true,
      replayStatuses: hReplays,
      forgedStatuses: hForged,
      paymentBefore: hBefore,
      paymentAfter: hAfter,
    };
  } else {
    log("D4: Hodle half skipped (E2E_HODLE_SECRET not set)");
  }
  evidence.D4 = d4;
} catch (err) {
  expectThat("run completed", false, err instanceof Error ? err.message : String(err));
}

// --- evidence -----------------------------------------------------------------------------------------------------

evidence.finishedAt = new Date().toISOString();
evidence.checks = checks;
mkdirSync("docs/evidence", { recursive: true });
const file = `docs/evidence/g-b-${evidence.startedAt as string}.json`.replaceAll(":", "-");
writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`);
const failedChecks = checks.filter((c) => !c.ok);
log(`${checks.length - failedChecks.length}/${checks.length} checks passed; evidence in ${file}`);
receiver.close();
await db.end();
process.exit(failedChecks.length === 0 ? 0 : 1);
