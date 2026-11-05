// pnpm exit:smoke: DEC-031 live on testnet: each payment is ONE transaction signed ONCE, through the real portfolio reader,
// planner and builders, against a running `pnpm api` + `pnpm worker`.
//   router route   the spike's DeFindex user pays a Blend-USDC quote from its vault (withdraw + transfer in one router call)
//   classic route  the test payer pays a Circle-USDC quote from XLM (swap + payment in one classic transaction)
//   router + XLM   the DeFindex user pays more than its vault holds: the vault, then XLM swapped on Soroswap, in one router
//                  call (DEC-034)
// The local testnet keys stand in for the wallet. Writes docs/evidence/exit-smoke-*.json.
import { writeFileSync } from "node:fs";
import { DEFINDEX_TESTNET, DefindexReader } from "@vants/adapter-defindex";
import { createIntegrator } from "@vants/db";
import { buildStaticBrCode } from "@vants/pix";
import { Horizon, Keypair, Networks, rpc, type Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import pg from "pg";
import { planExit } from "../src/app/exit-plan.ts";
import { buildExitTransaction, SOROSWAP_TESTNET_ROUTER } from "../src/app/exit-tx.ts";
import { readPortfolio } from "../src/app/portfolio.ts";
import { stellarPortfolioSources } from "../src/app/sources.ts";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};
const API = `http://127.0.0.1:${process.env.API_PORT ?? "3100"}`;
const CIRCLE = "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const horizon = new Horizon.Server(env("STELLAR_HORIZON_URL"));
const server = new rpc.Server(env("STELLAR_RPC_URL"));
const db = new pg.Pool({ connectionString: env("DATABASE_URL") });
const routerId = env("EXIT_ROUTER_CONTRACT_ID");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (m: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);
const startedAt = new Date();

const integrator = await (async () => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const r = await createIntegrator(
      { query: async (t, v) => ({ rows: (await client.query(t, v)).rows }) },
      `exit-smoke ${startedAt.toISOString()}`,
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
        : { "content-type": "application/json", "idempotency-key": `smoke-${Date.now()}-${++idem}` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await res.json()) as T;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
  return json;
};

const sources = stellarPortfolioSources({ horizon, server, reader: env("TREASURY_ACCOUNT") });
const portfolioConfig = {
  fundingAssets: [CIRCLE, DEFINDEX_TESTNET.blendUsdc],
  vaults: [{ id: DEFINDEX_TESTNET.usdcVault, assetName: DEFINDEX_TESTNET.blendUsdc }],
  xlmFeeBuffer7: 10_000_000n,
  xlmSlippageBps: 100,
};

async function payOnce(
  label: string,
  signer: Keypair,
  asset: string,
  amountCents: number,
  pick: (ids: string[]) => string[],
) {
  const merchant = { key: "pix-spike@vants.example.com", merchantName: "VANTS TESTE", merchantCity: "SAO PAULO" };
  const quote = await api<{ id: string; assetAmount: string }>("POST", "/v0/quotes", {
    destination: { type: "br_code", brCode: buildStaticBrCode({ ...merchant, amountCents }) },
    asset,
  });
  const payment = await api<{ id: string; deposit: { address: string; amount: string } }>("POST", "/v0/payments", {
    quoteId: quote.id,
  });
  const account = signer.publicKey();
  const portfolio = await readPortfolio(account, sources, portfolioConfig);
  const reader = new DefindexReader({ server, reader: account });
  const vaults = new Map([[DEFINDEX_TESTNET.usdcVault, await reader.state(DEFINDEX_TESTNET.usdcVault)]]);
  const picks = pick(portfolio.positions.map((p) => p.id));
  const plan = planExit({ asset, amount7: toAmount7(payment.deposit.amount) }, picks, portfolio.positions, vaults);
  if (!plan.ok) throw new Error(`${label}: planner refused: ${plan.reason} (${plan.detail})`);
  const built = await buildExitTransaction(
    plan,
    { account, asset, deposit: payment.deposit.address },
    { horizon, server, routerId, ammRouterId: SOROSWAP_TESTNET_ROUTER },
  );
  log(`${label}: ${payment.id}, route ${plan.route}; the wallet would sign: ${built.summary.join(" → ")}`);

  const tx = TransactionBuilder.fromXDR(built.xdr, Networks.TESTNET) as Transaction;
  tx.sign(signer); // the ONE signature
  const signatures = tx.signatures.length;
  const operations = tx.operations.length;
  const sent = await server.sendTransaction(tx);
  if (sent.status === "ERROR") throw new Error(`${label}: submit failed ${JSON.stringify(sent.errorResult)}`);
  let landed: rpc.Api.GetTransactionResponse;
  for (;;) {
    landed = await server.getTransaction(built.hash);
    if (landed.status !== rpc.Api.GetTransactionStatus.NOT_FOUND) break;
    await sleep(1000);
  }
  if (landed.status !== rpc.Api.GetTransactionStatus.SUCCESS)
    throw new Error(`${label}: ${built.hash} ${landed.status}`);
  log(`${label}: landed ${built.hash.slice(0, 8)}… (${operations} operation(s), ${signatures} signature)`);

  const deadline = Date.now() + 120_000;
  let status = "";
  while (Date.now() < deadline) {
    status = (await api<{ status: string }>("GET", `/v0/payments/${payment.id}`)).status;
    if (status === "completed" || status === "refunded") break;
    await sleep(1500);
  }
  log(`${label}: payment ${status}`);
  return {
    paymentId: payment.id,
    route: plan.route,
    picks,
    plan: JSON.parse(JSON.stringify(plan, (_, v) => (typeof v === "bigint" ? v.toString() : v))),
    summary: built.summary,
    txHash: built.hash,
    operations,
    signatures,
    status,
  };
}

const toAmount7 = (s: string) => {
  const [w = "0", f = ""] = s.split(".");
  return BigInt(w) * 10_000_000n + BigInt(f.padEnd(7, "0"));
};

const defindexUser = Keypair.fromSecret(env("DEFINDEX_USER_SECRET"));
const payer = Keypair.fromSecret(env("TEST_PAYER_SECRET"));

const router = await payOnce("router route", defindexUser, DEFINDEX_TESTNET.blendUsdc, 540, (ids) =>
  ids.filter((id) => id.startsWith("defindex:")),
);
const classic = await payOnce("classic route", payer, CIRCLE, 270, (ids) =>
  ids.filter((id) => id === "classic:native"),
);

// More than the vault holds, so the XLM leg buys the rest on the AMM.
const vaultHeld = (await readPortfolio(defindexUser.publicKey(), sources, portfolioConfig)).positions.find(
  (p) => p.kind === "defindex",
);
const routerXlmCents = Math.ceil((Number(vaultHeld?.amount ?? "0") + 10) * 5.4) * 100;
const routerXlm = await payOnce("router + XLM", defindexUser, DEFINDEX_TESTNET.blendUsdc, routerXlmCents, (ids) => [
  ...ids.filter((id) => id.startsWith("defindex:")),
  "classic:native",
]);

const evidence = { startedAt: startedAt.toISOString(), routerId, router, classic, routerXlm };
const file = `docs/evidence/exit-smoke-${startedAt.toISOString()}.json`.replaceAll(":", "-");
writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`);
const ok = [router, classic, routerXlm].every((r) => r.signatures === 1 && r.status === "completed");
log(`${ok ? "PASS" : "FAIL"}: every payment one transaction, one signature, completed; evidence in ${file}`);
await db.end();
process.exit(ok ? 0 : 1);
