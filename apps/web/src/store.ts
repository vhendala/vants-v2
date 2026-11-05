// T-040 (DEC-057): the portfolio and the investments, kept on the device. A screen shows the last value at once and asks the
// server in the background; every action (a Pix paid, money invested or taken out, Tesouro bought or sold, money added)
// asks again, right away and once more after the ledger has closed. Saved per account, next to the session (DEC-035: the
// same device, the same privacy trade-off), and forgotten on sign-out. Paying and investing never read from here: the
// server checks balances itself when it builds a transaction.
import { useSyncExternalStore } from "react";
import { api } from "./api.ts";
import { loadSession } from "./session.ts";

export interface KeyValue {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
}

export interface Cached<T> {
  data: T | null;
  /** A request to the server is running. */
  refreshing: boolean;
  /** The last request failed: `data` is the last value that arrived. */
  failed: boolean;
}

const PREFIX = "vants.cache.";

/** localStorage, or nothing when it is blocked (private mode): the cache then lasts as long as the tab. */
const deviceStorage: KeyValue = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      // full or blocked: the value still lives in memory
    }
  },
  remove: (k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      // blocked
    }
  },
  keys: () => {
    try {
      return Object.keys(localStorage);
    } catch {
      return [];
    }
  },
};

export function createCache<T>(
  name: string,
  fetcher: () => Promise<T>,
  opts: { kv?: KeyValue; account?: () => string | null } = {},
) {
  const kv = opts.kv ?? deviceStorage;
  const accountOf = opts.account ?? (() => loadSession()?.account ?? null);
  const listeners = new Set<() => void>();
  /** One snapshot per account, so useSyncExternalStore sees a stable object between changes. */
  const snapshots = new Map<string, Cached<T>>();
  const inflight = new Map<string, Promise<void>>();
  const EMPTY: Cached<T> = { data: null, refreshing: false, failed: false };

  const keyOf = (account: string) => `${PREFIX}${name}.${account}`;
  const emit = () => {
    for (const l of listeners) l();
  };
  const update = (account: string, patch: Partial<Cached<T>>) => {
    snapshots.set(account, { ...read(account), ...patch });
    emit();
  };

  function read(account = accountOf()): Cached<T> {
    if (!account) return EMPTY;
    const known = snapshots.get(account);
    if (known) return known;
    let data: T | null = null;
    try {
      const raw = kv.get(keyOf(account));
      data = raw ? (JSON.parse(raw) as T) : null;
    } catch {
      data = null; // a corrupt entry is just a miss
    }
    const first = { data, refreshing: false, failed: false };
    snapshots.set(account, first);
    return first;
  }

  /** Ask the server; screens refreshing together share one request. Resolves when it has landed (or failed). */
  function refresh(): Promise<void> {
    const account = accountOf();
    if (!account) return Promise.resolve();
    const running = inflight.get(account);
    if (running) return running;
    update(account, { refreshing: true });
    const p = fetcher()
      .then(
        (data) => {
          // Signed out or switched accounts meanwhile: this answer belongs to nobody on screen.
          if (accountOf() !== account) return update(account, { refreshing: false });
          kv.set(keyOf(account), JSON.stringify(data));
          update(account, { data, refreshing: false, failed: false });
        },
        () => {
          update(account, { refreshing: false, failed: accountOf() === account });
        },
      )
      .finally(() => inflight.delete(account));
    inflight.set(account, p);
    return p;
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  /** Forget every saved value of every cache (sign-out). */
  function clearAll() {
    for (const k of kv.keys()) if (k.startsWith(PREFIX)) kv.remove(k);
    snapshots.clear();
    emit();
  }

  return { read: () => read(), refresh, subscribe, clearAll };
}

export const portfolioCache = createCache("portfolio", () => api.portfolio());
export const investCache = createCache("invest", () => api.invest());

/** A screen's cached value, kept current; it refreshes in the background when the screen opens. */
export function useCached<T>(cache: ReturnType<typeof createCache<T>>): Cached<T> {
  return useSyncExternalStore(cache.subscribe, cache.read, cache.read);
}

/** Ask for both again: now, and once more after the next ledger (about 5 s) so a just-landed transaction shows. */
export function afterAction() {
  const both = () => Promise.all([portfolioCache.refresh(), investCache.refresh()]);
  void both();
  setTimeout(() => void both(), 6_000);
}

/** Sign-out: nothing of this account stays on the device. */
export const clearCaches = () => {
  portfolioCache.clearAll();
  investCache.clearAll();
};
