// T-034: the amount helpers people's money passes through.
import { describe, expect, it } from "vitest";
import { floorCents, parseReais } from "./format.ts";

describe("parseReais", () => {
  it("reads pt-BR amounts, and a trailing dot with one or two digits as the decimal point", () => {
    expect(parseReais("1.234,56")).toBe(123456);
    expect(parseReais("12,5")).toBe(1250);
    expect(parseReais("12.50")).toBe(1250); // decimal keypads that only offer "."
    expect(parseReais("12.5")).toBe(1250);
    expect(parseReais("1.250")).toBe(125000); // thousands, not R$ 1,25
    expect(parseReais("1.234.567")).toBe(123456700);
    expect(parseReais("R$ 0,29")).toBe(29);
    expect(parseReais("")).toBe(0);
  });
});

describe("floorCents", () => {
  it("rounds down to whole cents without float error", () => {
    expect(Math.floor(19.99 * 100)).toBe(1998); // the bug it replaces
    expect(floorCents(19.99)).toBe(1999);
    expect(floorCents(12.3456789)).toBe(1234);
    for (let c = 1; c < 10000; c++) expect(floorCents(Number((c / 100).toFixed(2)))).toBe(c);
  });
});
