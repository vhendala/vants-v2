// T-039: reads shared between callers asking for the same thing at the same time, and market data kept for a short while.
import { describe, expect, it } from "vitest";
import { shared } from "./reuse.ts";

const gate = () => {
  let open: () => void = () => {};
  const opened = new Promise<void>((r) => {
    open = r;
  });
  return { open, opened };
};

describe("shared", () => {
  it("runs one call for concurrent callers with the same arguments, and separate calls for different ones", async () => {
    const g = gate();
    let calls = 0;
    const read = shared(async (vault: string, owner: string) => {
      calls++;
      await g.opened;
      return `${vault}/${owner}/${calls}`;
    });
    const a = read("V", "me");
    const b = read("V", "me");
    const c = read("V", "you");
    g.open();
    expect(await a).toBe(await b);
    expect(await c).not.toBe(await a);
    expect(calls).toBe(2);
  });

  it("without a ttl, reads again once the first call has finished: nothing stale is kept", async () => {
    let calls = 0;
    const read = shared(async () => ++calls);
    expect(await read()).toBe(1);
    expect(await read()).toBe(2);
  });

  it("with a ttl, keeps a result that long, then reads again", async () => {
    let t = 1_000;
    let calls = 0;
    const read = shared(async (amount: bigint) => amount + BigInt(++calls), { ttlMs: 15_000, now: () => t });
    expect(await read(10n)).toBe(11n);
    t += 14_999;
    expect(await read(10n)).toBe(11n);
    t += 1;
    expect(await read(10n)).toBe(12n);
  });

  it("shares a failure with the callers waiting on it, but never keeps it", async () => {
    let calls = 0;
    const read = shared(
      async () => {
        calls++;
        if (calls === 1) throw new Error("rpc timeout");
        return "ok";
      },
      { ttlMs: 60_000 },
    );
    const [a, b] = await Promise.allSettled([read(), read()]);
    expect(a.status).toBe("rejected");
    expect(b.status).toBe("rejected");
    expect(await read()).toBe("ok");
    expect(calls).toBe(2);
  });

  it("drops expired results instead of growing without bound", async () => {
    let t = 0;
    const read = shared(async (n: number) => n, { ttlMs: 10, now: () => t, maxEntries: 3 });
    for (const n of [1, 2, 3]) await read(n);
    t = 100;
    for (const n of [4, 5, 6, 7]) await read(n);
    expect(read.size()).toBeLessThanOrEqual(3);
  });
});
