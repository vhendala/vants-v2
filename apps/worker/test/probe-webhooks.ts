// pnpm probe:webhooks: T-007 (SPEC §11 Q1) and a non-simulated D4, against a running `pnpm api` + `pnpm worker` behind the
// ngrok tunnel (PUBLIC_BASE_URL), with the Hodle webhooks registered in the sandbox dashboard.
//   T-007  does a sandbox USDH payout emit PAYOUT_SUCCESSFUL, and a settled sandbox deposit DEPOSIT_ASSET_SUCCESS? Which ids
//          do their bodies carry?
//   D4     every genuine Pier and Hodle delivery of this run, taken from ngrok's request capture, is replayed byte for byte
//          twice (no state change) and once tampered (401, nothing stored).
// Writes docs/evidence/t-007-*.json (ids, field names, statuses, timings; no keys or secrets).
import { mkdirSync, writeFileSync } from "node:fs";
import { HodleClient } from "@vants/adapter-hodle";
import { createIntegrator } from "@vants/db";
import { buildStaticBrCode } from "@vants/pix";
import { Asset, BASE_FEE, Horizon, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import pg from "pg";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};
const API = `http://127.0.0.1:${process.env.API_PORT ?? "3100"}`;
const PUBLIC = env("PUBLIC_BASE_URL").replace(/\/$/, "");
const NGROK = "http://127.0.0.1:4040";
const USDC = "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const horizon = new Horizon.Server("https://horizon-testnet.stellar.org");
const payer = Keypair.fromSecret(env("TEST_PAYER_SECRET"));
const db = new pg.Pool({ connectionString: env("DATABASE_URL") });
const hodle = new HodleClient({ baseUrl: env("HODLE_SANDBOX_BASE_URL"), apiKey: env("HODLE_SANDBOX_API_KEY") });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (msg: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${msg}`);
const checks: { check: string; ok: boolean; detail: string }[] = [];
/** What the sandbox does, recorded as found: an answer to T-007, not a pass/fail check. */
const observations: { question: string; answer: boolean; detail: string }[] = [];
const observe = (question: string, answer: boolean, detail = "") => {
  observations.push({ question, answer, detail });
  log(`OBSERVED ${question}: ${answer ? "yes" : "no"}${detail ? ` (${detail})` : ""}`);
};
const expectThat = (check: string, ok: boolean, detail = "") => {
  checks.push({ check, ok, detail });
  log(`${ok ? "PASS" : "FAIL"} ${check}${detail ? ` (${detail})` : ""}`);
};
async function waitFor<T>(read: () => Promise<T | null | undefined>, timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await read();
    if (v !== null && v !== undefined) return v;
    if (Date.now() > deadline) return null;
    await sleep(1000);
  }
}

const startedAt = new Date();
const evidence: Record<string, unknown> = { startedAt: startedAt.toISOString(), publicBaseUrl: PUBLIC };

// --- ngrok capture: genuine deliveries and byte-for-byte replays --------------------------------------------------

interface Captured {
  id: string;
  start: string;
  uri: string;
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

const SIGNING_HEADERS = /^(content-type|webhook-id|webhook-timestamp|webhook-signature|x-hodle-.*)$/i;

async function captured(): Promise<Captured[]> {
  const r = (await (await fetch(`${NGROK}/api/requests/http?limit=100`)).json()) as {
    requests: {
      id: string;
      start: string;
      request: { method: string; uri: string; headers: Record<string, string[]>; raw: string };
      response?: { status_code: number };
    }[];
  };
  return r.requests
    .filter((q) => q.request.method === "POST" && /^\/ingress\/(pier|hodle\/)/.test(q.request.uri))
    .filter((q) => !Object.keys(q.request.headers).some((h) => h.toLowerCase() === "x-vants-probe"))
    .filter((q) => Date.parse(q.start) >= startedAt.getTime())
    .map((q) => {
      const raw = Buffer.from(q.request.raw, "base64");
      const split = raw.indexOf("\r\n\r\n");
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(q.request.headers)) if (SIGNING_HEADERS.test(k)) headers[k] = v[0] ?? "";
      return {
        id: q.id,
        start: q.start,
        uri: q.request.uri,
        status: q.response?.status_code ?? 0,
        headers,
        body: split >= 0 ? raw.subarray(split + 4) : Buffer.alloc(0),
      };
    });
}

const resend = (c: Captured, body: Buffer, tag: string) =>
  fetch(`${PUBLIC}${c.uri}`, {
    method: "POST",
    headers: { ...c.headers, "x-vants-probe": tag, "ngrok-skip-browser-warning": "1" },
    body,
  }).then((r) => r.status);

const state = async (paymentId: string) =>
  (
    await db.query(
      `SELECT (SELECT count(*) FROM inbox)::int AS inbox, (SELECT count(*) FROM deposits)::int AS deposits,
         (SELECT count(*) FROM refunds)::int AS refunds, p.version, p.status, o.attempts, o.confirmed_at IS NOT NULL AS confirmed
       FROM payments p LEFT JOIN payouts o ON o.payment_id = p.id WHERE p.id = $1`,
      [paymentId],
    )
  ).rows[0];

const replayed = new Set<string>();
const d4: unknown[] = [];

/** Replays every genuine delivery captured so far (twice, then tampered) and checks that nothing moved. */
async function replayCaptured(paymentId: string) {
  const fresh = (await captured()).filter((c) => !replayed.has(c.id) && c.status >= 200 && c.status < 300);
  for (const c of fresh) {
    replayed.add(c.id);
    const before = await state(paymentId);
    const replays = [await resend(c, c.body, "replay"), await resend(c, c.body, "replay")];
    const tampered = Buffer.from(c.body.toString("utf8").replace(/}\s*$/, ',"vantsProbe":"tampered"}'));
    const forged = await resend(c, tampered, "tampered");
    await sleep(5000); // let the worker drain anything a replay might have enqueued
    const after = await state(paymentId);
    const ageSeconds = Math.round((Date.now() - Date.parse(c.start)) / 1000);
    d4.push({
      uri: c.uri,
      deliveredAt: c.start,
      originalStatus: c.status,
      replayStatuses: replays,
      tamperedStatus: forged,
      ageSeconds,
      before,
      after,
    });
    expectThat(
      `D4 ${c.uri}: genuine delivery replayed twice is a no-op; tampered copy → 401`,
      replays.every((s) => s >= 200 && s < 300) && forged === 401 && JSON.stringify(before) === JSON.stringify(after),
      `replays ${replays.join(", ")}, tampered ${forged}, ${ageSeconds} s after the original`,
    );
  }
}

// --- a payment, paid for real ---------------------------------------------------------------------------------

const integrator = await (async () => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const r = await createIntegrator(
      { query: async (t, v) => ({ rows: (await client.query(t, v)).rows }) },
      `probe ${startedAt.toISOString()}`,
      env("INTEGRATOR_KEY_PEPPER"),
    );
    await client.query("COMMIT");
    return r;
  } finally {
    client.release();
  }
})();
let idem = 0;
const api = async <T>(method: string, path: string, body?: unknown) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "x-api-key": integrator.apiKey,
      ...(body === undefined
        ? {}
        : { "content-type": "application/json", "idempotency-key": `probe-${Date.now()}-${++idem}` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return (await res.json()) as T;
};

const merchant = { key: "pix-spike@vants.example.com", merchantName: "VANTS TESTE", merchantCity: "SAO PAULO" };
const quote = await api<{ id: string }>("POST", "/v0/quotes", {
  destination: { type: "br_code", brCode: buildStaticBrCode({ ...merchant, amountCents: 270 }) },
  asset: USDC,
});
const payment = await api<{ id: string; deposit: { address: string; amount: string } }>("POST", "/v0/payments", {
  quoteId: quote.id,
});
log(`payment ${payment.id}: paying ${payment.deposit.amount} USDC`);
const tx = new TransactionBuilder(await horizon.loadAccount(payer.publicKey()), {
  fee: BASE_FEE,
  networkPassphrase: Networks.TESTNET,
})
  .addOperation(
    Operation.payment({
      destination: payment.deposit.address,
      asset: new Asset("USDC", USDC.split(":")[1] ?? ""),
      amount: payment.deposit.amount,
    }),
  )
  .setTimeout(60)
  .build();
tx.sign(payer);
const paid = await horizon.submitTransaction(tx);
const completed = await waitFor(async () => {
  const p = await api<{ status: string; payout: { endToEndId: string; txHash: string } | null }>(
    "GET",
    `/v0/payments/${payment.id}`,
  );
  return p.status === "completed" || p.status === "refunded" ? p : null;
}, 120_000);
expectThat(
  "the payment completed (sandbox payout)",
  completed?.status === "completed",
  completed?.status ?? "timed out",
);

const pierWebhook = (await captured()).find((c) => c.uri === "/ingress/pier");
expectThat(
  "Pier pushed the deposit through the tunnel",
  Boolean(pierWebhook),
  pierWebhook ? `HTTP ${pierWebhook.status}` : "none captured",
);

// --- T-007: payout webhook ------------------------------------------------------------------------------------

interface HodleRow {
  event: string;
  dedupe_key: string;
  received_at: Date;
  data: Record<string, unknown>;
}
const hodleRows = async (prefix: string) =>
  (
    await db.query<HodleRow>(
      `SELECT payload->>'event' AS event, dedupe_key, received_at, payload->'data' AS data FROM inbox
       WHERE source = 'hodle' AND payload->>'event' LIKE $1 AND received_at >= $2 ORDER BY received_at`,
      [`${prefix}%`, startedAt.toISOString()],
    )
  ).rows;
const describeBody = (r: HodleRow) => {
  const pick = [
    "transactionId",
    "externalId",
    "trackId",
    "eventId",
    "invoice",
    "txHash",
    "status",
    "endToEndId",
    "success",
  ];
  return {
    event: r.event,
    dedupeKey: r.dedupe_key,
    receivedAt: r.received_at.toISOString(),
    fields: Object.keys(r.data).sort(),
    ids: Object.fromEntries(pick.filter((k) => k in r.data).map((k) => [k, r.data[k]])),
  };
};

log("T-007: waiting up to 120 s for a PAYOUT_* webhook");
const payoutHooks =
  (await waitFor(async () => ((await hodleRows("PAYOUT_")).length > 0 ? hodleRows("PAYOUT_") : null), 120_000)) ?? [];
const payoutRow = await db.query<{
  external_id: string;
  confirmed_at: Date | null;
  response: { txHash?: string } | null;
}>("SELECT external_id, confirmed_at, response FROM payouts WHERE payment_id = $1", [payment.id]);
evidence.payout = {
  paymentId: payment.id,
  depositTx: paid.hash,
  hodleEndToEndId: completed?.payout?.endToEndId,
  hodleTxHash: completed?.payout?.txHash,
  webhooks: payoutHooks.map(describeBody),
  matchedToPayout: payoutRow.rows[0]?.confirmed_at != null,
};
observe(
  "T-007 does the sandbox USDH payout emit PAYOUT_SUCCESSFUL?",
  payoutHooks.some((h) => h.event === "PAYOUT_SUCCESSFUL"),
  payoutHooks.map((h) => h.event).join(", ") || "nothing in 120 s",
);
if (payoutHooks.length > 0) {
  expectThat(
    "the webhook was matched to our payout (confirmed_at set)",
    payoutRow.rows[0]?.confirmed_at != null,
    `externalId in body: ${payoutHooks.some((h) => h.data.externalId === `vants:${payment.id}`)}`,
  );
}
await replayCaptured(payment.id);

// --- T-007: deposit webhook -----------------------------------------------------------------------------------

log("T-007: sandbox USDH deposit of R$ 1.00, settled");
const dep = await hodle.createSandboxDeposit(100);
const settled = await hodle.settleSandboxDeposit(dep.trackId);
log(`deposit trackId ${dep.trackId}: settled ${settled}; waiting up to 120 s for a DEPOSIT_ASSET_* webhook`);
const depositHooks =
  (await waitFor(async () => ((await hodleRows("DEPOSIT_")).length > 0 ? hodleRows("DEPOSIT_") : null), 120_000)) ?? [];
evidence.deposit = {
  trackId: dep.trackId,
  externalId: dep.externalId,
  settled,
  webhooks: depositHooks.map(describeBody),
};
observe(
  "T-007 does a settled sandbox deposit emit DEPOSIT_ASSET_SUCCESS?",
  depositHooks.some((h) => h.event === "DEPOSIT_ASSET_SUCCESS"),
  depositHooks.map((h) => h.event).join(", ") || "nothing in 120 s",
);
if (depositHooks.length > 0) {
  const ids = depositHooks.map((h) => h.data);
  expectThat(
    "the deposit webhook names our deposit (trackId or externalId)",
    ids.some(
      (d) => d.trackId === dep.trackId || d.externalId === dep.externalId || JSON.stringify(d).includes(dep.trackId),
    ),
  );
}
await replayCaptured(payment.id);

evidence.D4 = d4;
evidence.finishedAt = new Date().toISOString();
evidence.observations = observations;
evidence.checks = checks;
mkdirSync("docs/evidence", { recursive: true });
const file = `docs/evidence/t-007-${startedAt.toISOString()}.json`.replaceAll(":", "-");
writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`);
const failed = checks.filter((c) => !c.ok);
log(`${checks.length - failed.length}/${checks.length} checks passed; evidence in ${file}`);
await db.end();
process.exit(failed.length === 0 ? 0 : 1);
