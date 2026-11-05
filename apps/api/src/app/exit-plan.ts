// The exit planner (SPEC §3.5, DEC-031): the user's ordered picks → ONE transaction, or a refusal that says why. The earlier prototype
// rules: the charge is priced first (the quote), picks are used in the user's order until the amount is covered, the exact
// amount leaves in one final transfer to the payment's M… address, and a shortfall builds nothing.
//   classic route  the quote asset's balance, plus XLM or TESOURO (T-029) sold for it on the order book
//                  (pathPaymentStrictReceive to self), then one payment
//   router route   DeFindex shares withdrawn (exact amount, shares rounded up), XLM swapped to the quote asset on a Soroban AMM
//                  (DEC-034: a contract call can't reach the classic order book), plus the quote asset's balance, in one router call.
//                  Lumens invested in the XLM vault (T-026) come out as lumens and join the ONE swap; how many lumens to take out
//                  depends on the AMM's price at build time, so the builder sizes that withdrawal (the plan says what it buys).
import { sharesForUnderlying, type VaultState } from "@vants/adapter-defindex";
import type { Position } from "./portfolio.ts";
import { parseAmount7 } from "./sources.ts";

/** Slippage allowed on a swap leg (XLM, or TESOURO on the order book). */
export const XLM_SLIPPAGE_BPS = 100;

/**
 * An asset sold into the quote asset: `receive7` exactly, from at most `spendable7` of it (the builder prices the swap).
 * XLM on either route; any other asset (TESOURO, T-029) on the classic route only, where the order book is.
 */
export interface XlmSwap {
  /** "native" or "CODE:ISSUER". */
  from: string;
  receive7: bigint;
  slippageBps: number;
  spendable7: bigint;
}

/** A position to pay from, optionally with how much of the quote asset (7 decimals) to take from it (T-023). */
export type ExitPick = string | { id: string; amount7?: bigint };

/** A vault withdrawal: an exact amount of the quote asset (a dollar vault), or lumens for part of the swap (the XLM vault). */
export type VaultWithdraw =
  | { vault: string; shares7: bigint; minOut7: bigint }
  | {
      vault: string;
      /** What these lumens must buy in the quote asset: the builder withdraws exactly the lumens the AMM asks for it. */
      lumensFor7: bigint;
      heldShares7: bigint;
      state: Pick<VaultState, "totalSupply" | "totalAmount">;
    };

export type ExitPlan =
  | {
      ok: true;
      route: "classic";
      amount7: bigint;
      fromBalance7: bigint;
      swaps: XlmSwap[];
    }
  | {
      ok: true;
      route: "router";
      amount7: bigint;
      withdraw: VaultWithdraw | null;
      fromBalance7: bigint;
      swap: XlmSwap | null;
    }
  | {
      ok: false;
      reason:
        | "shortfall"
        | "mixed_routes"
        | "wrong_asset"
        | "unpayable"
        | "unknown_position"
        | "over_position"
        | "unyield_first";
      detail: string;
      covered7?: bigint;
    };

export function planExit(
  quote: { asset: string; amount7: bigint },
  picks: ExitPick[],
  positions: Position[],
  vaults: ReadonlyMap<string, Pick<VaultState, "totalSupply" | "totalAmount">>,
): ExitPlan {
  let remaining = quote.amount7;
  let fromBalance7 = 0n;
  let withdraw: VaultWithdraw | null = null;
  const swaps: XlmSwap[] = [];
  // Lumens invested: what they buy, and how many there are (they join the router's one swap).
  let vaultLumens: { receive7: bigint; spendable7: bigint } | null = null;

  for (const pick of picks) {
    if (remaining === 0n) break; // covered: later picks are left alone
    const { id, amount7: chosen } = typeof pick === "string" ? { id: pick, amount7: undefined } : pick;
    const p = positions.find((x) => x.id === id);
    if (!p) return { ok: false, reason: "unknown_position", detail: `no position ${id} in this portfolio` };
    if (!p.payable)
      return { ok: false, reason: "unpayable", detail: `${id} has no price Vants can pay from (${p.pricing})` };
    // What the position can give, in the quote asset: its balance, or what selling it is estimated to give (XLM, TESOURO).
    // (Lumens invested can only be swapped on the AMM: what they can pay there, T-026.)
    const sold = p.pricing === "estimated";
    const available = parseAmount7((sold ? (p.payableUsd ?? p.valueUsd) : p.amount) ?? "0");
    if (chosen !== undefined && (chosen <= 0n || chosen > available))
      return {
        ok: false,
        reason: "over_position",
        detail: `${id}: ${chosen} chosen, but it can give between 1 and ${available}`,
      };
    const cap = min(remaining, chosen ?? available);

    if (p.kind === "defindex" && p.asset === "native") {
      if (p.unyield)
        return {
          ok: false,
          reason: "unyield_first",
          detail: `${id}: the AMM pays well below the market; take the lumens out first, then pay from the wallet`,
        };
      if (withdraw) return { ok: false, reason: "mixed_routes", detail: "one vault per payment" };
      const state = p.vault ? vaults.get(p.vault) : undefined;
      if (!p.vault || !state) return { ok: false, reason: "unknown_position", detail: `no state for vault ${p.vault}` };
      withdraw = { vault: p.vault, lumensFor7: cap, heldShares7: parseAmount7(p.shares ?? "0"), state };
      vaultLumens = { receive7: cap, spendable7: parseAmount7(p.amount) };
      remaining -= cap;
    } else if (p.kind === "defindex") {
      if (p.asset !== quote.asset)
        return { ok: false, reason: "wrong_asset", detail: `${id} pays out ${p.asset}, not ${quote.asset}` };
      if (withdraw) return { ok: false, reason: "mixed_routes", detail: "one vault per payment" };
      const state = p.vault ? vaults.get(p.vault) : undefined;
      if (!p.vault || !state) return { ok: false, reason: "unknown_position", detail: `no state for vault ${p.vault}` };
      const take = cap;
      withdraw = { vault: p.vault, shares7: sharesForUnderlying(take, state), minOut7: take };
      remaining -= take;
    } else if (sold) {
      // XLM or TESOURO is worth its estimated value in the quote asset; the transaction builder re-quotes the exact swap.
      const take = cap;
      swaps.push({ from: p.asset, receive7: take, slippageBps: XLM_SLIPPAGE_BPS, spendable7: parseAmount7(p.amount) });
      remaining -= take;
    } else {
      if (p.asset !== quote.asset)
        return { ok: false, reason: "wrong_asset", detail: `${id} is ${p.asset}, not ${quote.asset}` };
      const take = cap;
      fromBalance7 += take;
      remaining -= take;
    }
  }

  if (remaining > 0n) {
    return {
      ok: false,
      reason: "shortfall",
      detail: `the picks cover ${quote.amount7 - remaining} of ${quote.amount7}`,
      covered7: quote.amount7 - remaining,
    };
  }
  if (!withdraw) return { ok: true, route: "classic", amount7: quote.amount7, fromBalance7, swaps };
  // The router swaps lumens on a Soroban AMM; anything else sells on the order book, which a contract call can't reach.
  const offBook = swaps.find((s) => s.from !== "native");
  if (offBook)
    return {
      ok: false,
      reason: "mixed_routes",
      detail: `${offBook.from} sells on the order book; money invested pays through the router: not in one transaction`,
    };
  // The router makes ONE swap: lumens from the wallet and lumens taken out of the vault buy the quote asset together.
  const lumens = [
    ...swaps,
    ...(vaultLumens ? [{ ...vaultLumens, from: "native" as const, slippageBps: XLM_SLIPPAGE_BPS }] : []),
  ];
  const swap: XlmSwap | null = lumens.length
    ? {
        from: "native",
        receive7: lumens.reduce((n, l) => n + l.receive7, 0n),
        slippageBps: XLM_SLIPPAGE_BPS,
        spendable7: lumens.reduce((n, l) => n + l.spendable7, 0n),
      }
    : null;
  return { ok: true, route: "router", amount7: quote.amount7, withdraw, fromBalance7, swap };
}

const min = (a: bigint, b: bigint) => (a < b ? a : b);
