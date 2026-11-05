// POST /ingress/hodle/:event (SPEC §3.6, §5.4). One URL per event because Hodle signs each event's webhook with its own secret.
// Order of checks: known event → registration test (2xx, no action, Hodle sends it before the secret is shown) → signature
// (INV-08) → body matches the URL → stored once in the inbox (INV-04). 2xx only after the inbox write commits.
import { HODLE_EVENTS, parseHodleWebhook, verifyHodleSignature } from "@vants/adapter-hodle/webhook";
import type { InboundSignal } from "@vants/db";
import type { FastifyPluginAsync } from "fastify";

export interface InboundRecorder {
  recordInbound(signal: InboundSignal): Promise<{ id: string; duplicate: boolean }>;
}

export interface HodleIngressOptions {
  /** Event → webhook secret (`HODLE_WEBHOOK_SECRETS`). An event without one is refused until registered (SPEC §11 Q1). */
  secrets: Record<string, string>;
  recorder: InboundRecorder;
  nowSeconds?: () => number;
}

const header = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export const hodleIngress: FastifyPluginAsync<HodleIngressOptions> = async (app, opts) => {
  // Keep the exact bytes: the signature covers the raw body, not a re-serialised one.
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

  app.post<{ Params: { event: string } }>("/ingress/hodle/:event", async (req, reply) => {
    const { event } = req.params;
    if (!HODLE_EVENTS.has(event)) return reply.code(404).send({ error: "unknown event" });

    const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
    const parsed = parseHodleWebhook(raw);
    if (parsed.ok && parsed.test) return reply.code(200).send({ ok: true });

    const secret = opts.secrets[event];
    const verified =
      secret !== undefined &&
      verifyHodleSignature({
        rawBody: raw,
        signature: header(req.headers["x-hodle-signature"]),
        timestamp: header(req.headers["x-hodle-timestamp"]),
        secret,
        nowSeconds: opts.nowSeconds?.() ?? Math.floor(Date.now() / 1000),
      });
    if (!verified) return reply.code(401).send({ error: "invalid signature" });
    if (!parsed.ok) return reply.code(400).send({ error: parsed.reason });
    if (parsed.event !== event) return reply.code(400).send({ error: "event does not match the URL" });

    const attempt = Number(header(req.headers["x-hodle-delivery-attempt"]) || "1");
    try {
      await opts.recorder.recordInbound({
        source: "hodle",
        dedupeKey: parsed.dedupeKey,
        payload: { event, data: parsed.data, deliveryAttempt: Number.isFinite(attempt) ? attempt : 1 },
      });
    } catch (err) {
      req.log.error({ err }, "hodle ingress: inbox write failed");
      return reply.code(500).send({ error: "not stored, retry" });
    }
    return reply.code(200).send({ ok: true });
  });
};
