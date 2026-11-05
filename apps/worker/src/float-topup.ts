// A manual float top-up for the sandbox (T-021 follow-up): credits the Hodle sandbox float with a USDH deposit the sandbox
// mints, booked like a refill's credit (`FloatCredited`: sandbox:standin → float:hodle) so reconciliation stays at zero. No
// USDC is bridged: it is the refill's last leg on its own, for testing payments larger than the float. Sandbox only.
import { activeRefill, type Backbone, floatPosition } from "@vants/db";
import { exactUsdhDeposit, rateToMicros } from "@vants/domain";
import type { SandboxFloatPort } from "./sagas/refill.ts";

export interface TopUpDeps {
  backbone: Backbone;
  float: SandboxFloatPort;
  /** The sandbox rate a deposit must be priced at (BRL per USD, micros). */
  rateMicros: bigint;
  /** Waits between balance reads while the credit shows up (tests pass a no-op). */
  pause?: () => Promise<void>;
  confirmTries?: number;
}

export type TopUpResult =
  | { ok: true; trackId: string; cents: number; credit6: bigint; balance6: bigint }
  | { ok: false; reason: string };

/** Credits about `want6` USDH (rounded down to an exact credit at the sandbox rate) and books it once confirmed. */
export async function topUpFloat(deps: TopUpDeps, want6: bigint): Promise<TopUpResult> {
  const { backbone, float } = deps;
  const { cents, credit6 } = exactUsdhDeposit(want6, deps.rateMicros);
  if (credit6 <= 0n) return { ok: false, reason: "amount too small for an exact credit at the sandbox rate" };
  const books = async () => (await backbone.withTransaction((tx) => floatPosition(tx))).balance6;
  if (await backbone.withTransaction((tx) => activeRefill(tx)))
    return { ok: false, reason: "a refill is in flight: let it finish first" };
  // The credit is confirmed as "Hodle minus the books": that only means something if they agree before it.
  const before = (await float.balance()) - (await books());
  if (before !== 0n) return { ok: false, reason: `the float differs from the books by ${before}: run pnpm reconcile` };

  const dep = await float.createDeposit(cents);
  // An unsettled deposit credits nothing, so refusing here is safe.
  if (rateToMicros(dep.rate) !== deps.rateMicros || Number(dep.fee) !== 0)
    return { ok: false, reason: `sandbox deposit priced at ${dep.rate} with fee ${dep.fee}; not settled` };
  if (!(await float.settleDeposit(dep.trackId)))
    return { ok: false, reason: `deposit ${dep.trackId} did not settle; nothing credited` };

  for (let i = 0; i < (deps.confirmTries ?? 10); i++) {
    if ((await float.balance()) - (await books()) === credit6) {
      await backbone.withTransaction((tx) =>
        backbone.publish(tx, [
          {
            type: "FloatCredited",
            version: 1,
            aggregate: { type: "float-topup", id: dep.trackId },
            correlationId: dep.trackId,
            causationId: null,
            payload: { credit6: credit6.toString(), cents, trackId: dep.trackId, source: "manual-topup" },
          },
        ]),
      );
      return { ok: true, trackId: dep.trackId, cents, credit6, balance6: await books() };
    }
    await (deps.pause ?? (() => new Promise((r) => setTimeout(r, 3_000))))();
  }
  return {
    ok: false,
    reason: `deposit ${dep.trackId} settled but the credit of ${credit6} isn't confirmed yet: run pnpm reconcile, it will show as a float difference`,
  };
}
