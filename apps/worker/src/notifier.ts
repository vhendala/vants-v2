// The notifier (SPEC §5.2, T-012): integrator webhooks. `payment_transitions` is its outbox. Each transition is fanned out
// once into one notification per active endpoint, in the same transaction that marks it done. Delivery happens outside
// any transaction, signed with Standard Webhooks (the scheme Pier uses). It is at least once: a crash after sending
// resends with the same webhook-id ("<paymentId>:<version>"), which receivers deduplicate on. The body is the payment
// as `GET /v0/payments/:id` shows it when the notification is created (DEC-026).
import {
  activeEndpointIds,
  type Backbone,
  type DepositAddress,
  type DueNotification,
  insertNotification,
  markTransitionNotified,
  nextDueNotification,
  paymentResource,
  recordDelivery,
  unnotifiedTransitions,
} from "@vants/db";
import type { DomainEvent } from "@vants/domain";
import { Webhook } from "standardwebhooks";

/** Seconds before each retry; after the last one the notification is marked failed (≈ 3.5 h in all). */
export const RETRY_SCHEDULE_SECONDS = [60, 120, 300, 900, 1800, 3600, 3600, 3600];
const FAN_OUT_BATCH = 100;

export const NOTIFIER_PUMP = "notifier-pump";
export const NOTIFIER_WAKE = "notifier-wake";

/** Events after which a payment may have a new transition: each wakes the notifier. */
export const NOTIFY_ON = [
  "PaymentAccepted",
  "DepositMatched",
  "PayoutCompleted",
  "PayoutFailed",
  "PayoutReversed",
  "RefundSent",
  "PaymentCompleted",
  "PaymentRefunded",
  "PaymentExpired",
];

export interface NotifierDeps {
  backbone: Pick<Backbone, "withTransaction">;
  deposit: DepositAddress;
  now: () => Date;
  fetch?: typeof fetch;
  /** Per delivery attempt. Default 10 s. */
  timeoutMs?: number;
}

/** Turns new transitions into notifications. Concurrent runs split the work (SKIP LOCKED); each transition goes once. */
export async function fanOut(deps: NotifierDeps): Promise<number> {
  let total = 0;
  for (;;) {
    const n = await deps.backbone.withTransaction(async (tx) => {
      const transitions = await unnotifiedTransitions(tx, FAN_OUT_BATCH);
      for (const t of transitions) {
        const endpoints = await activeEndpointIds(tx, t.integratorId);
        if (endpoints.length > 0) {
          const payment = await paymentResource(tx, t.paymentId, { deposit: deps.deposit });
          const body = { type: "payment.updated", payment };
          for (const endpointId of endpoints) {
            await insertNotification(tx, {
              endpointId,
              webhookId: `${t.paymentId}:${t.version}`,
              paymentId: t.paymentId,
              body,
            });
          }
        }
        await markTransitionNotified(tx, t.paymentId, t.version);
      }
      return transitions.length;
    });
    total += n;
    if (n < FAN_OUT_BATCH) return total;
  }
}

type Outcome = Parameters<typeof recordDelivery>[2];

/** Sends every notification due now, oldest first. A failed attempt is rescheduled, never retried in the same run. */
export async function deliverDue(deps: NotifierDeps): Promise<{ delivered: number; retrying: number; failed: number }> {
  const counts = { delivered: 0, retrying: 0, failed: 0 };
  const tried = new Set<string>();
  for (;;) {
    const n = await deps.backbone.withTransaction((tx) => nextDueNotification(tx, deps.now()));
    if (!n || tried.has(`${n.endpointId} ${n.webhookId}`)) return counts;
    tried.add(`${n.endpointId} ${n.webhookId}`);
    const outcome = await send(n, deps);
    await deps.backbone.withTransaction((tx) => recordDelivery(tx, n, outcome));
    counts[outcome.kind === "retry" ? "retrying" : outcome.kind] += 1;
  }
}

export async function runNotifier(deps: NotifierDeps): Promise<void> {
  await fanOut(deps);
  await deliverDue(deps);
}

async function send(n: DueNotification, deps: NotifierDeps): Promise<Outcome> {
  const payload = JSON.stringify(n.body);
  const sentAt = deps.now();
  try {
    const res = await (deps.fetch ?? fetch)(n.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "vants-notifier/0",
        "webhook-id": n.webhookId,
        "webhook-timestamp": String(Math.floor(sentAt.getTime() / 1000)),
        "webhook-signature": new Webhook(n.secret).sign(n.webhookId, sentAt, payload),
      },
      body: payload,
      redirect: "manual",
      signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000),
    });
    await res.body?.cancel();
    if (res.status >= 200 && res.status < 300) return { kind: "delivered", status: res.status };
    return retryOrFail(n, res.status, `HTTP ${res.status}`, deps);
  } catch (err) {
    const cause = err instanceof Error && err.cause instanceof Error ? `: ${err.cause.message}` : "";
    return retryOrFail(n, null, `${err instanceof Error ? err.message : String(err)}${cause}`.slice(0, 300), deps);
  }
}

function retryOrFail(n: DueNotification, status: number | null, error: string, deps: NotifierDeps): Outcome {
  const delay = RETRY_SCHEDULE_SECONDS[n.attempts];
  if (delay === undefined) return { kind: "failed", status, error };
  return { kind: "retry", status, error, nextAttemptAt: new Date(deps.now().getTime() + delay * 1000) };
}

/** Any payment event wakes the notifier pump (in the event's transaction). */
export async function onPaymentEvent(
  tx: Parameters<Parameters<Backbone["withTransaction"]>[0]>[0],
  _event: DomainEvent,
  backbone: Pick<Backbone, "enqueue">,
): Promise<void> {
  await backbone.enqueue(tx, NOTIFIER_PUMP);
}

/** Wires the notifier: woken by payment events, and every minute for retries that come due. */
export async function registerNotifier(deps: NotifierDeps & { backbone: Backbone }): Promise<void> {
  const { backbone } = deps;
  await backbone.ensureQueue(NOTIFIER_WAKE);
  await backbone.ensureQueue(NOTIFIER_PUMP, { policy: "stately", retryLimit: 5, retryDelay: 5, expireInSeconds: 900 });
  for (const type of NOTIFY_ON) await backbone.subscribe(type, NOTIFIER_WAKE);
  await backbone.consume(NOTIFIER_WAKE, (event, tx) => onPaymentEvent(tx, event, backbone));
  await backbone.process(NOTIFIER_PUMP, () => runNotifier(deps));
  await backbone.schedule(NOTIFIER_PUMP, "* * * * *");
}
