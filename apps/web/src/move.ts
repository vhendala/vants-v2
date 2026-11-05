// T-041: putting money into an investment or taking it out, as a flow like a Pix (amount → review → done). The pieces here
// are the ones with arithmetic in them; the screens are in screens/Move.tsx.
import { floorCents } from "./format.ts";

/** Which way the money moves: into the investment, or out of it back to the wallet. */
export type Mode = "in" | "out";

export interface FlowSteps {
  amount: number;
  /** Letting the wallet receive the asset first (Tesouro, the first time), or null. */
  trust: number | null;
  review: number;
  of: number;
}

/** The flow's steps, for the header's progress: amount, (receive the asset), review. */
export function flowSteps(needsTrust: boolean): FlowSteps {
  return needsTrust ? { amount: 1, trust: 2, review: 3, of: 3 } : { amount: 1, trust: null, review: 2, of: 2 };
}

/** A quarter, half and all of what can move (whole cents), without amounts that round to nothing or repeat. */
export function quickAmounts(maxCents: number): { label: string; cents: number }[] {
  const all = [
    { label: "25%", cents: Math.floor(maxCents / 4) },
    { label: "Metade", cents: Math.floor(maxCents / 2) },
    { label: "Tudo", cents: maxCents },
  ];
  return all.filter((q, i) => q.cents > 0 && all.findIndex((x) => x.cents === q.cents) === i);
}

/**
 * What to ask the server for: the exact balance (7 decimals) when the amount typed is all of it, so nothing is left behind
 * (T-034); the typed amount otherwise.
 */
export function sendValue(cents: number, exact: string): { value: string; all: boolean } {
  const all = cents > 0 && cents === floorCents(Number(exact));
  return all ? { value: exact, all } : { value: (cents / 100).toFixed(2), all };
}

/** What a year at today's rate adds to an amount (an estimate: rates change every day), or null when unknown. */
export function yearEarnings(amount: number, apyPercent: number | null): number | null {
  if (apyPercent === null || !(amount > 0)) return null;
  return (amount * apyPercent) / 100;
}
