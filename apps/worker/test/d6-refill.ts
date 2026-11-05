// pnpm d6: D6 (SPEC §1) on Stellar testnet, Circle's CCTP sandbox, Base Sepolia and the Hodle sandbox, against a running
// `pnpm api` and `pnpm worker` whose FLOAT_MIN_USD sits just below the float, so one payout pushes it under. Checks that the
// refill runs end to end (approve, burn, attest, mint, credit) and that a payment made while it runs is paid without waiting.
// Writes docs/evidence/d6-*.json (hashes, ids, timings; no keys).
import { mkdirSync, writeFileSync } from "node:fs";
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
const USDC = "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const horizon = new Horizon.Server("https://horizon-testnet.stellar.org");
const payer = Keypair.fromSecret(env("TEST_PAYER_SECRET"));
const db = new pg.Pool({ connectionString: env("DATABASE_URL") });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (m: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);
const startedAt = new Date();

async function waitFor<T>(what: string, read: () => Promise<T | null | undefined>, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await read();
    if (v !== null && v !== undefined) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(1000);
  }
}

const integrator = await (async () => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const r = await createIntegrator(
      { query: async (t, v) => ({ rows: (await client.query(t, v)).rows }) },
      `d6 ${startedAt.toISOString()}`,
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
        : { "content-type": "application/json", "idempotency-key": `d6-${Date.now()}-${++idem}` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, json: (await res.json()) as T };
};

/** A R$ 2.70 BR Code paid with 0.5 USDC; resolves when the payment is completed. */
async function payOne(label: string) {
  const merchant = { key: "pix-spike@vants.example.com", merchantName: "VANTS TESTE", merchantCity: "SAO PAULO" };
  const q = await api<{ id: string }>("POST", "/v0/quotes", {
    destination: { type: "br_code", brCode: buildStaticBrCode({ ...merchant, amountCents: 270 }) },
    asset: USDC,
  });
  if (q.status !== 201) throw new Error(`${label}: quote HTTP ${q.status} ${JSON.stringify(q.json)}`);
  const p = await api<{ id: string; deposit: { address: string; amount: string } }>("POST", "/v0/payments", {
    quoteId: q.json.id,
  });
  if (p.status !== 201) throw new Error(`${label}: payment HTTP ${p.status}`);
  const tx = new TransactionBuilder(await horizon.loadAccount(payer.publicKey()), {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: p.json.deposit.address,
        asset: new Asset("USDC", USDC.split(":")[1] ?? ""),
        amount: p.json.deposit.amount,
      }),
    )
    .setTimeout(60)
    .build();
  tx.sign(payer);
  const paid = await horizon.submitTransaction(tx);
  log(`${label}: ${p.json.id} paid on Stellar (${paid.hash.slice(0, 8)}…)`);
  await waitFor(
    `${label} completed`,
    async () => {
      const v = await api<{ status: string }>("GET", `/v0/payments/${p.json.id}`);
      return v.json.status === "completed"
        ? v
        : v.json.status === "refunded"
          ? Promise.reject(new Error(`${label} refunded`))
          : null;
    },
    120_000,
  );
  const completedAt = new Date().toISOString();
  log(`${label}: completed`);
  return { paymentId: p.json.id, depositTx: paid.hash, completedAt };
}

interface RefillDbRow {
  id: string;
  status: string;
  amount6: string;
  approve_hash: string | null;
  burn_hash: string | null;
  mint_hash: string | null;
  fee_executed6: string | null;
  minted6: string | null;
  credit_cents: number | null;
  credit6: string | null;
  track_id: string | null;
  attempts: number;
  last_error: string | null;
  created_at: Date;
  finished_at: Date | null;
}
const refill = async () =>
  (
    await db.query<RefillDbRow>(
      `SELECT id, status, amount6::text, approve_hash, burn_hash, mint_hash, fee_executed6::text, minted6::text, credit_cents,
         credit6::text, track_id, attempts, last_error, created_at, finished_at
       FROM refills WHERE created_at >= $1 ORDER BY created_at LIMIT 1`,
      [startedAt.toISOString()],
    )
  ).rows[0];
const floatBooks = async () =>
  (
    await db.query<{ v: string }>(
      "SELECT COALESCE(sum(amount),0)::text AS v FROM ledger_entries WHERE account='float:hodle' AND asset='USDH'",
    )
  ).rows[0]?.v;

const evidence: Record<string, unknown> = { startedAt: startedAt.toISOString(), floatBefore6: await floatBooks() };

// 1. A payout that takes the float below its minimum.
evidence.paymentA = await payOne("payment A");
const r0 = await waitFor("a refill to start", refill, 120_000);
log(`refill ${r0.id} started (${r0.status}), amount ${Number(r0.amount6) / 1e6} USDC`);

// 2. While it runs, another payment is paid without waiting for it; meanwhile, record the refill's phases.
const timeline: { status: string; at: string }[] = [{ status: r0.status, at: new Date().toISOString() }];
let watching = true;
const watcher = (async () => {
  while (watching) {
    const r = await refill();
    if (r && r.status !== timeline.at(-1)?.status) {
      timeline.push({ status: r.status, at: new Date().toISOString() });
      log(`refill → ${r.status}`);
    }
    if (r?.status === "completed" || r?.status === "failed") return;
    await sleep(500);
  }
})();
const paymentB = await payOne("payment B (during the refill)");
const refillAtB = await refill();
evidence.paymentB = { ...paymentB, refillStatusWhenCompleted: refillAtB?.status };

await waitFor(
  "the refill to finish",
  async () => {
    const r = await refill();
    return r?.status === "completed" || r?.status === "failed" ? r : null;
  },
  360_000,
);
watching = false;
await watcher;
const done = await refill();
const events = await db.query<{ type: string; occurred_at: Date; payload: unknown }>(
  "SELECT type, occurred_at, payload FROM outbox WHERE type IN ('FloatLow', 'CctpBurned', 'CctpMinted', 'FloatCredited') AND occurred_at >= $1 ORDER BY occurred_at",
  [startedAt.toISOString()],
);
evidence.refill = { ...done, timeline };
evidence.events = events.rows.map((e) => ({ type: e.type, at: e.occurred_at.toISOString(), payload: e.payload }));
evidence.floatAfter6 = await floatBooks();
const checks = {
  refillCompleted: done?.status === "completed",
  paymentBNotBlocked: refillAtB?.status !== "completed" && refillAtB?.status !== undefined,
  creditExact: done?.credit6 === done?.minted6,
};
evidence.checks = checks;
mkdirSync("docs/evidence", { recursive: true });
const file = `docs/evidence/d6-${startedAt.toISOString()}.json`.replaceAll(":", "-");
writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`);
log(`checks ${JSON.stringify(checks)}; evidence in ${file}`);
await db.end();
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
