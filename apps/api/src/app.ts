// The api process (SPEC §3.2): Vants Pay v0 and the webhook ingress, on one Fastify instance.
import type { ApiConfig } from "@vants/config";
import type { Backbone } from "@vants/db";
import Fastify, { type FastifyInstance } from "fastify";
import { hodleIngress } from "./ingress/hodle.ts";
import { pierIngress } from "./ingress/pier.ts";
import { type AppPorts, appRoutes } from "./app/routes.ts";
import { paymentService } from "./payments-service.ts";
import { openApiDocument } from "./v0/openapi.ts";
import { webApp } from "./web.ts";
import { v0Routes } from "./v0/routes.ts";

export interface AppDeps {
  backbone: Pick<Backbone, "withTransaction" | "publish" | "recordInbound">;
  config: ApiConfig;
  now?: () => Date;
  logger?: boolean;
  /** The mini app's network (T-020); with `config.webAuth`, enables stellar.toml, /auth and /app/*. */
  appPorts?: AppPorts;
  /** The built mini app to serve at `/` (apps/web/dist), when present. */
  webDist?: string;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? false });
  const now = deps.now ?? (() => new Date());

  app.get("/v0/openapi.json", async () => openApiDocument());
  await app.register(v0Routes, { backbone: deps.backbone, config: deps.config, now });
  await app.register(hodleIngress, { secrets: deps.config.hodle.webhookSecrets, recorder: deps.backbone });
  await app.register(pierIngress, {
    ...(deps.config.pier.webhookSecret ? { secret: deps.config.pier.webhookSecret } : {}),
    ...(deps.config.pier.subscriptionId ? { subscriptionId: deps.config.pier.subscriptionId } : {}),
    recorder: deps.backbone,
  });
  if (deps.config.webAuth && deps.appPorts) {
    await app.register(appRoutes, {
      backbone: deps.backbone,
      webAuth: deps.config.webAuth,
      fundingAssets: deps.config.fundingAssets,
      exitRouterId: deps.config.exitRouterId,
      rateBrlPerUsd: deps.config.pricing.rateBrlPerUsd,
      payments: paymentService({ backbone: deps.backbone, config: deps.config, now }),
      ports: deps.appPorts,
    });
  }
  if (deps.webDist) await app.register(webApp, { dist: deps.webDist });
  return app;
}
