// pnpm app:smoke: the mini app's backend end to end, as a wallet uses it, over the public URL (T-020): stellar.toml →
// SEP-10 challenge (server signature checked) → JWT → portfolio → price → exit → ONE signature → submit → completed.
// The test payer's local testnet key stands in for the wallet. Writes docs/evidence/t-020-app-*.json.
import { writeFileSync } from "node:fs";
import { buildStaticBrCode } from "@vants/pix";
import { Keypair, Networks, type Transaction, TransactionBuilder, WebAuth } from "@stellar/stellar-sdk";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};
const BASE = env("PUBLIC_BASE_URL").replace(/\/$/, "");
// SMOKE_FRESH=1: a brand-new Friendbot account (XLM only, no USDC trustline), as a first-time wallet user would be.
const payer = process.env.SMOKE_FRESH === "1" ? Keypair.random() : Keypair.fromSecret(env("TEST_PAYER_SECRET"));
if (process.env.SMOKE_FRESH === "1") {
  const funded = await fetch(`https://friendbot.stellar.org?addr=${payer.publicKey()}`);
  if (!funded.ok) throw new Error(`friendbot: ${funded.status}`);
}
const log = (m: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const startedAt = new Date();
const headers = { "ngrok-skip-browser-warning": "1" };

const call = async <T>(
  method: string,
  url: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; json: T }> => {
  const res = await fetch(url.startsWith("http") ? url : `${BASE}${url}`, {
    method,
    headers: {
      ...headers,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as T };
};

// 1. Discovery (SEP-1).
const toml = await (await fetch(`${BASE}/.well-known/stellar.toml`, { headers })).text();
const field = (k: string) => new RegExp(`^${k}="([^"]+)"`, "m").exec(toml)?.[1] ?? "";
const authEndpoint = field("WEB_AUTH_ENDPOINT");
const signingKey = field("SIGNING_KEY");
const home = new URL(authEndpoint).host;
log(`stellar.toml: WEB_AUTH_ENDPOINT ${authEndpoint}, SIGNING_KEY ${signingKey.slice(0, 6)}…`);

// 2–3. SEP-10: the wallet checks the server signed the challenge before signing it.
const ch = await call<{ transaction: string }>("GET", `${authEndpoint}?account=${payer.publicKey()}`);
WebAuth.readChallengeTx(ch.json.transaction, signingKey, Networks.TESTNET, home, home);
const challenge = TransactionBuilder.fromXDR(ch.json.transaction, Networks.TESTNET) as Transaction;
challenge.sign(payer);
const auth = await call<{ token: string }>("POST", authEndpoint, { transaction: challenge.toXDR() });
if (auth.status !== 200) throw new Error(`login failed: ${JSON.stringify(auth.json)}`);
const token = auth.json.token;
log("logged in with SEP-10");

// 4. Portfolio and price.
const portfolio = await call<{ positions: { id: string; amount: string; valueUsd: string | null }[] }>(
  "GET",
  "/app/portfolio",
  undefined,
  token,
);
const brCode = buildStaticBrCode({
  key: "pix-spike@vants.example.com",
  merchantName: "VANTS TESTE",
  merchantCity: "SAO PAULO",
  amountCents: 270,
});
const priced = await call<{ amountBrl: string; assets: unknown[] }>(
  "POST",
  "/app/exits/quote",
  { destination: { type: "br_code", brCode } },
  token,
);
log(`portfolio: ${portfolio.json.positions.map((p) => p.id).join(", ")}; the code charges R$ ${priced.json.amountBrl}`);

// 5. The exit: ONE transaction; the wallet signs it once.
const created = await call<{
  id: string;
  paymentId: string;
  route: string;
  transaction: { xdr: string; hash: string; summary: string[] };
}>("POST", "/app/exits", { destination: { type: "br_code", brCode }, picks: ["classic:native"] }, token);
if (created.status !== 201) throw new Error(`exit: ${created.status} ${JSON.stringify(created.json)}`);
const exit = created.json;
log(`exit ${exit.id} (${exit.route}): ${exit.transaction.summary.join(" → ")}`);
const tx = TransactionBuilder.fromXDR(exit.transaction.xdr, Networks.TESTNET) as Transaction;
tx.sign(payer);

// 6. Submit and follow the payment.
const submitted = await call<{ status: string; txHash: string }>(
  "POST",
  `/app/exits/${exit.id}/submit`,
  { signedXdr: tx.toXDR() },
  token,
);
log(`submitted: HTTP ${submitted.status} (${tx.signatures.length} signature, ${tx.operations.length} operation(s))`);
let status = "";
for (let i = 0; i < 90 && status !== "completed" && status !== "refunded"; i++) {
  await sleep(1500);
  status =
    (await call<{ payment: { status: string } }>("GET", `/app/exits/${exit.id}`, undefined, token)).json.payment
      ?.status ?? "";
}
log(`payment ${exit.paymentId}: ${status}`);

const evidence = {
  startedAt: startedAt.toISOString(),
  publicBaseUrl: BASE,
  stellarToml: { WEB_AUTH_ENDPOINT: authEndpoint, SIGNING_KEY: signingKey },
  login: "SEP-10 challenge verified (server signature) and signed by the account; JWT issued",
  freshAccount: process.env.SMOKE_FRESH === "1",
  operationTypes: tx.operations.map((op) => op.type),
  exit: {
    id: exit.id,
    paymentId: exit.paymentId,
    route: exit.route,
    summary: exit.transaction.summary,
    txHash: exit.transaction.hash,
  },
  signatures: tx.signatures.length,
  operations: tx.operations.length,
  submitHttp: submitted.status,
  paymentStatus: status,
};
const file = `docs/evidence/t-020-app-${startedAt.toISOString()}.json`.replaceAll(":", "-");
writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`);
const ok = status === "completed" && tx.signatures.length === 1 && submitted.status === 202;
log(`${ok ? "PASS" : "FAIL"}; evidence in ${file}`);
process.exit(ok ? 0 : 1);
