// How much of the payment comes from each position (T-023). The user works in reais, to the centavo; the API takes amounts
// in the quote asset (7 decimals). Amounts convert at the quote's own ratio (asset total ÷ reais total), so a position's
// ceiling in reais never converts back to more than it holds, and a covered payment sums to the asset total exactly.

export interface Source {
  id: string;
  /** The stablecoin it pays in, or null for XLM (swapped into whatever the payment is in). */
  currency: string | null;
  /** The most it can give, in the quote asset (7 decimals). */
  available7: bigint;
  /** Money invested in a vault: the router takes from ONE vault per payment (T-026). */
  vault?: boolean;
  /**
   * Sold on the order book (Tesouro, T-029): only a classic transaction reaches the book, and a vault pays only through the
   * router, so the two never share a payment.
   */
  orderBook?: boolean;
}

/** Two sources that need different kinds of transaction: one through the router (a vault), one on the order book. */
export const routesClash = (a: Source, b: Source): boolean =>
  Boolean((a.vault && b.orderBook) || (a.orderBook && b.vault));

export interface Slice {
  id: string;
  cents: number;
}

export interface Bill {
  /** What the payment costs in reais, fee included, in centavos. */
  totalCents: number;
  /** The same in the quote asset (7 decimals). */
  total7: bigint;
}

/** A position's ceiling in centavos at the quote's ratio (rounded down, so it never exceeds what it holds). */
export const maxCents = (s: Source, bill: Bill): number =>
  bill.total7 === 0n ? 0 : Number((s.available7 * BigInt(bill.totalCents)) / bill.total7);

export const covered = (slices: Slice[]): number => slices.reduce((sum, s) => sum + s.cents, 0);

/** The currency the payment ends up in: the first chosen position that isn't XLM. */
export function currencyOf(slices: Slice[], sources: Source[]): string | null {
  for (const sl of slices) {
    const c = sources.find((s) => s.id === sl.id)?.currency;
    if (c) return c;
  }
  return null;
}

/**
 * Can this position join the ones chosen? XLM goes with anything; stablecoins only with the same stablecoin; only one
 * vault per payment (the router withdraws from one); and a vault never with Tesouro (router vs order book, T-029).
 */
export function compatible(source: Source, slices: Slice[], sources: Source[]): boolean {
  const current = currencyOf(slices, sources);
  const sameMoney = source.currency === null || current === null || current === source.currency;
  const chosen = slices.filter((s) => s.id !== source.id).flatMap((s) => sources.filter((x) => x.id === s.id));
  const otherVault = source.vault && chosen.some((x) => x.vault);
  return sameMoney && !otherVault && !chosen.some((x) => routesClash(source, x));
}

/** The most this position can be set to now: its ceiling, or what's left of the bill plus its own share. */
export function room(id: string, slices: Slice[], sources: Source[], bill: Bill): number {
  const source = sources.find((s) => s.id === id);
  if (!source) return 0;
  const own = slices.find((s) => s.id === id)?.cents ?? 0;
  return Math.max(0, Math.min(maxCents(source, bill), bill.totalCents - covered(slices) + own));
}

/** Adds a position, filling as much of what's left as it can. */
export function add(id: string, slices: Slice[], sources: Source[], bill: Bill): Slice[] {
  if (slices.some((s) => s.id === id)) return slices;
  return [...slices, { id, cents: room(id, slices, sources, bill) }];
}

export const remove = (id: string, slices: Slice[]): Slice[] => slices.filter((s) => s.id !== id);

/**
 * "Usar" (T-026): with room left, the source fills what's missing; when the bill is already covered, it goes first and
 * takes what it can, and the others keep their order and shrink to fit (one that's left with nothing leaves the mix).
 */
export function chooseSource(id: string, slices: Slice[], sources: Source[], bill: Bill): Slice[] {
  if (covered(slices) < bill.totalCents) return add(id, slices, sources, bill);
  let out = add(id, [], sources, bill);
  for (const s of slices) {
    if (s.id === id) continue;
    out = [...out, { id: s.id, cents: 0 }];
    out = set(s.id, s.cents, out, sources, bill);
  }
  return out.filter((s) => s.cents > 0);
}

/** Sets a position's share, clamped to [0, room]. */
export function set(id: string, cents: number, slices: Slice[], sources: Source[], bill: Bill): Slice[] {
  const clamped = Math.max(0, Math.min(Math.round(cents), room(id, slices, sources, bill)));
  return slices.map((s) => (s.id === id ? { ...s, cents: clamped } : s));
}

/**
 * Drags divider `i` (the right edge of share `i`) to `at` centavos from the start of the bar (T-026). Between two shares it
 * moves money from one to the other, never past either one's ceiling or below zero; the last divider grows or shrinks the
 * last share against what's left of the bill.
 */
export function setDivider(i: number, at: number, slices: Slice[], sources: Source[], bill: Bill): Slice[] {
  const here = slices[i];
  if (!here) return slices;
  const left = covered(slices.slice(0, i));
  const ceil = (id: string) => {
    const s = sources.find((x) => x.id === id);
    return s ? maxCents(s, bill) : 0;
  };
  const next = slices[i + 1];
  if (!next) return set(here.id, at - left, slices, sources, bill);
  const pair = here.cents + next.cents;
  const cents = Math.max(Math.max(0, pair - ceil(next.id)), Math.min(Math.round(at - left), ceil(here.id), pair));
  return slices.map((s, k) => (k === i ? { ...s, cents } : k === i + 1 ? { ...s, cents: pair - cents } : s));
}

/** What a position is to the person: a dollar balance, lumens, or money that earns (T-026 suggestions). */
export interface Candidate extends Source {
  role: "dollar" | "lumens" | "earning";
}

/**
 * One-tap splits (T-026). "keep-earning": dollars first, then lumens, the investment only if needed; "simplest": as few
 * sources as possible; "even": the same from each source that can pay together, capped by each one's ceiling. Only
 * positions that can share one payment are combined (one dollar issuer, plus lumens), and the group that covers most wins.
 */
export function suggest(strategy: "keep-earning" | "simplest" | "even", candidates: Candidate[], bill: Bill): Slice[] {
  const issuers = [...new Set(candidates.map((c) => c.currency).filter((c): c is string => c !== null))];
  // Groups that can pay together: one dollar issuer plus lumens, and at most one vault (each vault, or none, is a variant).
  const groups = (issuers.length ? issuers : [null]).flatMap((cur) => {
    const group = candidates.filter((c) => c.currency === null || c.currency === cur);
    const vaults = group.filter((c) => c.vault);
    return [
      group.filter((c) => !c.vault),
      // With a vault, nothing sold on the order book (T-029).
      ...vaults.map((v) => group.filter((c) => (!c.vault && !c.orderBook) || c.id === v.id)),
    ].filter((g) => g.length > 0);
  });
  const rank = { dollar: 0, lumens: 1, earning: 2 } as const;
  const ceiling = (c: Candidate) => maxCents(c, bill);
  const fill = (order: Candidate[]) =>
    order.reduce<Slice[]>((acc, c) => (covered(acc) < bill.totalCents ? add(c.id, acc, candidates, bill) : acc), []);

  const plans = groups.map((group) => {
    if (strategy === "even")
      return even(
        group.filter((c) => ceiling(c) > 0),
        bill,
      );
    if (strategy === "simplest") {
      const one = [...group]
        .filter((c) => ceiling(c) >= bill.totalCents)
        .sort((a, b) => rank[a.role] - rank[b.role])[0];
      return one ? fill([one]) : fill([...group].sort((a, b) => ceiling(b) - ceiling(a)));
    }
    return fill([...group].sort((a, b) => rank[a.role] - rank[b.role] || ceiling(b) - ceiling(a)));
  });
  const roleOf = (id: string) => candidates.find((c) => c.id === id)?.role ?? "dollar";
  const used = (p: Slice[], role: Candidate["role"]) =>
    p.filter((s) => roleOf(s.id) === role).reduce((n, s) => n + s.cents, 0);
  const score = (p: Slice[]): number[] =>
    strategy === "even"
      ? [-covered(p), -p.length]
      : strategy === "simplest"
        ? [-covered(p), p.length, used(p, "earning")]
        : [-covered(p), used(p, "earning"), used(p, "lumens"), p.length];
  const best = plans.reduce<Slice[] | null>((a, p) => {
    if (!a) return p;
    const [x, y] = [score(p), score(a)];
    const k = x.findIndex((v, j) => v !== y[j]);
    return k >= 0 && (x[k] ?? 0) < (y[k] ?? 0) ? p : a;
  }, null);
  return (best ?? []).filter((s) => s.cents > 0);
}

/**
 * "Completar" (T-026): what's missing comes first from the sources already chosen (each up to its room), then from the next
 * source that can join; in both, dollars before lumens before the investment (what earns is used last).
 */
export function complete(slices: Slice[], candidates: Candidate[], bill: Bill): Slice[] {
  const rank = { dollar: 0, lumens: 1, earning: 2 } as const;
  const roleOf = (id: string) => candidates.find((c) => c.id === id)?.role ?? "dollar";
  let out = slices;
  for (const s of [...slices].sort((a, b) => rank[roleOf(a.id)] - rank[roleOf(b.id)]))
    out = set(s.id, room(s.id, out, candidates, bill), out, candidates, bill);
  const next = candidates
    .filter((c) => !out.some((s) => s.id === c.id))
    .sort((a, b) => rank[a.role] - rank[b.role] || maxCents(b, bill) - maxCents(a, bill));
  for (const c of next) {
    if (covered(out) >= bill.totalCents) break;
    if (compatible(c, out, candidates)) out = add(c.id, out, candidates, bill);
  }
  return out.filter((s) => s.cents > 0);
}

/** Equal shares, water-filled: a source that can't give its share gives all it has and the rest is shared again. */
function even(group: Candidate[], bill: Bill): Slice[] {
  const cents = new Map<string, number>();
  let open = [...group];
  let left = bill.totalCents;
  while (open.length && left > 0) {
    const share = Math.floor(left / open.length);
    const capped = open.filter((c) => maxCents(c, bill) - (cents.get(c.id) ?? 0) <= share);
    if (capped.length === 0) {
      open.forEach((c, k) => {
        cents.set(c.id, (cents.get(c.id) ?? 0) + share + (k < left - share * open.length ? 1 : 0));
      });
      left = 0;
      break;
    }
    for (const c of capped) {
      const give = maxCents(c, bill) - (cents.get(c.id) ?? 0);
      cents.set(c.id, (cents.get(c.id) ?? 0) + give);
      left -= give;
    }
    open = open.filter((c) => !capped.includes(c));
  }
  return group.filter((c) => cents.has(c.id)).map((c) => ({ id: c.id, cents: cents.get(c.id) ?? 0 }));
}

/** The picks for `POST /app/exits`: positions with a share, each amount in the quote asset. */
export function toPicks(slices: Slice[], sources: Source[], bill: Bill): { id: string; amount: string }[] {
  const chosen = slices.filter((s) => s.cents > 0);
  const amounts = chosen.map((s) => (BigInt(s.cents) * bill.total7) / BigInt(bill.totalCents));
  if (covered(chosen) === bill.totalCents) {
    // Rounding down leaves a few units over: give them to a position with room for them.
    let rest = bill.total7 - amounts.reduce((a, b) => a + b, 0n);
    for (let i = 0; i < chosen.length && rest > 0n; i++) {
      const headroom = (sources.find((s) => s.id === chosen[i]?.id)?.available7 ?? 0n) - (amounts[i] ?? 0n);
      const give = minOf(headroom, rest);
      if (give > 0n) {
        amounts[i] = (amounts[i] ?? 0n) + give;
        rest -= give;
      }
    }
  }
  return chosen.map((s, i) => ({ id: s.id, amount: format7(amounts[i] ?? 0n) }));
}

const minOf = (a: bigint, b: bigint) => (a < b ? a : b);

/** 7-decimal units → "12.3456789" (trailing zeros trimmed). */
export function format7(v: bigint): string {
  const whole = v / 10_000_000n;
  const frac = (v % 10_000_000n).toString().padStart(7, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** "12.3456789" → 7-decimal units. */
export function parse7(s: string): bigint {
  const [w = "0", f = ""] = s.split(".");
  return BigInt(w) * 10_000_000n + BigInt(f.padEnd(7, "0").slice(0, 7));
}
