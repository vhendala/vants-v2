// Pier webhook verification: no network, so `api` may import it (`@vants/adapter-pier/webhook`, DEC-021).
// Pier signs with Standard Webhooks (webhook-id / webhook-timestamp / webhook-signature, whsec_ secret); the
// library checks the signature and the timestamp tolerance and throws on failure.
import { Webhook } from "standardwebhooks";

export type VerifiedPierWebhook =
  | { ok: true; subscriptionId: string; event: { id: string; position: string } & Record<string, unknown> }
  | { ok: false; reason: string };

export function verifyPierWebhook(
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
  secret: string,
): VerifiedPierWebhook {
  let body: unknown;
  try {
    const header = (name: string) => {
      const value = headers[name];
      return (Array.isArray(value) ? value[0] : value) ?? "";
    };
    new Webhook(secret).verify(rawBody, {
      "webhook-id": header("webhook-id"),
      "webhook-timestamp": header("webhook-timestamp"),
      "webhook-signature": header("webhook-signature"),
    });
    body = JSON.parse(rawBody);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "verification failed" };
  }
  const b = body as { subscriptionId?: unknown; event?: { id?: unknown; position?: unknown } };
  if (
    typeof b?.subscriptionId !== "string" ||
    typeof b.event?.id !== "string" ||
    typeof b.event.position !== "string"
  ) {
    return { ok: false, reason: "not a Pier webhook body" };
  }
  return { ok: true, subscriptionId: b.subscriptionId, event: b.event as { id: string; position: string } };
}
