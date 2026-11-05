// Vants Pay REST v0 (SPEC §5.1): request and response schemas. The same schemas validate requests, document the API
// (OpenAPI via z.toJSONSchema) and, in tests, check every response, so the docs can't drift from the behaviour.
import { z } from "zod";

const AmountBrl = z.string().regex(/^\d{1,9}(\.\d{1,2})?$/, { message: "BRL amount like 12.34" });
const Account = z.string().regex(/^G[A-Z2-7]{55}$/, { message: "G… Stellar account" });
const Asset = z.string().regex(/^[A-Za-z0-9]{1,12}:G[A-Z2-7]{55}$/, { message: "CODE:ISSUER" });
const PixKeyType = z.enum(["CPF", "CNPJ", "EMAIL", "PHONE", "RANDOM"]);

export const QuoteRequest = z.object({
  destination: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("br_code"),
      brCode: z.string().min(1).max(512),
      /** Only for a BR Code without its own amount; must match when the code has one. */
      amountBrl: AmountBrl.optional(),
    }),
    z.object({ type: z.literal("pix_key"), key: z.string().min(1).max(77), keyType: PixKeyType, amountBrl: AmountBrl }),
  ]),
  asset: Asset,
});

export const PaymentRequest = z.object({ quoteId: z.string().min(1).max(64), refundTo: Account.optional() });

const Payee = z.object({ name: z.string(), city: z.string(), key: z.string().optional() });

export const QuoteResponse = z.object({
  id: z.string(),
  destination: z.discriminatedUnion("type", [
    z.object({ type: z.literal("br_code"), payee: Payee, isDynamic: z.boolean() }),
    z.object({ type: z.literal("pix_key"), key: z.string(), keyType: PixKeyType }),
  ]),
  amountBrl: AmountBrl,
  feeBrl: AmountBrl,
  asset: Asset,
  /** Exact amount to send, in the asset (up to 7 decimals). */
  assetAmount: z.string(),
  /** BRL per USD used to price the quote. */
  rate: z.string(),
  expiresAt: z.string(),
});

const Deposit = z.object({
  /** Pay this M… address (classic payment or SAC transfer)… */
  address: z.string(),
  /** …or this account with memo id `memoId`. */
  account: Account,
  memoId: z.string(),
  asset: Asset,
  amount: z.string(),
  expiresAt: z.string(),
});

export const PaymentStatus = z.enum([
  "awaiting_deposit",
  "funded",
  "paying",
  "completed",
  "refunding",
  "refunded",
  "expired",
]);

export const CreatePaymentResponse = z.object({ id: z.string(), status: PaymentStatus, deposit: Deposit });

export const PaymentResponse = z.object({
  id: z.string(),
  status: PaymentStatus,
  quote: QuoteResponse,
  deposit: Deposit,
  funding: z.object({ txHash: z.string(), ledgerClosedAt: z.string(), amount: z.string() }).nullable(),
  payout: z.object({ endToEndId: z.string(), txHash: z.string() }).nullable(),
  refunds: z.array(
    z.object({
      amount: z.string(),
      reason: z.string(),
      status: z.enum(["requested", "sent"]),
      txHash: z.string().nullable(),
    }),
  ),
  timeline: z.array(z.object({ status: PaymentStatus, at: z.string() })),
});

const HttpUrl = z
  .string()
  .max(2048)
  .refine(
    (u) => {
      try {
        return ["https:", "http:"].includes(new URL(u).protocol);
      } catch {
        return false;
      }
    },
    { message: "an http(s) URL" },
  );

export const WebhookEndpointRequest = z.object({ url: HttpUrl });

const WebhookEndpoint = z.object({ id: z.string(), url: z.string(), createdAt: z.string() });

/** The secret is shown only here, once (Standard Webhooks `whsec_…`, §5.2). */
export const WebhookEndpointCreated = WebhookEndpoint.extend({ secret: z.string() });

export const WebhookEndpointList = z.object({ endpoints: z.array(WebhookEndpoint) });

/** The body of every integrator webhook (§5.2): the payment exactly as `GET /v0/payments/:id` returns it. */
export const PaymentWebhook = z.object({ type: z.literal("payment.updated"), payment: PaymentResponse });

export const ErrorCode = z.enum([
  "UNAUTHORIZED",
  "INVALID_REQUEST",
  "IDEMPOTENCY_KEY_REQUIRED",
  "IDEMPOTENCY_KEY_REUSED",
  "INVALID_BR_CODE",
  "AMOUNT_REQUIRED",
  "AMOUNT_MISMATCH",
  "ASSET_NOT_SUPPORTED",
  "QUOTE_NOT_FOUND",
  "QUOTE_EXPIRED",
  "QUOTE_ALREADY_USED",
  "PAYMENT_NOT_FOUND",
  "WEBHOOK_ENDPOINT_NOT_FOUND",
  "FLOAT_UNAVAILABLE",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorResponse = z.object({ error: z.object({ code: ErrorCode, message: z.string() }) });
