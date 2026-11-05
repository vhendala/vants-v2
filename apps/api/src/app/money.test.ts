// T-034: reais → dollars for a Tesouro trade, in integers (the float version came out one stroop short).
import { rateToMicros } from "@vants/domain";
import { describe, expect, it } from "vitest";
import { brlToUsd7 } from "./money.ts";

describe("brlToUsd7", () => {
  it("is the exact dollar amount, rounded down to the stroop", () => {
    expect(brlToUsd7("3.51", "5.4")).toBe(6_500_000n); // float: 6499999
    expect(brlToUsd7("4.05", "5.4")).toBe(7_500_000n); // float: 7499999
    expect(brlToUsd7("10", "5.4")).toBe(18_518_518n);
    expect(brlToUsd7("0.01", "5.4")).toBe(18_518n);
  });

  it("matches cents × 10¹¹ ÷ rate for every cent up to R$ 2.000 at three rates", () => {
    for (const rate of ["5.4", "5.12", "4.987654"]) {
      const micros = rateToMicros(rate);
      for (let c = 1; c <= 200_000; c++) {
        const brl = `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
        if (brlToUsd7(brl, rate) !== (BigInt(c) * 10n ** 11n) / micros) throw new Error(`${brl} @ ${rate}`);
      }
    }
  });
});
