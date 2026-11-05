// pnpm worker: the worker process (SPEC §3.2). Runs the sagas and the notifier, and pulls Pier every 30 s so a missed
// webhook costs at most that long (DEC-003). Testnet and the Hodle sandbox only: config and `assertTestnet` refuse
// anything else (INV-07).
import { BaseMinter, Iris, StellarCctp, verifyUsdcSac } from "@vants/adapter-cctp";
import { HodleClient } from "@vants/adapter-hodle";
import { PierGateway } from "@vants/adapter-pier";
import { assertTestnet, depositInstructions, treasuryBalances } from "@vants/adapter-stellar";
import { loadWorkerConfig } from "@vants/config";
import { createBackbone, migrate } from "@vants/db";
import { rateToMicros } from "@vants/domain";
import { Horizon, Keypair, rpc } from "@stellar/stellar-sdk";
import { type BalanceSources, openLedger, registerBooks } from "./books.ts";
import { registerNotifier } from "./notifier.ts";
import { pullOnce } from "./pier-pull.ts";
import { registerSagas } from "./sagas/index.ts";
import { type CctpPort, registerRefill, type SandboxFloatPort } from "./sagas/refill.ts";
import { stellarLedger } from "./stellar-ledger.ts";

const PIER_PULL_MS = 30_000;

const config = loadWorkerConfig();
const server = new rpc.Server(config.stellar.rpcUrl);
await assertTestnet(server);
const signer = Keypair.fromSecret(config.stellar.treasurySecret);
const treasury = signer.publicKey();

await migrate(config.databaseUrl);
const backbone = createBackbone({ databaseUrl: config.databaseUrl });
await backbone.start();
const hodle = new HodleClient({ baseUrl: config.hodle.baseUrl, apiKey: config.hodle.apiKey });
const horizon = new Horizon.Server(config.stellar.horizonUrl);
// The refill's outside world (T-016): CCTP from Stellar testnet to Base Sepolia, and the sandbox float.
verifyUsdcSac();
const minter = new BaseMinter({ rpcUrl: config.base.rpcUrl, privateKey: config.base.evmPrivateKey });
await minter.assertTestnet();
const stellarCctp = new StellarCctp({ server, signer });
const iris = new Iris({ baseUrl: config.iris.apiUrl });
const cctp: CctpPort = {
  recipient: minter.recipient,
  allowance: () => stellarCctp.allowance(),
  buildApprove: (amount7, now) => stellarCctp.buildApprove(amount7, now),
  buildBurn: (input) => stellarCctp.buildBurn(input),
  maxFee6: (amount6) => iris.maxFee6(amount6),
  attestation: (hash) => iris.attestation(hash),
  nonceUsed: (message) => minter.nonceUsed(message),
  mint: (message, attestation) => minter.mint(message, attestation),
};
const sandboxFloat: SandboxFloatPort = {
  createDeposit: (cents) => hodle.createSandboxDeposit(cents),
  settleDeposit: (trackId) => hodle.settleSandboxDeposit(trackId),
  balance: async () => (await hodle.sandboxBalance()).usdh6,
};
const sources: BalanceSources = {
  treasury: async () =>
    (await treasuryBalances(horizon, treasury)).map((b) => ({
      asset: b.sacId,
      assetName: b.assetName,
      amount7: b.amount7,
    })),
  float: sandboxFloat.balance,
  base: () => minter.usdcBalance(),
};
console.log(`[books] ${await openLedger({ backbone, sources })}`);
await registerSagas({
  backbone,
  treasury,
  now: () => new Date(),
  hodle,
  ledger: stellarLedger(server, treasury),
  signer,
  float: config.float,
});
await registerBooks({ backbone, sources });
await registerRefill({
  backbone,
  treasury,
  now: () => new Date(),
  ledger: stellarLedger(server, treasury),
  refill: { cctp, float: sandboxFloat },
  capMicros: config.refill.capMicros,
  rateMicros: rateToMicros(config.pricing.rateBrlPerUsd),
  float: config.float,
});
await registerNotifier({ backbone, deposit: (muxId) => depositInstructions(treasury, muxId), now: () => new Date() });

let timer: NodeJS.Timeout | undefined;
const subscriptionId = config.pier.subscriptionId;
if (subscriptionId) {
  const pier = new PierGateway(config.pier);
  const pull = async () => {
    try {
      const r = await pullOnce({ backbone, source: pier, subscriptionId });
      if (r.recorded > 0) console.log(`[pier-pull] ${r.recorded} new event(s), cursor ${r.cursor}`);
    } catch (err) {
      console.error("[pier-pull]", err);
    }
  };
  await pull();
  timer = setInterval(pull, PIER_PULL_MS);
} else {
  console.warn("[worker] PIER_SUBSCRIPTION_ID is not set: deposits arrive only by webhook (run pnpm pier:setup)");
}

console.log(`[worker] sagas running for treasury ${treasury.slice(0, 4)}…${treasury.slice(-4)}`);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    clearInterval(timer);
    await backbone.stop();
  });
}
