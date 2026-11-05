// OpenAPI 3.1 for Vants Pay v0, generated from the zod schemas that validate the API (no hand-written copy to drift).
import { z } from "zod";
import {
  CreatePaymentResponse,
  ErrorResponse,
  PaymentRequest,
  PaymentResponse,
  PaymentWebhook,
  QuoteRequest,
  QuoteResponse,
  WebhookEndpointCreated,
  WebhookEndpointList,
  WebhookEndpointRequest,
} from "./schemas.ts";

const json = (schema: z.ZodType) => ({ "application/json": { schema: z.toJSONSchema(schema, { io: "output" }) } });
const errors = {
  "400": { description: "Invalid request", content: json(ErrorResponse) },
  "401": { description: "Missing or unknown API key", content: json(ErrorResponse) },
};
const idempotencyKey = {
  name: "Idempotency-Key",
  in: "header",
  required: true,
  description: "Same key and body → the first response is replayed; same key, different body → 422.",
  schema: { type: "string", minLength: 1, maxLength: 255 },
};

export function openApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Vants Pay v0 (testnet proof of concept)",
      version: "0.1.0",
      description:
        "Pay Pix BR Codes and Pix keys with Stellar testnet assets. The Pix leg is simulated by the Hodle sandbox.",
    },
    components: { securitySchemes: { apiKey: { type: "apiKey", in: "header", name: "x-api-key" } } },
    security: [{ apiKey: [] }],
    paths: {
      "/v0/quotes": {
        post: {
          summary: "Validate a BR Code or Pix key and price it",
          parameters: [idempotencyKey],
          requestBody: { required: true, content: json(QuoteRequest) },
          responses: {
            "201": { description: "Quote", content: json(QuoteResponse) },
            ...errors,
            "409": {
              description: "FLOAT_UNAVAILABLE: the payout float can't cover it now",
              content: json(ErrorResponse),
            },
            "422": { description: "Idempotency key reused with another body", content: json(ErrorResponse) },
          },
        },
      },
      "/v0/payments": {
        post: {
          summary: "Accept a quote: returns where to send the deposit",
          parameters: [idempotencyKey],
          requestBody: { required: true, content: json(PaymentRequest) },
          responses: {
            "201": { description: "Payment awaiting its deposit", content: json(CreatePaymentResponse) },
            ...errors,
            "404": { description: "Unknown quote", content: json(ErrorResponse) },
            "409": {
              description: "QUOTE_EXPIRED, QUOTE_ALREADY_USED, or FLOAT_UNAVAILABLE",
              content: json(ErrorResponse),
            },
            "422": { description: "Idempotency key reused with another body", content: json(ErrorResponse) },
          },
        },
      },
      "/v0/payments/{id}": {
        get: {
          summary: "A payment and its timeline",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Payment", content: json(PaymentResponse) },
            "401": errors["401"],
            "404": { description: "Unknown payment", content: json(ErrorResponse) },
          },
        },
      },
      "/v0/webhook-endpoints": {
        post: {
          summary: "Register a URL for payment webhooks; the whsec_ secret is returned only here",
          parameters: [idempotencyKey],
          requestBody: { required: true, content: json(WebhookEndpointRequest) },
          responses: {
            "201": { description: "Endpoint and its signing secret", content: json(WebhookEndpointCreated) },
            ...errors,
            "422": { description: "Idempotency key reused with another body", content: json(ErrorResponse) },
          },
        },
        get: {
          summary: "Active webhook endpoints (without secrets)",
          responses: { "200": { description: "Endpoints", content: json(WebhookEndpointList) }, "401": errors["401"] },
        },
      },
      "/v0/webhook-endpoints/{id}": {
        delete: {
          summary: "Stop sending webhooks to this endpoint",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "204": { description: "Removed" },
            "401": errors["401"],
            "404": { description: "Unknown endpoint", content: json(ErrorResponse) },
          },
        },
      },
    },
    webhooks: {
      "payment.updated": {
        post: {
          summary:
            "Sent on every payment transition, signed with Standard Webhooks (webhook-id = <paymentId>:<version>, stable across retries)",
          requestBody: { required: true, content: json(PaymentWebhook) },
          responses: { "2XX": { description: "Received; anything else is retried with backoff" } },
        },
      },
    },
  };
}
