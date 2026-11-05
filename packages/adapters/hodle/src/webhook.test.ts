// Hodle webhook verification and parsing (T-006, INV-08). Signing scheme from docs.hodle.com.br/docs/webhooks:
// X-Hodle-Signature = hex(HMAC_SHA256(secret, "<X-Hodle-Timestamp>.<raw body>")), 300 s tolerance, constant-time compare.
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HODLE_EVENTS, parseHodleWebhook, verifyHodleSignature } from "./webhook.ts";

const fixtures = JSON.parse(readFileSync(new URL("../test/fixtures/webhooks.json", import.meta.url), "utf8"));
const SECRET = "ab".repeat(32);
const NOW = 1_761_180_000;
const sign = (raw: string, ts: number | string, secret = SECRET) =>
  createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex");

describe("verifyHodleSignature", () => {
  const raw = JSON.stringify(fixtures.PAYOUT_SUCCESSFUL);
  const ok = { rawBody: raw, timestamp: String(NOW), signature: sign(raw, NOW), secret: SECRET, nowSeconds: NOW };

  it("accepts a correct signature", () => {
    expect(verifyHodleSignature(ok)).toBe(true);
  });

  it("rejects a wrong secret or a tampered body", () => {
    expect(verifyHodleSignature({ ...ok, secret: "cd".repeat(32) })).toBe(false);
    expect(verifyHodleSignature({ ...ok, rawBody: raw.replace("12.34", "99.99") })).toBe(false);
  });

  it("rejects timestamps more than 300 s away, either side", () => {
    expect(verifyHodleSignature({ ...ok, nowSeconds: NOW + 300 })).toBe(true);
    expect(verifyHodleSignature({ ...ok, nowSeconds: NOW + 301 })).toBe(false);
    expect(verifyHodleSignature({ ...ok, nowSeconds: NOW - 301 })).toBe(false);
  });

  it("rejects malformed headers without throwing", () => {
    expect(verifyHodleSignature({ ...ok, signature: "not-hex" })).toBe(false);
    expect(verifyHodleSignature({ ...ok, signature: "" })).toBe(false);
    expect(verifyHodleSignature({ ...ok, timestamp: "soon" })).toBe(false);
    expect(verifyHodleSignature({ ...ok, signature: `${ok.signature}00` })).toBe(false);
  });

  it("re-signs each retry with a fresh timestamp: an old signature with a new timestamp fails", () => {
    expect(verifyHodleSignature({ ...ok, timestamp: String(NOW + 10), nowSeconds: NOW + 10 })).toBe(false);
  });
});

describe("parseHodleWebhook", () => {
  it("keys a payout success by its transaction id", () => {
    const r = parseHodleWebhook(JSON.stringify(fixtures.PAYOUT_SUCCESSFUL));
    expect(r).toMatchObject({
      ok: true,
      event: "PAYOUT_SUCCESSFUL",
      dedupeKey: "PAYOUT_SUCCESSFUL:6ada6a513d373872025e1cdf",
      externalId: "vants:pay_1",
      transactionId: "6ada6a513d373872025e1cdf",
    });
  });

  it("keys a payout failure by its on-chain invoice when there is no transaction id", () => {
    const r = parseHodleWebhook(JSON.stringify(fixtures.PAYOUT_FAILED));
    expect(r).toMatchObject({
      ok: true,
      event: "PAYOUT_FAILED",
      dedupeKey: `PAYOUT_FAILED:${fixtures.PAYOUT_FAILED.data.invoice}`,
    });
  });

  it("keys deposit events by data.eventId, as Hodle documents", () => {
    const r = parseHodleWebhook(JSON.stringify(fixtures.DEPOSIT_ASSET_SUCCESS));
    expect(r).toMatchObject({ ok: true, dedupeKey: "deposit-completed-66f0c1e2a4b5c6d7e8f90123" });
  });

  it("recognises the registration test delivery, which must cause no action", () => {
    expect(parseHodleWebhook(JSON.stringify(fixtures.WEBHOOK_TEST))).toMatchObject({
      ok: true,
      event: "WEBHOOK_TEST",
      test: true,
    });
  });

  it("rejects unknown events, non-JSON and bodies without an identifier", () => {
    expect(parseHodleWebhook(JSON.stringify({ event: "SOMETHING_ELSE", data: {} }))).toMatchObject({ ok: false });
    expect(parseHodleWebhook("not json")).toMatchObject({ ok: false });
    expect(parseHodleWebhook(JSON.stringify({ event: "PAYOUT_SUCCESSFUL", data: {} }))).toMatchObject({ ok: false });
  });

  it("covers the events the spec registers", () => {
    expect([...HODLE_EVENTS].sort()).toEqual(
      ["DEPOSIT_ASSET_FAILED", "DEPOSIT_ASSET_SUCCESS", "PAYOUT_FAILED", "PAYOUT_REFUNDED", "PAYOUT_SUCCESSFUL"].sort(),
    );
  });
});
