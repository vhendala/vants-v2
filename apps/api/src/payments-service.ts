// Quotes and payments, shared by Vants Pay v0 (integrators) and the mini app (T-020), so both get the same rules: the BR Code
// validated by Vants (INV-05), integer pricing (DEC-007), the float check (§3.7), and the payment accepted with its
// PaymentAccepted event in the caller's transaction (§3.3).
import { classicAsset, depositInstructions, sacIdOf } from "@vants/adapter-stellar";
import type { ApiConfig } from "@vants/config";
import {
  type Backbone,
  type Destination,
  floatPosition,
  getQuote,
  insertPayment,
  insertQuote,
  nextMuxId,
  type QuoteRecord,
  type Tx,
} from "@vants/db";
import { formatBrl, newPayment, type Payment, payoutDebit6, priceQuote, rateToMicros } from "@vants/domain";
import { checkBrCodeForPayout, normalizePixKey, parseAmountToCents, parseBrCode } from "@vants/pix";
import { randomUUID } from "node:crypto";

/** An error with its HTTP status and a stable code; the routes turn it into `{ error: { code, message } }`. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const errorBody = (code: string, message: string) => ({ error: { code, message } });

export type DestinationInput =
  | { type: "br_code"; brCode: string; amountBrl?: string | undefined }
  | { type: "pix_key"; key: string; keyType: "CPF" | "CNPJ" | "EMAIL" | "PHONE" | "RANDOM"; amountBrl: string };

export interface PaymentServiceDeps {
  backbone: Pick<Backbone, "publish">;
  config: Pick<ApiConfig, "treasuryAccount" | "fundingAssets" | "pricing">;
  now: () => Date;
}

export type PaymentService = ReturnType<typeof paymentService>;

export function paymentService(deps: PaymentServiceDeps) {
  const { config, now } = deps;
  const rateMicros = rateToMicros(config.pricing.rateBrlPerUsd);
  const assets = new Map(config.fundingAssets.map((name) => [name, sacIdOf(classicAsset(name))]));

  /** §3.7: the float must cover the payout (USDH it would debit) before Vants quotes or accepts it. Fails closed. */
  async function ensureFloat(tx: Tx, q: { valueCents: number; feeCents: number; rateMicros: bigint }): Promise<void> {
    const pos = await floatPosition(tx);
    if (!pos.opened) throw new ApiError(409, "FLOAT_UNAVAILABLE", "the float is not available yet");
    if (pos.available6 < payoutDebit6(q)) {
      throw new ApiError(409, "FLOAT_UNAVAILABLE", "the float can't cover this payment right now; try again later");
    }
  }

  /** Validates where the money goes and how much (INV-05): no database access. */
  function resolveDestination(input: DestinationInput): { destination: Destination; valueCents: number } {
    const requested = input.amountBrl === undefined ? undefined : parseAmountToCents(input.amountBrl);
    let destination: Destination;
    let valueCents: number;
    if (input.type === "br_code") {
      const parsed = parseBrCode(input.brCode);
      const codeAmount = parsed.ok ? parsed.code.amountCents : undefined;
      if (codeAmount !== undefined && requested !== undefined && codeAmount !== requested) {
        throw new ApiError(400, "AMOUNT_MISMATCH", `the BR Code fixes R$ ${formatBrl(codeAmount)}`);
      }
      const value = codeAmount ?? requested;
      if (parsed.ok && value === undefined) {
        throw new ApiError(400, "AMOUNT_REQUIRED", "this BR Code has no amount: send amountBrl");
      }
      const check = checkBrCodeForPayout(input.brCode, value ?? 1);
      if (!check.ok) {
        throw new ApiError(
          400,
          check.reason === "AMOUNT_MISMATCH" ? "AMOUNT_MISMATCH" : "INVALID_BR_CODE",
          check.message,
        );
      }
      valueCents = value ?? 0;
      destination = {
        type: "br_code",
        brCode: input.brCode,
        payee: { name: check.merchantName, city: check.merchantCity, ...(check.key ? { key: check.key } : {}) },
        isDynamic: check.isDynamic,
      };
    } else {
      valueCents = requested ?? 0;
      // Stored and paid in the directory's canonical form (digits, +55 phone, lower case), or refused here (T-025).
      const key = normalizePixKey(input.keyType, input.key);
      if (!key.ok) throw new ApiError(400, "INVALID_PIX_KEY", key.message);
      destination = { type: "pix_key", key: key.key, keyType: input.keyType };
    }
    if (valueCents <= 0) throw new ApiError(400, "INVALID_REQUEST", "amount must be positive");
    return { destination, valueCents };
  }

  /** Refuses (409 FLOAT_UNAVAILABLE) a payment of `valueCents` the float can't cover now: for pricing before any quote. */
  async function ensureFloatFor(tx: Tx, valueCents: number): Promise<void> {
    await ensureFloat(tx, { valueCents, feeCents: price(valueCents).feeCents, rateMicros });
  }

  /** The largest payment (centavos, fee included) the float covers right now: what `ensureFloatFor` would still accept. */
  async function maxPayableCents(tx: Tx): Promise<number> {
    const pos = await floatPosition(tx);
    if (!pos.opened || pos.available6 <= 0n) return 0;
    let cents = Number((pos.available6 * rateMicros) / 10n ** 10n);
    while (
      cents > 0 &&
      payoutDebit6({ valueCents: cents, feeCents: price(cents).feeCents, rateMicros }) > pos.available6
    )
      cents -= 1;
    return cents;
  }

  /** The price of `valueCents` in a funding asset (7 decimals), as a quote would set it. */
  function price(valueCents: number) {
    return priceQuote({ valueCents, rateMicros, feeModel: config.pricing.feeModel });
  }

  async function createQuote(
    tx: Tx,
    integratorId: string,
    input: { destination: DestinationInput; asset: string },
  ): Promise<QuoteRecord> {
    const assetSac = assets.get(input.asset);
    if (!assetSac) throw new ApiError(400, "ASSET_NOT_SUPPORTED", `funding assets: ${[...assets.keys()].join(", ")}`);
    const { destination, valueCents } = resolveDestination(input.destination);
    const p = price(valueCents);
    await ensureFloat(tx, { valueCents, feeCents: p.feeCents, rateMicros });
    return insertQuote(tx, {
      integratorId,
      destination,
      assetName: input.asset,
      assetSac,
      valueCents,
      feeCents: p.feeCents,
      rateMicros,
      assetAmount7: p.assetAmount7,
      expiresAt: new Date(now().getTime() + config.pricing.quoteTtlSeconds * 1000).toISOString(),
    });
  }

  async function acceptQuote(
    tx: Tx,
    integratorId: string,
    quoteId: string,
    refundTo?: string,
  ): Promise<{ payment: Payment; quote: QuoteRecord }> {
    const quote = await getQuote(tx, quoteId, integratorId);
    if (!quote) throw new ApiError(404, "QUOTE_NOT_FOUND", "no such quote");
    if (Date.parse(quote.expiresAt) < now().getTime()) {
      throw new ApiError(409, "QUOTE_EXPIRED", "quote expired: create a new one");
    }
    const used = await tx.query("SELECT 1 FROM payments WHERE quote_id = $1", [quote.id]);
    if (used.rows.length > 0) throw new ApiError(409, "QUOTE_ALREADY_USED", "this quote already has a payment");
    await ensureFloat(tx, quote);

    const payment = newPayment({
      id: `pay_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
      muxId: await nextMuxId(tx),
      quote: {
        asset: quote.assetSac,
        assetAmount7: quote.assetAmount7,
        valueCents: quote.valueCents,
        feeCents: quote.feeCents,
        rateMicros: quote.rateMicros,
        expiresAt: quote.expiresAt,
      },
      ...(refundTo ? { refundTo } : {}),
    });
    await insertPayment(tx, payment, integratorId, quote.id);
    await deps.backbone.publish(tx, [
      {
        type: "PaymentAccepted",
        version: 1,
        aggregate: { type: "payment", id: payment.id },
        correlationId: payment.id,
        causationId: null,
        payload: { quoteId: quote.id, muxId: payment.muxId, expiresAt: quote.expiresAt },
      },
    ]);
    return { payment, quote };
  }

  return {
    rateMicros,
    assets,
    resolveDestination,
    price,
    ensureFloatFor,
    maxPayableCents,
    createQuote,
    acceptQuote,
    deposit: (muxId: string) => depositInstructions(config.treasuryAccount, muxId),
  };
}
