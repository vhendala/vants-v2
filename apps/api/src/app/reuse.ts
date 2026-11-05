// T-039 (DEC-056): reads shared between callers. Callers asking for the same thing while a read is in flight wait on that
// one read instead of starting their own. With `ttlMs`, a successful result is also kept that long: only for market data
// that is an estimate anyway (quotes, yields). Failures are shared with whoever was waiting, never kept.

export interface Shared<A extends unknown[], R> {
  (...args: A): Promise<R>;
  /** Kept results plus reads in flight (for tests). */
  size(): number;
}

export function shared<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  opts: { ttlMs?: number; maxEntries?: number; now?: () => number; key?: (...args: A) => string } = {},
): Shared<A, R> {
  const inflight = new Map<string, Promise<R>>();
  const kept = new Map<string, { value: R; until: number }>();
  const now = opts.now ?? Date.now;
  const maxEntries = opts.maxEntries ?? 1_000;
  const keyOf = opts.key ?? ((...args: A) => args.map(String).join("|"));

  const keep = (k: string, value: R) => {
    const t = now();
    if (kept.size >= maxEntries) {
      for (const [key, e] of kept) if (e.until <= t) kept.delete(key);
      // Still full of live entries: drop the oldest (Map keeps insertion order).
      while (kept.size >= maxEntries) {
        const oldest = kept.keys().next().value;
        if (oldest === undefined) break;
        kept.delete(oldest);
      }
    }
    kept.set(k, { value, until: t + (opts.ttlMs ?? 0) });
  };

  const call = (...args: A): Promise<R> => {
    const k = keyOf(...args);
    const hit = kept.get(k);
    if (hit) {
      if (hit.until > now()) return Promise.resolve(hit.value);
      kept.delete(k);
    }
    const running = inflight.get(k);
    if (running) return running;
    const p = fn(...args)
      .then((value) => {
        if (opts.ttlMs) keep(k, value);
        return value;
      })
      .finally(() => inflight.delete(k));
    inflight.set(k, p);
    return p;
  };
  return Object.assign(call, { size: () => kept.size + inflight.size });
}
