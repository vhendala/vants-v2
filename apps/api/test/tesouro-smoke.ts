// pnpm tesouro:smoke: Tesouro end to end over the public URL (T-029). The test payer's local testnet key stands in for the
// wallet: it accepts Tesouro if it hasn't, buys R$ 30 of it with lumens on the order book (Etherfuse's market maker), sees
// it in the portfolio as payable, then pays a R$ 5,40 code from Tesouro alone: ONE signature, sold for dollars on the way.
// Writes docs/evidence/t-029-tesouro-*.json.
import { writeFileSync } from "node:fs";
import { buildStaticBrCode } from "@vants/pix";
import { Keypair, Networks, type Transaction, TransactionBuilder, WebAuth } from "@stellar/stellar-sdk";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};
const BASE = env("PUBLIC_BASE_URL").replace(/\/$/, "");
const TESOURO = "TESOURO:GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4";
const payer = Keypair.fromSecret(env("TEST_PAYER_SECRET"));
const log = (m: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const startedAt = new Date();
let token = "";
const call = async <T>(method: string, url: string, body?: unknown): Promise<{ status: number; json: T }> => {
  const res = await fetch(url.startsWith("http") ? url : `${BASE}${url}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as T };
};
const signed = (xdr: string) => {
  const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET) as Transaction;
  tx.sign(payer);
  return tx;
};
type Built = { id: string; transaction: { xdr: string; hash: string; summary: string[] } };
/** Signs and submits an action, then waits for the network to say done. */
const runAction = async (a: Built) => {
  await call("POST", `/app/actions/${a.id}/submit`, { signedXdr: signed(a.transaction.xdr).toXDR() });
  for (let i = 0; i < 40; i++) {
    const v = await call<{ status: string }>("GET", `/app/actions/${a.id}`);
    if (v.json.status === "done") return;
    if (v.json.status === "failed") throw new Error(`action ${a.id} failed`);
    await sleep(1500);
  }
  throw new Error(`action ${a.id} never settled`);
};

// SEP-10, the server's signature checked first.
const toml = await (await fetch(`${BASE}/.well-known/stellar.toml`)).text();
const field = (k: string) => new RegExp(`^${k}="([^"]+)"`, "m").exec(toml)?.[1] ?? "";
const authEndpoint = field("WEB_AUTH_ENDPOINT");
const home = new URL(authEndpoint).host;
const ch = await call<{ transaction: string }>("GET", `${authEndpoint}?account=${payer.publicKey()}`);
WebAuth.readChallengeTx(ch.json.transaction, field("SIGNING_KEY"), Networks.TESTNET, home, home);
token = (await call<{ token: string }>("POST", authEndpoint, { transaction: signed(ch.json.transaction).toXDR() })).json
  .token;
log(`logged in as ${payer.publicKey().slice(0, 8)}…`);

// 1. Accept Tesouro (once), then buy R$ 30 of it.
const trust = await call<Built | { needed: false }>("POST", "/app/ramp/trustline", { target: "TESOURO" });
let trustline: unknown = null;
if ("transaction" in trust.json) {
  await runAction(trust.json);
  trustline = { txHash: trust.json.transaction.hash, summary: trust.json.transaction.summary };
  log(`accepted Tesouro (${trust.json.transaction.hash.slice(0, 12)}…)`);
}
const buy = await call<Built>("POST", "/app/tesouro", { side: "buy", amountBrl: "30" });
if (buy.status !== 201) throw new Error(`buy: ${buy.status} ${JSON.stringify(buy.json)}`);
log(`buy: ${buy.json.transaction.summary.join(" | ")}`);
await runAction(buy.json);
log(`bought (${buy.json.transaction.hash.slice(0, 12)}…)`);

// 2. The portfolio shows it, priced from the book and payable.
type Pos = { id: string; amount: string; valueUsd: string | null; payable: boolean; pricing: string };
const portfolio = await call<{ positions: Pos[] }>("GET", "/app/portfolio");
const position = portfolio.json.positions.find((p) => p.id === `classic:${TESOURO}`);
log(`portfolio: ${JSON.stringify(position)}`);
if (!position?.payable) throw new Error("Tesouro is not payable in the portfolio");

// 3. Pay R$ 5,40 from Tesouro alone.
const brCode = buildStaticBrCode({
  key: "pix-spike@vants.example.com",
  merchantName: "VANTS TESTE",
  merchantCity: "SAO PAULO",
  amountCents: 540,
});
const created = await call<{
  id: string;
  paymentId: string;
  route: string;
  asset: string;
  transaction: { xdr: string; hash: string; summary: string[] };
}>("POST", "/app/exits", { destination: { type: "br_code", brCode }, picks: [`classic:${TESOURO}`] });
if (created.status !== 201) throw new Error(`exit: ${created.status} ${JSON.stringify(created.json)}`);
const exit = created.json;
log(`exit ${exit.id} (${exit.route}):`);
for (const line of exit.transaction.summary) log(`  · ${line}`);
const tx = signed(exit.transaction.xdr);
const signedAt = Date.now();
const submitted = await call<{ status: string }>("POST", `/app/exits/${exit.id}/submit`, { signedXdr: tx.toXDR() });
log(`submitted: HTTP ${submitted.status} (${tx.signatures.length} signature, ${tx.operations.length} operation)`);
let status = "";
let e2e: string | undefined;
for (let i = 0; i < 90 && status !== "completed" && status !== "refunded"; i++) {
  await sleep(1500);
  const v = await call<{ payment: { status: string; payout: { endToEndId: string } | null } }>(
    "GET",
    `/app/exits/${exit.id}`,
  );
  status = v.json.payment?.status ?? "";
  e2e = v.json.payment?.payout?.endToEndId;
}
const seconds = (Date.now() - signedAt) / 1000;
log(`payment ${exit.paymentId}: ${status} ${e2e ? `(E2E ${e2e})` : ""} ${seconds.toFixed(1)} s after signing`);

const ok = status === "completed" && tx.signatures.length === 1 && submitted.status === 202;
const file = `docs/evidence/t-029-tesouro-${startedAt.toISOString()}.json`.replaceAll(":", "-");
writeFileSync(
  file,
  `${JSON.stringify(
    {
      startedAt: startedAt.toISOString(),
      account: payer.publicKey(),
      trustline,
      buy: { txHash: buy.json.transaction.hash, summary: buy.json.transaction.summary },
      position,
      exit: {
        id: exit.id,
        paymentId: exit.paymentId,
        route: exit.route,
        asset: exit.asset,
        summary: exit.transaction.summary,
        txHash: exit.transaction.hash,
      },
      signatures: tx.signatures.length,
      operations: tx.operations.length,
      paymentStatus: status,
      endToEndId: e2e ?? null,
      secondsAfterSigning: seconds,
    },
    null,
    2,
  )}\n`,
);
log(`${ok ? "PASS" : "FAIL"}; evidence in ${file}`);
process.exit(ok ? 0 : 1);
