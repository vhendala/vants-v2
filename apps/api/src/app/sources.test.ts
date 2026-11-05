import { describe, expect, it } from "vitest";
import { parseAmount7 } from "./sources.ts";

describe("parseAmount7", () => {
  it("reads Horizon's 7-decimal strings exactly", () => {
    expect(parseAmount7("12.3456789")).toBe(123_456_789n);
    expect(parseAmount7("705.0000000")).toBe(7_050_000_000n);
    expect(parseAmount7("0.5")).toBe(5_000_000n);
    expect(parseAmount7("10000")).toBe(100_000_000_000n);
  });
});
