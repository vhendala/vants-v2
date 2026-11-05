// POST /ingress/pier (SPEC §3.6; INV-04, INV-08).
import { readFileSync } from "node:fs";
import type { InboundSignal } from "@vants/db";
import Fastify from "fastify";
import { Webhook } from "standardwebhooks";
import { describe, expect, it } from "vitest";
import { pierIngress } from "./pier.ts";

const rec = JSON.parse(
  readFileSync(new URL("../../../../packages/adapters/pier/test/fixtures/envelopes.json", import.meta.url), "utf8"),
);
const SECRET = `whsec_${Buffer.from("vants-test-secret-0123456789abcdef").toString("base64")}`;

function setup(opts: { secret?: string; subscriptionId?: string; fail?: boolean } = {}) {
  const recorded: InboundSignal[] = [];
  const app = Fastify();
  app.register(pierIngress, {
    ...(opts.secret === "" ? {} : { secret: opts.secret ?? SECRET }),
    ...(opts.subscriptionId ? { subscriptionId: opts.subscriptionId } : {}),
    recorder: {
      async recordInbound(s) {
        if (opts.fail) throw new Error("db down");
        recorded.push(s);
        return { id: "1", duplicate: false };
      },
    },
  });
  return { app, recorded };
}

const post = (app: ReturnType<typeof Fastify>, body: object, secret = SECRET) => {
  const raw = JSON.stringify(body);
  const id = `${(body as { subscriptionId?: string }).subscriptionId}:${rec.classicMemoId.envelope.position}`;
  const now = new Date();
  return app.inject({
    method: "POST",
    url: "/ingress/pier",
    headers: {
      "content-type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": String(Math.floor(now.getTime() / 1000)),
      "webhook-signature": new Webhook(secret).sign(id, now, raw),
    },
    payload: raw,
  });
};

const body = { subscriptionId: "sub_1", event: rec.classicMemoId.envelope };

describe("pier ingress", () => {
  it("stores a verified delivery in the inbox, keyed by the envelope id", async () => {
    const { app, recorded } = setup({ subscriptionId: "sub_1" });
    expect((await post(app, body)).statusCode).toBe(200);
    expect(recorded).toEqual([{ source: "pier", dedupeKey: rec.classicMemoId.envelope.id, payload: body }]);
  });

  it("rejects a bad signature, or any delivery when no secret is configured", async () => {
    const other = `whsec_${Buffer.from("another-secret-0123456789abcdefgh").toString("base64")}`;
    expect((await post(setup().app, body, other)).statusCode).toBe(401);
    expect((await post(setup({ secret: "" }).app, body)).statusCode).toBe(401);
  });

  it("rejects a delivery for a subscription that isn't ours", async () => {
    const { app, recorded } = setup({ subscriptionId: "sub_mine" });
    expect((await post(app, body)).statusCode).toBe(400);
    expect(recorded).toEqual([]);
  });

  it("answers 500 when the inbox write fails, so Pier retries", async () => {
    expect((await post(setup({ fail: true }).app, body)).statusCode).toBe(500);
  });
});
