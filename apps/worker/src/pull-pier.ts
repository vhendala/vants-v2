// pnpm pier:pull: one Pier reconciliation pass into the inbox (the worker also runs it on a timer, T-011).
import { PierGateway } from "@vants/adapter-pier";
import { createBackbone, inboxQueue, migrate } from "@vants/db";
import { loadPierPullConfig } from "@vants/config";
import { pullOnce } from "./pier-pull.ts";

const cfg = loadPierPullConfig();
await migrate(cfg.databaseUrl);
const backbone = createBackbone({ databaseUrl: cfg.databaseUrl });
await backbone.start();
try {
  await backbone.ensureQueue(inboxQueue("pier"));
  const r = await pullOnce({ backbone, source: new PierGateway(cfg.pier), subscriptionId: cfg.pier.subscriptionId });
  console.log(`pier pull: ${r.recorded} new, ${r.duplicates} already known, cursor ${r.cursor}`);
} finally {
  await backbone.stop();
}
