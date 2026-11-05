// pnpm integrator:create <name>: mints an integrator and prints its API key once (only its hash is stored).
import { loadApiConfig } from "@vants/config";
import { createBackbone, createIntegrator, migrate } from "@vants/db";

const name = process.argv[2];
if (!name) throw new Error("usage: pnpm integrator:create <name>");
const config = loadApiConfig();
await migrate(config.databaseUrl);
const backbone = createBackbone({ databaseUrl: config.databaseUrl });
await backbone.start();
try {
  const { integratorId, apiKey } = await backbone.withTransaction((tx) =>
    createIntegrator(tx, name, config.integratorKeyPepper),
  );
  console.log(`integrator ${integratorId} (${name})\nx-api-key: ${apiKey}`);
} finally {
  await backbone.stop();
}
