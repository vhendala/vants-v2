// Waiting (T-042, DEC-059): one vocabulary across the app. A wait is quiet for its first seconds (the placeholder or the
// turning button says enough), then says it is still working and what is safe, then, past half a minute, what to do. While a
// transaction is being sent, the way back is locked so nobody leaves thinking they cancelled it.
import { useEffect, useState, useSyncExternalStore } from "react";

/** After this long a wait says it is still working (testnet's RPC often takes 2–3 s; T-039). */
export const SLOW_MS = 5_000;
/** After this long it says what to do. */
export const STUCK_MS = 30_000;

export type WaitStage = "now" | "slow" | "stuck";

export function waitStage(elapsedMs: number): WaitStage {
  return elapsedMs >= STUCK_MS ? "stuck" : elapsedMs >= SLOW_MS ? "slow" : "now";
}

/**
 * How long the current wait has run, as a stage; back to "now" whenever it stops. A string names the wait's phase: a new
 * phase starts the count again (signing, then sending, then recording).
 */
export function useWaitStage(wait: boolean | string | null): WaitStage {
  // The stage belongs to the wait it was counted for, so a new phase never shows the last one's words.
  const [counted, setCounted] = useState<{ wait: boolean | string | null; stage: WaitStage }>({ wait, stage: "now" });
  useEffect(() => {
    setCounted({ wait, stage: "now" }); // a wait that starts again (true, false, true) counts from zero
    if (!wait) return;
    const slow = setTimeout(() => setCounted({ wait, stage: "slow" }), SLOW_MS);
    const stuck = setTimeout(() => setCounted({ wait, stage: "stuck" }), STUCK_MS);
    return () => {
      clearTimeout(slow);
      clearTimeout(stuck);
    };
  }, [wait]);
  return wait && counted.wait === wait ? counted.stage : "now";
}

export function createNavLock() {
  const holders = new Set<symbol>();
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of listeners) l();
  };
  return {
    locked: () => holders.size > 0,
    /** Locks until the returned function is called (calling it again does nothing). */
    hold(): () => void {
      const me = Symbol("hold");
      const was = holders.size > 0;
      holders.add(me);
      if (!was) emit();
      return () => {
        if (!holders.delete(me)) return;
        if (holders.size === 0) emit();
      };
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The app's one lock on the way back (flow headers read it). */
export const navLock = createNavLock();

/** Hold the lock while `active`. */
export function useNavLock(active: boolean) {
  useEffect(() => (active ? navLock.hold() : undefined), [active]);
}

export function useNavLocked(): boolean {
  return useSyncExternalStore(navLock.subscribe, navLock.locked, navLock.locked);
}
