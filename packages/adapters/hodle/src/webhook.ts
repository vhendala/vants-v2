// Hodle webhook verification and parsing: no network, so `api` may import it (`@vants/adapter-hodle/webhook`, DEC-021).
// Scheme (docs.hodle.com.br/docs/webhooks): X-Hodle-Signature = hex(HMAC_SHA256(secret, "<X-Hodle-Timestamp>.<raw body>")),
// reject deliveries more than 300 s away from now, compare in constant time. One webhook (and secret) per event.
import { createHmac, timingSafeEqual } from "node:crypto";

export const HODLE_EVENTS: ReadonlySet<string> = new Set([
  "PAYOUT_SUCCESSFUL",
  "PAYOUT_FAILED",
  "PAYOUT_REFUNDED",
  "DEPOSIT_ASSET_SUCCESS",
  "DEPOSIT_ASSET_FAILED",
]);
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function verifyHodleSignature(input: {
  rawBody: string;
  signature: string;
  timestamp: string;
  secret: string;
  nowSeconds?: number;
}): boolean {
  const { rawBody, signature, timestamp, secret } = input;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!/^\d{1,12}$/.test(timestamp) || !/^[0-9a-fA-F]{64}$/.test(signature) || !secret) return false;
  if (Math.abs(now - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest();
  const received = Buffer.from(signature, "hex");
  return received.length === expected.length && timingSafeEqual(expected, received);
}

export type ParsedHodleWebhook =
  | { ok: true; test: true; event: "WEBHOOK_TEST" }
  | {
      ok: true;
      test: false;
      event: string;
      /** Stable across Hodle's retries; the inbox's dedupe key (INV-04). */
      dedupeKey: string;
      data: Record<string, unknown>;
      externalId?: string;
      transactionId?: string;
      txHash?: string;
    }
  | { ok: false; reason: string };

const text = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : undefined);

export function parseHodleWebhook(rawBody: string): ParsedHodleWebhook {
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { ok: false, reason: "body is not JSON" };
  }
  if (!body || typeof body !== "object") return { ok: false, reason: "body is not an object" };
  const { event, data } = body as { event?: unknown; data?: unknown };
  if (event === "WEBHOOK_TEST") return { ok: true, test: true, event };
  if (typeof event !== "string" || !HODLE_EVENTS.has(event)) return { ok: false, reason: "unknown event" };
  if (!data || typeof data !== "object") return { ok: false, reason: "missing data" };
  const d = data as Record<string, unknown>;

  let id: string | undefined;
  if (event.startsWith("DEPOSIT_"))
    id = text(d.eventId); // documented: same on every retry
  else if (event === "PAYOUT_REFUNDED") id = text(d.reversalTicketId) ?? text(d.refundTxId) ?? text(d.refundInvoice);
  else id = text(d.transactionId) ?? text(d.externalId) ?? text(d.invoice);
  if (!id) return { ok: false, reason: `no identifier to deduplicate ${event}` };

  const externalId = text(d.externalId);
  const transactionId = text(d.transactionId);
  const txHash = text(d.txHash) ?? text(d.invoice);
  return {
    ok: true,
    test: false,
    event,
    dedupeKey: event.startsWith("DEPOSIT_") ? id : `${event}:${id}`,
    data: d,
    ...(externalId ? { externalId } : {}),
    ...(transactionId ? { transactionId } : {}),
    ...(txHash ? { txHash } : {}),
  };
}
