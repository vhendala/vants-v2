// Lumens invested that come out of the vault before paying (T-026, DEC-043). When the AMM a single transaction could swap on
// pays well below the market, the API marks the position `unyield`: the app takes just enough lumens out first (one
// confirmation), then pays the same share from the wallet's lumens through the order book (another).
import { format7, parse7 } from "./allocation.ts";
import type { Pick, Position } from "./api.ts";

/** Extra lumens taken out over the estimate: the order book's slippage allowance (1%) and the price moving meanwhile. */
const MARGIN_BPS = 300n;

/** The smaller of two bigints (Math.min takes numbers only). */
const lesser = (a: bigint, b: bigint) => (a < b ? a : b);

export interface Unyield {
  vault: string;
  /** Lumens to take out of the vault (7 decimals, "12.3456789"). */
  lumens: string;
  /** The same split, with the vault's share paid from the wallet's lumens. */
  picks: Pick[];
}

export function unyieldFirst(picks: Pick[], positions: Position[]): Unyield | null {
  const pick = picks.find((p) => positions.find((x) => x.id === p.id)?.unyield);
  const position = pick && positions.find((x) => x.id === pick.id);
  if (!pick || !position?.vault || !position.valueUsd) return null;
  // The share in dollars → lumens at the market's price (the position's own worth), plus the margin, never more than invested.
  const share7 = parse7(pick.amount);
  const held7 = parse7(position.amount);
  const worth7 = parse7(position.valueUsd);
  if (worth7 === 0n) return null;
  const estimate7 = (share7 * held7 + worth7 - 1n) / worth7;
  const withMargin7 = estimate7 + (estimate7 * MARGIN_BPS + 9_999n) / 10_000n;
  const lumens7 = lesser(withMargin7, held7);
  // The wallet's lumens pay that share (with any share the person already took from them).
  const wallet = picks.find((p) => p.id === "classic:native");
  const rest = picks.filter((p) => p.id !== pick.id && p.id !== "classic:native");
  const walletShare7 = share7 + (wallet ? parse7(wallet.amount) : 0n);
  return {
    vault: position.vault,
    lumens: format7(lumens7),
    picks: [...rest, { id: "classic:native", amount: format7(walletShare7) }],
  };
}
