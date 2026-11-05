// One-off probe (T-008): records the Pier envelopes for the two ways a deposit can reach the treasury, as test fixtures.
//   node --env-file=../../../.env test/record-pier-envelopes.ts   (from packages/adapters/stellar)
// Testnet only. Creates TREASURY_SECRET in .env if empty (never printed), funds the treasury and a throwaway sender with
// Friendbot, opens a temporary pull-only Pier subscription on the treasury, sends
//   1. a classic XLM payment with memo id 42, and
//   2. a native-SAC `transfer` to the treasury's muxed address M…(treasury, 43),
// waits for both events, writes them to ../pier/test/fixtures/envelopes.json, and deletes the subscription.
import { readFileSync, writeFileSync } from "node:fs";
import {
  Account,
  Address,
  Asset,
  BASE_FEE,
  Contract,
  Horizon,
  Keypair,
  Memo,
  MuxedAccount,
  Networks,
  nativeToScVal,
  Operation,
  rpc,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

const ENV_FILE = new URL("../../../../.env", import.meta.url);
const OUT = new URL("../../pier/test/fixtures/envelopes.json", import.meta.url);
const RPC_URL = process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
const HORIZON_URL = process.env.STELLAR_HORIZON_URL ?? "https://horizon-testnet.stellar.org";
const PIER = process.env.PIER_API_URL ?? "";
const PIER_KEY = process.env.PIER_API_KEY ?? "";
if (!PIER || !PIER_KEY) throw new Error("PIER_API_URL and PIER_API_KEY must be set in .env");

let treasurySecret = process.env.TREASURY_SECRET ?? "";
if (!treasurySecret) {
  treasurySecret = Keypair.random().secret();
  const env = readFileSync(ENV_FILE, "utf8").replace(/^TREASURY_SECRET=.*$/m, `TREASURY_SECRET=${treasurySecret}`);
  writeFileSync(ENV_FILE, env);
  console.log("generated TREASURY_SECRET into .env");
}
const treasury = Keypair.fromSecret(treasurySecret);
const sender = Keypair.random();
const server = new rpc.Server(RPC_URL);
const horizon = new Horizon.Server(HORIZON_URL);

const net = await server.getNetwork();
if (net.passphrase !== Networks.TESTNET) throw new Error("RPC is not testnet (INV-07)");

for (const [name, kp] of [
  ["treasury", treasury],
  ["sender", sender],
] as const) {
  const exists = await horizon
    .loadAccount(kp.publicKey())
    .then(() => true)
    .catch(() => false);
  if (!exists) {
    const r = await fetch(`https://friendbot.stellar.org?addr=${kp.publicKey()}`);
    if (!r.ok) throw new Error(`friendbot ${name}: ${r.status}`);
  }
}
console.log(`treasury ${treasury.publicKey()} · sender ${sender.publicKey()}`);

const pier = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`${PIER}${path}`, {
    method,
    headers: { "x-api-key": PIER_KEY, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!r.ok && r.status !== 204) throw new Error(`Pier ${method} ${path}: ${r.status} ${await r.text()}`);
  return r.status === 204 ? undefined : r.json();
};

const sub = (await pier("POST", "/v1/subscriptions", {
  filter: { type: "payment", account: treasury.publicKey(), direction: "in" },
})) as { id: string; status: string };
console.log(`temporary subscription ${sub.id} (${sub.status})`);

try {
  // Wait until the matcher has activated the subscription, so the payments land after its start position.
  for (let i = 0; i < 30; i++) {
    const s = (await pier("GET", `/v1/subscriptions/${sub.id}`)) as { status: string };
    if (s.status === "active") break;
    await new Promise((r) => setTimeout(r, 1000));
  }

  // 1. Classic payment with a memo id.
  const acct = await horizon.loadAccount(sender.publicKey());
  const classic = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: treasury.publicKey(), asset: Asset.native(), amount: "1.2345678" }))
    .addMemo(Memo.id("42"))
    .setTimeout(60)
    .build();
  classic.sign(sender);
  const sent1 = await horizon.submitTransaction(classic);
  console.log(`classic payment ${sent1.hash}`);

  // 2. SAC transfer to the treasury's muxed address (contract calls can't carry a memo).
  const muxed = new MuxedAccount(new Account(treasury.publicKey(), "0"), "43").accountId();
  const sac = new Contract(Asset.native().contractId(Networks.TESTNET));
  const source = await server.getAccount(sender.publicKey());
  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(
      sac.call(
        "transfer",
        Address.fromString(sender.publicKey()).toScVal(),
        Address.fromString(muxed).toScVal(),
        nativeToScVal(23_456_789n, { type: "i128" }),
      ),
    )
    .setTimeout(60)
    .build();
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(sender);
  const sent2 = await server.sendTransaction(prepared);
  if (sent2.status !== "PENDING") throw new Error(`SAC transfer send: ${sent2.status}`);
  const final = await server.pollTransaction(sent2.hash, { attempts: 60, sleepStrategy: () => 1000 });
  if (final.status !== rpc.Api.GetTransactionStatus.SUCCESS) throw new Error(`SAC transfer: ${final.status}`);
  console.log(`SAC transfer to ${muxed.slice(0, 8)}… ${sent2.hash}`);

  // Wait for both events through Pier's pull API.
  let events: { txHash: string }[] = [];
  for (let i = 0; i < 60 && events.length < 2; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    events = ((await pier("GET", `/v1/subscriptions/${sub.id}/events?limit=100`)) as { events: { txHash: string }[] })
      .events;
  }
  const byTx = (h: string) => events.find((e) => e.txHash === h);
  const fixture = {
    source: `Pier ${PIER} pull API, testnet, ${new Date().toISOString()} (T-008 probe)`,
    treasury: treasury.publicKey(),
    sender: sender.publicKey(),
    classicMemoId: { memoId: "42", amount7: "12345678", envelope: byTx(sent1.hash) ?? null },
    sacTransferToMuxed: { muxedId: "43", muxed, amount7: "23456789", envelope: byTx(sent2.hash) ?? null },
  };
  writeFileSync(OUT, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`recorded ${events.length} event(s) → ${OUT.pathname}`);
} finally {
  await pier("DELETE", `/v1/subscriptions/${sub.id}`);
  console.log(`deleted subscription ${sub.id}`);
}
