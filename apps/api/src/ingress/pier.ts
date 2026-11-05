// POST /ingress/pier (SPEC §3.6). Pier pushes at least once and unordered; each delivery is verified (INV-08) and stored once
// in the inbox under the envelope id (INV-04), the same key the worker's pull reconciler uses.
import { verifyPierWebhook } from "@vants/adapter-pier/webhook";
import type { FastifyPluginAsync } from "fastify";
import type { InboundRecorder } from "./hodle.ts";

export interface PierIngressOptions {
  /** `PIER_WEBHOOK_SECRET` (whsec_…). Without it every delivery is refused. */
  secret?: string;
  /** `PIER_SUBSCRIPTION_ID`: when set, deliveries for any other subscription are refused. */
  subscriptionId?: string;
  recorder: InboundRecorder;
}

export const pierIngress: FastifyPluginAsync<PierIngressOptions> = async (app, opts) => {
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

  app.post("/ingress/pier", async (req, reply) => {
    if (!opts.secret) return reply.code(401).send({ error: "webhook secret not configured" });
    const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
    const v = verifyPierWebhook(raw, req.headers, opts.secret);
    if (!v.ok) return reply.code(401).send({ error: "invalid signature" });
    if (opts.subscriptionId && v.subscriptionId !== opts.subscriptionId) {
      return reply.code(400).send({ error: "unknown subscription" });
    }
    try {
      await opts.recorder.recordInbound({
        source: "pier",
        dedupeKey: v.event.id,
        payload: { subscriptionId: v.subscriptionId, event: v.event },
      });
    } catch (err) {
      req.log.error({ err }, "pier ingress: inbox write failed");
      return reply.code(500).send({ error: "not stored, retry" });
    }
    return reply.code(200).send({ ok: true });
  });
};
