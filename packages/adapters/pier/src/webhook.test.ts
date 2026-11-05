// Pier webhook v1: body { subscriptionId, event }, Standard Webhooks headers, whsec_ secret (Pier SPEC §5).
import { readFileSync } from "node:fs";
import { Webhook } from "standardwebhooks";
import { describe, expect, it } from "vitest";
import { verifyPierWebhook } from "./webhook.ts";

const rec = JSON.parse(readFileSync(new URL("../test/fixtures/envelopes.json", import.meta.url), "utf8"));
const SECRET = `whsec_${Buffer.from("vants-test-secret-0123456789abcdef").toString("base64")}`;

function signed(body: object, secret = SECRET) {
  const raw = JSON.stringify(body);
  const id = `sub_1:${rec.classicMemoId.envelope.position}`;
  const now = new Date();
  const signature = new Webhook(secret).sign(id, now, raw);
  return {
    raw,
    headers: {
      "webhook-id": id,
      "webhook-timestamp": String(Math.floor(now.getTime() / 1000)),
      "webhook-signature": signature,
    },
  };
}

describe("verifyPierWebhook", () => {
  const body = { subscriptionId: "sub_1", event: rec.classicMemoId.envelope };

  it("returns the subscription and envelope for a valid signature", () => {
    const { raw, headers } = signed(body);
    expect(verifyPierWebhook(raw, headers, SECRET)).toEqual({ ok: true, subscriptionId: "sub_1", event: body.event });
  });

  it("rejects a wrong secret, a tampered body and missing headers", () => {
    const { raw, headers } = signed(body);
    const other = `whsec_${Buffer.from("another-secret-0123456789abcdefgh").toString("base64")}`;
    expect(verifyPierWebhook(raw, headers, other)).toMatchObject({ ok: false });
    expect(verifyPierWebhook(raw.replace("12345678", "99999999"), headers, SECRET)).toMatchObject({ ok: false });
    expect(verifyPierWebhook(raw, {}, SECRET)).toMatchObject({ ok: false });
  });

  it("rejects a signed body that is not a Pier webhook", () => {
    const { raw, headers } = signed({ hello: "world" });
    expect(verifyPierWebhook(raw, headers, SECRET)).toMatchObject({ ok: false });
  });
});
