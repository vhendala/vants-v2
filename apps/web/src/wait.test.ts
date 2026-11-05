// T-042: one vocabulary for waiting. How long a wait has run decides what the screen says, and while a transaction is being
// sent the way back is locked.
import { describe, expect, it } from "vitest";
import { createNavLock, SLOW_MS, STUCK_MS, waitStage } from "./wait.ts";

describe("waitStage", () => {
  it("is quiet at first, then says it is still working, then what to do", () => {
    expect(waitStage(0)).toBe("now");
    expect(waitStage(SLOW_MS - 1)).toBe("now");
    expect(waitStage(SLOW_MS)).toBe("slow");
    expect(waitStage(STUCK_MS - 1)).toBe("slow");
    expect(waitStage(STUCK_MS)).toBe("stuck");
  });
  it("speaks after a few seconds and gives advice before a minute", () => {
    expect(SLOW_MS).toBeGreaterThanOrEqual(3000);
    expect(SLOW_MS).toBeLessThanOrEqual(6000);
    expect(STUCK_MS).toBeGreaterThan(SLOW_MS);
    expect(STUCK_MS).toBeLessThanOrEqual(45000);
  });
});

describe("createNavLock", () => {
  it("is locked while any holder holds it, and tells listeners when that changes", () => {
    const lock = createNavLock();
    const seen: boolean[] = [];
    lock.subscribe(() => seen.push(lock.locked()));
    expect(lock.locked()).toBe(false);
    const a = lock.hold();
    const b = lock.hold();
    expect(lock.locked()).toBe(true);
    a();
    expect(lock.locked()).toBe(true);
    b();
    expect(lock.locked()).toBe(false);
    expect(seen).toEqual([true, false]);
  });
  it("releasing twice does nothing more", () => {
    const lock = createNavLock();
    const a = lock.hold();
    const b = lock.hold();
    a();
    a();
    expect(lock.locked()).toBe(true);
    b();
    expect(lock.locked()).toBe(false);
  });
});
