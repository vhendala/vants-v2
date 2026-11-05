// pnpm reconcile: one reconciliation pass (D7), printed. The worker also runs it every 5 minutes.
import { BaseMinter } from "@vants/adapter-cctp";
import { HodleClient } from "@vants/adapter-hodle";
import { treasuryBalances } from "@vants/adapter-stellar";
import { loadWorkerConfig } from "@vants/config";
import { createBackbone, migrate } from "@vants/db";
import { Horizon, Keypair } from "@stellar/stellar-sdk";
import { reconcile } from "./books.ts";

const config = loadWorkerConfig();
const treasury = Keypair.fromSecret(config.stellar.treasurySecret).publicKey();
const horizon = new Horizon.Server(config.stellar.horizonUrl);
const hodle = new HodleClient({ baseUrl: config.hodle.baseUrl, apiKey: config.hodle.apiKey });
await migrate(config.databaseUrl);
const backbone = createBackbone({ databaseUrl: config.databaseUrl });
await backbone.start();
try {
  const report = await reconcile({
    backbone,
    sources: {
      treasury: async () =>
        (await treasuryBalances(horizon, treasury)).map((b) => ({
          asset: b.sacId,
          assetName: b.assetName,
          amount7: b.amount7,
        })),
      float: async () => (await hodle.sandboxBalance()).usdh6,
      base: () => new BaseMinter({ rpcUrl: config.base.rpcUrl, privateKey: config.base.evmPrivateKey }).usdcBalance(),
    },
  });
  if (!report) {
    console.log("books not opened yet: start the worker once (pnpm worker)");
  } else {
    for (const r of report.rows) {
      const [code = "", issuer] = r.assetName.split(":");
      const name = code === "native" ? "XLM" : issuer ? `${code} (${issuer.slice(0, 6)}…)` : code;
      console.log(
        `${r.scope.padEnd(8)} ${name.padEnd(16)} ledger ${r.ledger}  actual ${r.actual}  diff ${r.diff}  ${r.status}`,
      );
    }
    console.log("needs review:", JSON.stringify(report.review));
  }
} finally {
  await backbone.stop();
}
