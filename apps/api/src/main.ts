// pnpm api: the api process (SPEC §3.2). Migrations run first so a fresh database is usable.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadApiConfig } from "@vants/config";
import { createBackbone, migrate } from "@vants/db";
import { buildApp } from "./app.ts";
import { liveAppPorts } from "./app/ports.ts";

const config = loadApiConfig();
await migrate(config.databaseUrl);
const backbone = createBackbone({ databaseUrl: config.databaseUrl });
await backbone.start();
const webDist = fileURLToPath(new URL("../../web/dist", import.meta.url));
const app = await buildApp({
  backbone,
  config,
  logger: true,
  appPorts: liveAppPorts(config),
  ...(existsSync(join(webDist, "index.html")) ? { webDist } : {}),
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await app.close();
    await backbone.stop();
  });
}
// Loopback by default (ngrok or a proxy in front); HOST=0.0.0.0 inside the deployed container (deploy/compose.yaml).
await app.listen({ port: config.port, host: process.env.HOST ?? "127.0.0.1" });
