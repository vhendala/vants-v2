// POST /ingress/hodle/:event (SPEC §3.6, §5.4; INV-04, INV-08).
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import type { InboundSignal } from "@vants/db";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { hodleIngress } from "./hodle.ts";

const fixtures = JSON.parse(
  readFileSync(new URL("../../../../packages/adapters/hodle/test/fixtures/webhooks.json", import.meta.url), "utf8"),
);
const SECRET = "ab".repeat(32);
const NOW = 1_761_180_000;

function setup(opts: { secrets?: Record<string, string>; duplicate?: boolean; fail?: boolean } = {}) {
  const recorded: InboundSignal[] = [];
  const app = Fastify();
  app.register(hodleIngress, {
    secrets: opts.secrets ?? { PAYOUT_SUCCESSFUL: SECRET, DEPOSIT_ASSET_SUCCESS: SECRET },
    recorder: {
      async recordInbound(signal) {
        if (opts.fail) throw new Error("database down");
        recorded.push(signal);
        return { id: "1", duplicate: Boolean(opts.duplicate) };
      },
    },
    nowSeconds: () => NOW,
  });
  return { app, recorded };
}

const post = (app: ReturnType<typeof Fastify>, event: string, body: unknown, sign = true, secret = SECRET) => {
  const raw = JSON.stringify(body);
  const signature = createHmac("sha256", secret).update(`${NOW}.${raw}`).digest("hex");
  return app.inject({
    method: "POST",
    url: `/ingress/hodle/${event}`,
    headers: {
      "content-type": "application/json",
      ...(sign ? { "x-hodle-signature": signature, "x-hodle-timestamp": String(NOW) } : {}),
      "x-hodle-delivery-attempt": "2",
    },
    payload: raw,
  });
};

describe("hodle ingress", () => {
  it("stores a verified event once in the inbox and acknowledges it", async () => {
    const { app, recorded } = setup();
    const res = await post(app, "PAYOUT_SUCCESSFUL", fixtures.PAYOUT_SUCCESSFUL);
    expect(res.statusCode).toBe(200);
    expect(recorded).toEqual([
      {
        source: "hodle",
        dedupeKey: "PAYOUT_SUCCESSFUL:6ada6a513d373872025e1cdf",
        payload: { event: "PAYOUT_SUCCESSFUL", data: fixtures.PAYOUT_SUCCESSFUL.data, deliveryAttempt: 2 },
      },
    ]);
  });

  it("acknowledges a duplicate delivery without error", async () => {
    const { app } = setup({ duplicate: true });
    expect((await post(app, "PAYOUT_SUCCESSFUL", fixtures.PAYOUT_SUCCESSFUL)).statusCode).toBe(200);
  });

  it("rejects a forged or missing signature with 401 and writes nothing (INV-08)", async () => {
    const { app, recorded } = setup();
    expect((await post(app, "PAYOUT_SUCCESSFUL", fixtures.PAYOUT_SUCCESSFUL, true, "cd".repeat(32))).statusCode).toBe(
      401,
    );
    expect((await post(app, "PAYOUT_SUCCESSFUL", fixtures.PAYOUT_SUCCESSFUL, false)).statusCode).toBe(401);
    expect(recorded).toEqual([]);
  });

  it("rejects events whose secret is not registered yet (SPEC §11 Q1)", async () => {
    const { app, recorded } = setup({ secrets: {} });
    expect((await post(app, "PAYOUT_SUCCESSFUL", fixtures.PAYOUT_SUCCESSFUL)).statusCode).toBe(401);
    expect(recorded).toEqual([]);
  });

  it("answers the registration test delivery with 2xx and takes no action", async () => {
    const { app, recorded } = setup({ secrets: {} });
    expect((await post(app, "PAYOUT_SUCCESSFUL", fixtures.WEBHOOK_TEST, false)).statusCode).toBe(200);
    expect(recorded).toEqual([]);
  });

  it("rejects a body whose event differs from the URL, and unknown events", async () => {
    const { app } = setup();
    expect((await post(app, "DEPOSIT_ASSET_SUCCESS", fixtures.PAYOUT_SUCCESSFUL)).statusCode).toBe(400);
    expect((await post(app, "SOMETHING_ELSE", fixtures.PAYOUT_SUCCESSFUL)).statusCode).toBe(404);
  });

  it("answers 500 when the inbox write fails, so Hodle retries", async () => {
    const { app } = setup({ fail: true });
    expect((await post(app, "PAYOUT_SUCCESSFUL", fixtures.PAYOUT_SUCCESSFUL)).statusCode).toBe(500);
  });
});
