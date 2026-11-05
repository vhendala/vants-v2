// pnpm money:smoke: investing and adding money end to end, as a wallet uses them, over the public URL (T-026). A brand-new
// Friendbot account logs in with SEP-10, invests lumens in the DeFindex XLM vault, takes part out, then adds money by Pix
// through the Etherfuse sandbox: details once → price → accept dollars (one confirmation) → order → simulated Pix → status.
// The account's local key stands in for the wallet. Testnet and sandbox only. Writes docs/evidence/t-026-money-*.json.
import { writeFileSync } from "node:fs";
import { Keypair, Networks, type Transaction, TransactionBuilder, WebAuth } from "@stellar/stellar-sdk";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};
const BASE = env("PUBLIC_BASE_URL").replace(/\/$/, "");
const XLM_VAULT = "CD72HOSTSKA2KA4RMVOKVARM7SXBJ7IV54NCPJEEY4ZWOXOQPVFC5SIJ";
const wallet = Keypair.random();
const log = (m: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const startedAt = new Date();
const headers = { "ngrok-skip-browser-warning": "1" };
const evidence: Record<string, unknown> = { startedAt: startedAt.toISOString(), account: wallet.publicKey() };

const funded = await fetch(`https://friendbot.stellar.org?addr=${wallet.publicKey()}`);
if (!funded.ok) throw new Error(`friendbot: ${funded.status}`);
log(`new account ${wallet.publicKey().slice(0, 8)}… funded by Friendbot`);

let token = "";
const call = async <T>(method: string, url: string, body?: unknown): Promise<{ status: number; json: T }> => {
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
const must = <T>(r: { status: number; json: T }, what: string, ok = [200, 201, 202]) => {
  if (!ok.includes(r.status)) throw new Error(`${what}: HTTP ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
};

// SEP-10, the server's signature checked first.
const toml = await (await fetch(`${BASE}/.well-known/stellar.toml`, { headers })).text();
const field = (k: string) => new RegExp(`^${k}="([^"]+)"`, "m").exec(toml)?.[1] ?? "";
const authEndpoint = field("WEB_AUTH_ENDPOINT");
const home = new URL(authEndpoint).host;
const ch = must(
  await call<{ transaction: string }>("GET", `${authEndpoint}?account=${wallet.publicKey()}`),
  "challenge",
);
WebAuth.readChallengeTx(ch.transaction, field("SIGNING_KEY"), Networks.TESTNET, home, home);
const challenge = TransactionBuilder.fromXDR(ch.transaction, Networks.TESTNET) as Transaction;
challenge.sign(wallet);
token = must(await call<{ token: string }>("POST", authEndpoint, { transaction: challenge.toXDR() }), "login").token;
log("logged in with SEP-10");

interface Action {
  id: string;
  kind: string;
  transaction: { xdr: string; hash: string; summary: string[] };
}
/** The wallet's part: sign exactly what was built, submit, and wait for the network. */
async function confirm(action: Action, label: string) {
  log(`${label}: the wallet is asked to confirm → ${action.transaction.summary.join(" | ")}`);
  const tx = TransactionBuilder.fromXDR(action.transaction.xdr, Networks.TESTNET) as Transaction;
  tx.sign(wallet);
  const signedAt = Date.now();
  must(await call("POST", `/app/actions/${action.id}/submit`, { signedXdr: tx.toXDR() }), `${label} submit`);
  for (let i = 0; i < 40; i++) {
    const v = must(await call<{ status: string }>("GET", `/app/actions/${action.id}`), `${label} status`);
    if (v.status === "done" || v.status === "failed") {
      const seconds = (Date.now() - signedAt) / 1000;
      log(`${label}: ${v.status} in ${seconds.toFixed(1)} s (tx ${action.transaction.hash.slice(0, 12)}…)`);
      if (v.status !== "done") throw new Error(`${label} failed on the network`);
      return { id: action.id, txHash: action.transaction.hash, summary: action.transaction.summary, seconds };
    }
    await sleep(1500);
  }
  throw new Error(`${label}: not settled after 60 s`);
}

// 1. Invest 10 lumens in "Lumens que rendem", then take 4 out.
type Vaults = {
  vaults: { id: string; name: string; apyPercent: number | null; invested: string; canInvest: string }[];
};
const before = must(await call<Vaults>("GET", "/app/invest"), "invest list");
const xlm = before.vaults.find((v) => v.id === XLM_VAULT);
log(
  `offer: ${before.vaults.map((v) => `${v.name} ${v.apyPercent ?? "?"}%`).join(", ")}; can invest ${xlm?.canInvest} XLM`,
);
const deposit = await confirm(
  must(await call<Action>("POST", "/app/invest", { vault: XLM_VAULT, amount: "10" }), "invest"),
  "invest",
);
const after = must(await call<Vaults>("GET", "/app/invest"), "invest list").vaults.find((v) => v.id === XLM_VAULT);
log(`invested now: ${after?.invested} XLM`);
const redeem = await confirm(
  must(await call<Action>("POST", "/app/redeem", { vault: XLM_VAULT, amount: "4" }), "redeem"),
  "redeem",
);
const end = must(await call<Vaults>("GET", "/app/invest"), "invest list").vaults.find((v) => v.id === XLM_VAULT);
log(`invested after taking 4 out: ${end?.invested} XLM`);
evidence.invest = {
  offer: before.vaults.map((v) => ({ name: v.name, apyPercent: v.apyPercent })),
  deposit,
  investedAfterDeposit: after?.invested,
  redeem,
  investedAfterRedeem: end?.invested,
};

// 2. Add money by Pix (Etherfuse sandbox): R$ 50 → dollars.
const ramp = must(await call<{ available: boolean }>("GET", "/app/ramp"), "ramp");
if (!ramp.available) throw new Error("the ramp isn't configured on this server");
const early = await call<{ error: { code: string } }>("POST", "/app/ramp/quote", { target: "USDC", amountBrl: "50" });
log(`price before details: HTTP ${early.status} ${early.json.error?.code}`);
const profileStarted = Date.now();
must(
  await call("POST", "/app/ramp/profile", {
    givenName: "Ana",
    familyName: "Teste",
    cpf: "529.982.247-25",
    birthDate: "1990-04-12",
    email: `ana.teste+${wallet.publicKey().slice(1, 9).toLowerCase()}@exemplo.com.br`,
    phone: "(11) 98765-4321",
    occupation: "Designer",
    address: { street: "Avenida Paulista, 1000", city: "São Paulo", region: "SP", postalCode: "01310-100" },
  }),
  "profile",
);
log(`details sent once (Etherfuse onboarding) in ${((Date.now() - profileStarted) / 1000).toFixed(1)} s`);
type Quote = { quoteId: string; receive: string; feeBrl: string; needsTrustline: boolean; expiresAt: string };
let quote = must(await call<Quote>("POST", "/app/ramp/quote", { target: "USDC", amountBrl: "50" }), "quote");
log(`R$ 50 buys ${quote.receive} USDC (fee R$ ${quote.feeBrl}); needs trustline: ${quote.needsTrustline}`);
let trust: unknown = null;
if (quote.needsTrustline) {
  trust = await confirm(
    must(await call<Action>("POST", "/app/ramp/trustline", { target: "USDC" }), "trustline"),
    "accept dollars",
  );
  quote = must(await call<Quote>("POST", "/app/ramp/quote", { target: "USDC", amountBrl: "50" }), "quote again");
}
type Order = { id: string; status: string; pixCode: string | null; receive: string; deliveredTx: string | null };
const order = must(await call<Order>("POST", "/app/ramp/orders", { quoteId: quote.quoteId }), "order");
log(
  `order ${order.id}: ${order.status}; Pix copia e cola ${order.pixCode ? `${order.pixCode.slice(0, 24)}…` : "(none)"}`,
);
must(await call("POST", `/app/ramp/orders/${order.id}/simulate-payment`), "simulate");
log("sandbox: Pix marked as paid");
const statuses: { at: string; status: string }[] = [];
let last = order;
for (let i = 0; i < 40; i++) {
  last = must(await call<Order>("GET", `/app/ramp/orders/${order.id}`), "order status");
  if (statuses.at(-1)?.status !== last.status) {
    statuses.push({ at: new Date().toISOString(), status: last.status });
    log(`order: ${last.status}${last.deliveredTx ? ` (delivered ${last.deliveredTx.slice(0, 12)}…)` : ""}`);
  }
  if (["completed", "failed", "refunded", "canceled"].includes(last.status)) break;
  await sleep(6000);
}
evidence.ramp = {
  quote: { receive: quote.receive, feeBrl: quote.feeBrl, needsTrustline: quote.needsTrustline },
  trustline: trust,
  order: { id: order.id, pixCode: Boolean(order.pixCode), statuses, deliveredTx: last.deliveredTx },
};
evidence.finishedAt = new Date().toISOString();

const out = `docs/evidence/t-026-money-${startedAt.toISOString().slice(0, 19).replace(/[:T]/g, "")}.json`;
writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`);
log(`evidence: ${out}`);
