// Wires the sagas onto the backbone (T-011): inbox consumers, event consumers, the two pumps and the sweep.
import { type Backbone, inboxQueue } from "@vants/db";
import { onPierRecord } from "./deposits.ts";
import { FLOAT_EVENTS, FLOAT_SAGA, onFloatEvent } from "./float.ts";
import { onHodleRecord } from "./hodle-events.ts";
import { onPayoutRequested, runPayoutPump } from "./payouts.ts";
import type { FloatDeps, PayoutDeps, RefundDeps } from "./ports.ts";
import { PAYOUT_PUMP, PAYOUT_SAGA, REFUND_PUMP, REFUND_SAGA, SWEEP } from "./queues.ts";
import { onRefundEvent, runRefundPump } from "./refunds.ts";
import { sweep } from "./sweep.ts";

export type { LedgerPort, PayoutPort } from "./ports.ts";

export interface SagaWiring extends PayoutDeps, RefundDeps, FloatDeps {
  backbone: Backbone;
}

/** A pump retries quickly while its first item is pending; the per-minute sweep re-wakes it if retries run out. */
const PUMP = { policy: "stately", retryLimit: 100, retryDelay: 5, retryDelayMax: 60, expireInSeconds: 600 } as const;

export async function registerSagas(deps: SagaWiring): Promise<void> {
  const { backbone } = deps;
  for (const q of [inboxQueue("pier"), inboxQueue("hodle"), PAYOUT_SAGA, REFUND_SAGA, FLOAT_SAGA])
    await backbone.ensureQueue(q);
  await backbone.ensureQueue(PAYOUT_PUMP, PUMP);
  await backbone.ensureQueue(REFUND_PUMP, PUMP);
  await backbone.ensureQueue(SWEEP, { policy: "stately", retryLimit: 2 });

  await backbone.subscribe("PayoutRequested", PAYOUT_SAGA);
  await backbone.subscribe("RefundRequested", REFUND_SAGA);
  await backbone.subscribe("UnattributedDeposit", REFUND_SAGA);
  for (const type of FLOAT_EVENTS) await backbone.subscribe(type, FLOAT_SAGA);

  await backbone.consumeInbox("pier", (record, tx) => onPierRecord(tx, record, deps));
  await backbone.consumeInbox("hodle", (record, tx) => onHodleRecord(tx, record, deps));
  await backbone.consume(PAYOUT_SAGA, (event, tx) => onPayoutRequested(tx, event, deps));
  await backbone.consume(REFUND_SAGA, (event, tx) => onRefundEvent(tx, event, deps));
  await backbone.consume(FLOAT_SAGA, (event, tx) => onFloatEvent(tx, event, deps));
  await backbone.process(PAYOUT_PUMP, async () => void (await runPayoutPump(deps)));
  await backbone.process(REFUND_PUMP, async () => void (await runRefundPump(deps)));
  await backbone.process(SWEEP, async () => void (await sweep(deps)));
  await backbone.schedule(SWEEP, "* * * * *");
}
