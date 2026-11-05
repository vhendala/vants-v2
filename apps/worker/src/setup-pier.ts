// pnpm pier:setup: the treasury's incoming-payment subscription on the deployed Pier (DEC-003, DEC-012), created once.
// Pull-only until PUBLIC_BASE_URL is set; rerun then to add the webhook. Writes PIER_SUBSCRIPTION_ID (and, when a webhook is
// created, PIER_WEBHOOK_SECRET, which Pier returns only once) into .env. Secrets are never printed.
import { fileURLToPath } from "node:url";
import { PierGateway } from "@vants/adapter-pier";
import { publicKeyOf } from "@vants/adapter-stellar";
import { loadPierSetupConfig } from "@vants/config";
import { setEnvVars } from "./env-file.ts";

const ENV_FILE = fileURLToPath(new URL("../../../.env", import.meta.url));

const cfg = loadPierSetupConfig();
const treasury = publicKeyOf(cfg.treasurySecret);
const webhookUrl = cfg.publicBaseUrl ? `${cfg.publicBaseUrl.replace(/\/$/, "")}/ingress/pier` : undefined;
const r = await new PierGateway(cfg.pier).ensureTreasurySubscription(treasury, webhookUrl);

setEnvVars(ENV_FILE, {
  PIER_SUBSCRIPTION_ID: r.id,
  ...(r.webhookSecret ? { PIER_WEBHOOK_SECRET: r.webhookSecret } : {}),
});
console.log(
  `treasury ${treasury}: subscription ${r.id} (${r.created ? "created" : "reused"})` +
    (webhookUrl
      ? `, webhook → ${webhookUrl}${r.webhookSecret ? " (secret saved to .env)" : ""}`
      : ", pull only (set PUBLIC_BASE_URL and rerun to add the webhook)"),
);
