// Vants Pay REST v0 routes (SPEC §5.1, T-010). Quotes and payments go through the shared payment service (T-020).
import type { ApiConfig } from "@vants/config";
import {
  type Backbone,
  createWebhookEndpoint,
  depositResource,
  disableWebhookEndpoint,
  integratorForKey,
  listWebhookEndpoints,
  lookupIdempotency,
  paymentResource,
  quoteResource,
  requestHash,
  storeIdempotency,
  type Tx,
} from "@vants/db";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import { ApiError, errorBody, paymentService } from "../payments-service.ts";
import { PaymentRequest, QuoteRequest, WebhookEndpointRequest } from "./schemas.ts";

export interface V0Options {
  backbone: Pick<Backbone, "withTransaction" | "publish">;
  config: Pick<ApiConfig, "treasuryAccount" | "fundingAssets" | "pricing" | "integratorKeyPepper">;
  now: () => Date;
}

declare module "fastify" {
  interface FastifyRequest {
    integratorId?: string;
  }
}

export const v0Routes: FastifyPluginAsync<V0Options> = async (app, opts) => {
  const { backbone, config } = opts;
  const payments = paymentService(opts);
  const deposit = payments.deposit;

  app.addHook("onRequest", async (req, reply) => {
    if (req.url === "/v0/openapi.json") return;
    const key = req.headers["x-api-key"];
    const integratorId =
      typeof key === "string" && key.length > 0
        ? await backbone.withTransaction((tx) => integratorForKey(tx, key, config.integratorKeyPepper))
        : null;
    if (!integratorId) return reply.code(401).send(errorBody("UNAUTHORIZED", "missing or unknown x-api-key"));
    req.integratorId = integratorId;
  });

  /** Validates the body, then runs `handler` once per Idempotency-Key, replaying the first response afterwards. */
  async function idempotent<S extends z.ZodType>(
    req: FastifyRequest,
    reply: FastifyReply,
    schema: S,
    handler: (tx: Tx, body: z.output<S>, integratorId: string) => Promise<{ status: number; body: unknown }>,
  ) {
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string" || key.length === 0 || key.length > 255) {
      return reply
        .code(400)
        .send(errorBody("IDEMPOTENCY_KEY_REQUIRED", "send an Idempotency-Key header (1–255 chars)"));
    }
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
      return reply.code(400).send(errorBody("INVALID_REQUEST", msg));
    }
    const integratorId = req.integratorId ?? "";
    const hash = requestHash(req.method, req.url, req.body);
    const result = await backbone.withTransaction(async (tx) => {
      const seen = await lookupIdempotency(tx, integratorId, key, hash);
      if (seen.kind === "replay") return { status: seen.status, body: seen.body };
      if (seen.kind === "conflict") {
        return {
          status: 422,
          body: errorBody("IDEMPOTENCY_KEY_REUSED", "this Idempotency-Key was used with another request"),
        };
      }
      let out: { status: number; body: unknown };
      try {
        out = await handler(tx, parsed.data, integratorId);
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        out = { status: err.status, body: errorBody(err.code, err.message) };
      }
      await storeIdempotency(tx, integratorId, key, hash, out.status, out.body);
      return out;
    });
    return reply.code(result.status).send(result.body);
  }

  app.post("/v0/quotes", (req, reply) =>
    idempotent(req, reply, QuoteRequest, async (tx, body, integratorId) => ({
      status: 201,
      body: quoteResource(await payments.createQuote(tx, integratorId, body)),
    })),
  );

  app.post("/v0/payments", (req, reply) =>
    idempotent(req, reply, PaymentRequest, async (tx, body, integratorId) => {
      const { payment, quote } = await payments.acceptQuote(tx, integratorId, body.quoteId, body.refundTo);
      return {
        status: 201,
        body: { id: payment.id, status: payment.status, deposit: depositResource(quote, payment.muxId, deposit) },
      };
    }),
  );

  app.get<{ Params: { id: string } }>("/v0/payments/:id", async (req, reply) => {
    const view = await backbone.withTransaction((tx) =>
      paymentResource(tx, req.params.id, { integratorId: req.integratorId ?? "", deposit }),
    );
    if (!view) return reply.code(404).send(errorBody("PAYMENT_NOT_FOUND", "no such payment"));
    return reply.send(view);
  });

  app.post("/v0/webhook-endpoints", (req, reply) =>
    idempotent(req, reply, WebhookEndpointRequest, async (tx, body, integratorId) => ({
      status: 201,
      body: await createWebhookEndpoint(tx, integratorId, body.url),
    })),
  );

  app.get("/v0/webhook-endpoints", async (req) => ({
    endpoints: await backbone.withTransaction((tx) => listWebhookEndpoints(tx, req.integratorId ?? "")),
  }));

  app.delete<{ Params: { id: string } }>("/v0/webhook-endpoints/:id", async (req, reply) => {
    const removed = await backbone.withTransaction((tx) =>
      disableWebhookEndpoint(tx, req.integratorId ?? "", req.params.id),
    );
    if (!removed) return reply.code(404).send(errorBody("WEBHOOK_ENDPOINT_NOT_FOUND", "no such webhook endpoint"));
    return reply.code(204).send();
  });
};
