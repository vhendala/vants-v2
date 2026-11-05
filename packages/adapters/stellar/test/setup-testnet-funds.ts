// Testnet funds for the PoC (testnet only; secrets never printed):
//   - treasury: trustlines to Circle testnet USDC (CCTP) and Blend testnet USDC (DeFindex vault), per DEC-006;
//   - TEST_PAYER_SECRET: a payer account (generated into .env if empty), Friendbot-funded, with a USDC trustline;
//   - moves <amount> Circle testnet USDC to the payer from a funder account read from another .env file.
//   node --env-file=../../../.env test/setup-testnet-funds.ts <funder .env path> <amount>   (from packages/adapters/stellar)
import { readFileSync, writeFileSync } from "node:fs";
import { Asset, BASE_FEE, Horizon, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";

const [funderEnvPath = "", amount = "3"] = process.argv.slice(2);
const ENV_FILE = new URL("../../../../.env", import.meta.url);
const CIRCLE_USDC = new Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
const BLEND_USDC = new Asset("USDC", "GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56");
const horizon = new Horizon.Server(process.env.STELLAR_HORIZON_URL ?? "https://horizon-testnet.stellar.org");

const funderSecret = /^STELLAR_TESTNET_SECRET=(S[A-Z2-7]{55})\s*$/m.exec(readFileSync(funderEnvPath, "utf8"))?.[1];
if (!funderSecret) throw new Error("no STELLAR_TESTNET_SECRET in the funder .env");
const funder = Keypair.fromSecret(funderSecret);
const treasury = Keypair.fromSecret(process.env.TREASURY_SECRET ?? "");

let payerSecret = process.env.TEST_PAYER_SECRET ?? "";
if (!payerSecret) {
  payerSecret = Keypair.random().secret();
  const env = readFileSync(ENV_FILE, "utf8");
  writeFileSync(
    ENV_FILE,
    /^TEST_PAYER_SECRET=.*$/m.test(env)
      ? env.replace(/^TEST_PAYER_SECRET=.*$/m, () => `TEST_PAYER_SECRET=${payerSecret}`)
      : `${env.replace(/\n?$/, "\n")}TEST_PAYER_SECRET=${payerSecret}\n`,
  );
  console.log("generated TEST_PAYER_SECRET into .env");
}
const payer = Keypair.fromSecret(payerSecret);

async function ensureAccount(kp: Keypair) {
  const ok = await horizon
    .loadAccount(kp.publicKey())
    .then(() => true)
    .catch(() => false);
  if (!ok) {
    const r = await fetch(`https://friendbot.stellar.org?addr=${kp.publicKey()}`);
    if (!r.ok) throw new Error(`friendbot ${r.status}`);
  }
}

async function submit(kp: Keypair, ops: ReturnType<typeof Operation.payment>[]) {
  if (ops.length === 0) return;
  const tx = new TransactionBuilder(await horizon.loadAccount(kp.publicKey()), {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  });
  for (const op of ops) tx.addOperation(op);
  const built = tx.setTimeout(60).build();
  built.sign(kp);
  return horizon.submitTransaction(built);
}

const trusts = async (kp: Keypair, asset: Asset) =>
  (await horizon.loadAccount(kp.publicKey())).balances.some(
    (b) => "asset_code" in b && b.asset_code === asset.getCode() && b.asset_issuer === asset.getIssuer(),
  );

await ensureAccount(treasury);
await ensureAccount(payer);

const treasuryOps = [];
for (const asset of [CIRCLE_USDC, BLEND_USDC]) {
  if (!(await trusts(treasury, asset))) treasuryOps.push(Operation.changeTrust({ asset }));
}
await submit(treasury, treasuryOps);
if (!(await trusts(payer, CIRCLE_USDC))) await submit(payer, [Operation.changeTrust({ asset: CIRCLE_USDC })]);

const r = await submit(funder, [Operation.payment({ destination: payer.publicKey(), asset: CIRCLE_USDC, amount })]);
console.log(`moved ${amount} Circle testnet USDC to payer ${payer.publicKey()}: ${r?.hash}`);

for (const [name, kp] of [
  ["treasury", treasury],
  ["payer", payer],
  ["funder", funder],
] as const) {
  const bal = (await horizon.loadAccount(kp.publicKey())).balances
    .map((b) => `${"asset_code" in b ? `${b.asset_code}:${b.asset_issuer.slice(0, 5)}` : "XLM"}=${b.balance}`)
    .join(" ");
  console.log(`${name} ${kp.publicKey().slice(0, 8)}… ${bal}`);
}
