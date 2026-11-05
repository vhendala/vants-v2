// T-041: investing and taking out as a flow, like a Pix: its steps, the quick amounts, "Tudo" sending the exact balance, and
// the one-year estimate on the review.
import { describe, expect, it } from "vitest";
import { flowSteps, quickAmounts, sendValue, yearEarnings } from "./move.ts";

describe("flowSteps", () => {
  it("is amount then review", () => {
    expect(flowSteps(false)).toEqual({ amount: 1, trust: null, review: 2, of: 2 });
  });
  it("puts letting the wallet receive the asset between the amount and the review", () => {
    expect(flowSteps(true)).toEqual({ amount: 1, trust: 2, review: 3, of: 3 });
  });
});

describe("quickAmounts", () => {
  it("offers a quarter, half and all of what can move, in whole cents", () => {
    expect(quickAmounts(2000)).toEqual([
      { label: "25%", cents: 500 },
      { label: "Metade", cents: 1000 },
      { label: "Tudo", cents: 2000 },
    ]);
    expect(quickAmounts(9629)).toEqual([
      { label: "25%", cents: 2407 },
      { label: "Metade", cents: 4814 },
      { label: "Tudo", cents: 9629 },
    ]);
  });
  it("drops amounts that round to nothing or repeat", () => {
    expect(quickAmounts(3)).toEqual([
      { label: "Metade", cents: 1 },
      { label: "Tudo", cents: 3 },
    ]);
    expect(quickAmounts(1)).toEqual([{ label: "Tudo", cents: 1 }]);
  });
  it("offers nothing when nothing can move", () => {
    expect(quickAmounts(0)).toEqual([]);
  });
});

describe("sendValue", () => {
  it("sends the exact balance (7 decimals) when the amount is all of it, so nothing is left behind", () => {
    expect(sendValue(9629, "96.2962962")).toEqual({ value: "96.2962962", all: true });
  });
  it("sends the typed amount otherwise", () => {
    expect(sendValue(1250, "96.2962962")).toEqual({ value: "12.50", all: false });
  });
});

describe("yearEarnings", () => {
  it("is what a year at today's rate adds", () => {
    expect(yearEarnings(100, 8)).toBeCloseTo(8);
    expect(yearEarnings(12.5, 10.66)).toBeCloseTo(1.3325);
  });
  it("is unknown without a rate or an amount", () => {
    expect(yearEarnings(100, null)).toBeNull();
    expect(yearEarnings(0, 8)).toBeNull();
  });
});
