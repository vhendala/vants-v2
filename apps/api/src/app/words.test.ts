import { describe, expect, it } from "vitest";
import { inWords } from "./words.ts";

describe("summary words (T-026)", () => {
  it("names amounts as people do, exactly to the 7th place", () => {
    expect(inWords(125_000_000n, "USDC")).toBe("12,5 dólares digitais");
    expect(inWords(10_000_000n, "USDC")).toBe("1 dólar digital");
    expect(inWords(10_000_000n, "XLM")).toBe("1 lumen");
    expect(inWords(701_234_567n, "native")).toBe("70,1234567 lumens");
    expect(inWords(30_000_000n, "TESOURO")).toBe("3 unidades de Tesouro");
    expect(inWords(30_000_000n, "CETES")).toBe("3 CETES");
  });
});
