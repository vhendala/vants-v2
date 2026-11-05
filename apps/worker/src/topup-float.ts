// pnpm float:topup <USD>: credits the Hodle sandbox float (float-topup.ts), for testing payments larger than the float.
import { HodleClient } from "@vants/adapter-hodle";
import { loadWorkerConfig } from "@vants/config";
import { createBackbone, migrate } from "@vants/db";
import { rateToMicros } from "@vants/domain";
import { topUpFloat } from "./float-topup.ts";

const usd = process.argv[2] ?? "";
if (!/^\d{1,6}(\.\d{1,6})?$/.test(usd)) {
  console.error("usage: pnpm float:topup <USD>   e.g. pnpm float:topup 100");
  process.exit(2);
}
const [whole = "0", frac = ""] = usd.split(".");
const want6 = BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(6, "0"));

const config = loadWorkerConfig();
const hodle = new HodleClient({ baseUrl: config.hodle.baseUrl, apiKey: config.hodle.apiKey });
await migrate(config.databaseUrl);
const backbone = createBackbone({ databaseUrl: config.databaseUrl });
await backbone.start();
try {
  const result = await topUpFloat(
    {
      backbone,
      float: {
        createDeposit: (cents) => hodle.createSandboxDeposit(cents),
        settleDeposit: (trackId) => hodle.settleSandboxDeposit(trackId),
        balance: async () => (await hodle.sandboxBalance()).usdh6,
      },
      rateMicros: rateToMicros(config.pricing.rateBrlPerUsd),
    },
    want6,
  );
  if (!result.ok) {
    console.error(`not topped up: ${result.reason}`);
    process.exitCode = 1;
  } else {
    const usdh = (x: bigint) => `${x / 1_000_000n}.${(x % 1_000_000n).toString().padStart(6, "0")}`;
    console.log(
      `credited ${usdh(result.credit6)} USDH (R$ ${(result.cents / 100).toFixed(2)}, deposit ${result.trackId}); float now ${usdh(result.balance6)} USDH`,
    );
  }
} finally {
  await backbone.stop();
}
