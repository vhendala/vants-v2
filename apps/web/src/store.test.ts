// T-040: the portfolio and the investments, kept on the device: shown at once, refreshed in the background, and refreshed
// again after every action.
import { describe, expect, it } from "vitest";
import { createCache, type KeyValue } from "./store.ts";

const memory = (): KeyValue & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return {
    map,
    get: (k) => map.get(k) ?? null,
    set: (k, v) => void map.set(k, v),
    remove: (k) => void map.delete(k),
    keys: () => [...map.keys()],
  };
};

const deferred = <T>() => {
  let resolve: (v: T) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("createCache", () => {
  it("shows the last saved value at once, for the same account only", () => {
    const kv = memory();
    const a = createCache("portfolio", async () => ({ total: "1" }), { kv, account: () => "GA" });
    kv.set("vants.cache.portfolio.GA", JSON.stringify({ total: "12.50" }));
    expect(a.read().data).toEqual({ total: "12.50" });
    const b = createCache("portfolio", async () => ({ total: "1" }), { kv, account: () => "GB" });
    expect(b.read().data).toBeNull();
  });

  it("refreshes in the background: the old value stays on screen until the new one arrives, then is saved", async () => {
    const kv = memory();
    kv.set("vants.cache.portfolio.GA", JSON.stringify({ total: "12.50" }));
    const next = deferred<{ total: string }>();
    const c = createCache("portfolio", () => next.promise, { kv, account: () => "GA" });
    const seen: unknown[] = [];
    c.subscribe(() => seen.push(c.read()));
    const done = c.refresh();
    expect(c.read()).toMatchObject({ data: { total: "12.50" }, refreshing: true });
    next.resolve({ total: "20.00" });
    await done;
    expect(c.read()).toMatchObject({ data: { total: "20.00" }, refreshing: false, failed: false });
    expect(JSON.parse(kv.get("vants.cache.portfolio.GA") ?? "null")).toEqual({ total: "20.00" });
    expect(seen.length).toBeGreaterThanOrEqual(2);
  });

  it("asks the server once when several screens refresh at the same time", async () => {
    let calls = 0;
    const next = deferred<number>();
    const c = createCache(
      "invest",
      () => {
        calls++;
        return next.promise;
      },
      { kv: memory(), account: () => "GA" },
    );
    const both = Promise.all([c.refresh(), c.refresh()]);
    next.resolve(7);
    await both;
    expect(calls).toBe(1);
  });

  it("a failed refresh keeps the last value and says so", async () => {
    const kv = memory();
    kv.set("vants.cache.portfolio.GA", JSON.stringify({ total: "12.50" }));
    const c = createCache(
      "portfolio",
      async () => {
        throw new Error("offline");
      },
      { kv, account: () => "GA" },
    );
    await c.refresh();
    expect(c.read()).toMatchObject({ data: { total: "12.50" }, refreshing: false, failed: true });
  });

  it("a refresh that lands after the account changed is dropped", async () => {
    let who = "GA";
    const next = deferred<{ total: string }>();
    const kv = memory();
    const c = createCache("portfolio", () => next.promise, { kv, account: () => who });
    const done = c.refresh();
    who = "GB";
    next.resolve({ total: "99.00" });
    await done;
    expect(c.read().data).toBeNull();
    expect(kv.get("vants.cache.portfolio.GA")).toBeNull();
  });

  it("clear forgets every saved value (sign-out)", () => {
    const kv = memory();
    kv.set("vants.cache.portfolio.GA", "{}");
    kv.set("vants.cache.invest.GA", "{}");
    kv.set("vants.session", "keep");
    const c = createCache("portfolio", async () => ({}), { kv, account: () => "GA" });
    c.clearAll();
    expect(kv.keys()).toEqual(["vants.session"]);
    expect(c.read().data).toBeNull();
  });
});
