// pnpm lumens:smoke: a Pix paid from lumens invested (T-026), end to end over the public URL. The test payer's local testnet
// key stands in for the wallet: it invests lumens in the DeFindex XLM vault if it has too few there, then pays a R$ 5,40 code
// picking only "Lumens que rendem". When the AMM pays near the market, ONE router call takes the lumens out, swaps and pays
// (DEC-042); when it doesn't (`unyield`, DEC-043), the app's own steps run: take just enough lumens out (one confirmation),
// then pay the same share from the wallet's lumens through the order book (another). Writes docs/evidence/t-026-lumens-pay-*.
import { unyieldFirst } from "../../web/src/unyield.ts";
import { writeFileSync } from "node:fs";
import { buildStaticBrCode } from "@vants/pix";
import { Keypair, Networks, type Transaction, TransactionBuilder, WebAuth } from "@stellar/stellar-sdk";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};
const BASE = env("PUBLIC_BASE_URL").replace(/\/$/, "");
const XLM_VAULT = "CD72HOSTSKA2KA4RMVOKVARM7SXBJ7IV54NCPJEEY4ZWOXOQPVFC5SIJ";
const payer = Keypair.fromSecret(env("TEST_PAYER_SECRET"));
const log = (m: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const startedAt = new Date();
const headers = { "ngrok-skip-browser-warning": "1" };
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
const signed = (xdr: string) => {
  const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET) as Transaction;
  tx.sign(payer);
  return tx;
};

// SEP-10, the server's signature checked first.
const toml = await (await fetch(`${BASE}/.well-known/stellar.toml`, { headers })).text();
const field = (k: string) => new RegExp(`^${k}="([^"]+)"`, "m").exec(toml)?.[1] ?? "";
const authEndpoint = field("WEB_AUTH_ENDPOINT");
const home = new URL(authEndpoint).host;
const ch = await call<{ transaction: string }>("GET", `${authEndpoint}?account=${payer.publicKey()}`);
WebAuth.readChallengeTx(ch.json.transaction, field("SIGNING_KEY"), Networks.TESTNET, home, home);
token = (await call<{ token: string }>("POST", authEndpoint, { transaction: signed(ch.json.transaction).toXDR() })).json
  .token;
log(`logged in as ${payer.publicKey().slice(0, 8)}…`);

// 1. Enough lumens invested to pay R$ 5,40 (about 1 dollar) at testnet AMM prices: 60 lumens.
type Vaults = { vaults: { id: string; invested: string }[] };
const invested = Number(
  (await call<Vaults>("GET", "/app/invest")).json.vaults.find((v) => v.id === XLM_VAULT)?.invested ?? "0",
);
let deposit: unknown = null;
if (invested < 40) {
  const a = await call<{ id: string; transaction: { xdr: string; hash: string; summary: string[] } }>(
    "POST",
    "/app/invest",
    { vault: XLM_VAULT, amount: "60" },
  );
  if (a.status !== 201) throw new Error(`invest: ${a.status} ${JSON.stringify(a.json)}`);
  await call("POST", `/app/actions/${a.json.id}/submit`, { signedXdr: signed(a.json.transaction.xdr).toXDR() });
  for (let i = 0; i < 40; i++) {
    const v = await call<{ status: string }>("GET", `/app/actions/${a.json.id}`);
    if (v.json.status === "done") break;
    if (v.json.status === "failed") throw new Error("invest failed");
    await sleep(1500);
  }
  deposit = { txHash: a.json.transaction.hash, summary: a.json.transaction.summary };
  log(`invested 60 lumens (${a.json.transaction.hash.slice(0, 12)}…)`);
} else log(`already invested: ${invested} lumens`);

// 2. Pay a R$ 5,40 code from the lumens invested only.
const brCode = buildStaticBrCode({
  key: "pix-spike@vants.example.com",
  merchantName: "VANTS TESTE",
  merchantCity: "SAO PAULO",
  amountCents: 540,
});
const pick = `defindex:${XLM_VAULT}`;
const portfolio = await call<{ positions: Parameters<typeof unyieldFirst>[1] }>("GET", "/app/portfolio");
const position = portfolio.json.positions.find((p) => p.id === pick);
log(`lumens invested in the portfolio: ${JSON.stringify(position)}`);
// What the app sends: the share in the payment's dollars (R$ 5,40 at 5,4 = 1 dollar), from the lumens invested only.
let picks: { id: string; amount: string }[] = [{ id: pick, amount: "1" }];
let unyield: unknown = null;
const first = unyieldFirst(picks, portfolio.json.positions);
if (first) {
  const direct = await call<{ reason?: string }>("POST", "/app/exits", {
    destination: { type: "br_code", brCode },
    picks,
  });
  log(`one router call refused, as it should be: HTTP ${direct.status} ${direct.json.reason}`);
  const a = await call<{ id: string; transaction: { xdr: string; hash: string; summary: string[] } }>(
    "POST",
    "/app/redeem",
    { vault: first.vault, amount: first.lumens },
  );
  if (a.status !== 201) throw new Error(`redeem: ${a.status} ${JSON.stringify(a.json)}`);
  const t0 = Date.now();
  await call("POST", `/app/actions/${a.json.id}/submit`, { signedXdr: signed(a.json.transaction.xdr).toXDR() });
  for (let i = 0; i < 40; i++) {
    const v = await call<{ status: string }>("GET", `/app/actions/${a.json.id}`);
    if (v.json.status === "done") break;
    if (v.json.status === "failed") throw new Error("redeem failed");
    await sleep(1500);
  }
  unyield = {
    lumens: first.lumens,
    txHash: a.json.transaction.hash,
    summary: a.json.transaction.summary,
    seconds: (Date.now() - t0) / 1000,
  };
  log(`1st confirmation: ${a.json.transaction.summary.join(" | ")} (${a.json.transaction.hash.slice(0, 12)}…)`);
  picks = first.picks;
}
const created = await call<{
  id: string;
  paymentId: string;
  route: string;
  asset: string;
  transaction: { xdr: string; hash: string; summary: string[] };
  error?: unknown;
  reason?: string;
}>("POST", "/app/exits", { destination: { type: "br_code", brCode }, picks });
if (created.status !== 201) throw new Error(`exit: ${created.status} ${JSON.stringify(created.json)}`);
const exit = created.json;
log(`exit ${exit.id} (${exit.route}, in ${exit.asset.split(":")[0]} ${exit.asset.split(":")[1]?.slice(0, 6)}…):`);
for (const line of exit.transaction.summary) log(`  · ${line}`);
const tx = signed(exit.transaction.xdr);
const signedAt = Date.now();
const submitted = await call<{ status: string }>("POST", `/app/exits/${exit.id}/submit`, { signedXdr: tx.toXDR() });
log(
  `${unyield ? "2nd confirmation" : "submitted"}: HTTP ${submitted.status} (${tx.signatures.length} signature, ${tx.operations.length} operation)`,
);
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
const file = `docs/evidence/t-026-lumens-pay-${startedAt.toISOString()}.json`.replaceAll(":", "-");
writeFileSync(
  file,
  `${JSON.stringify(
    {
      startedAt: startedAt.toISOString(),
      account: payer.publicKey(),
      deposit,
      unyield,
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
