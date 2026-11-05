import { describe, expect, it } from "vitest";
import type { Position } from "./api.ts";
import { unyieldFirst } from "./unyield.ts";

const XLMV = "CD72HOSTSKA2KA4RMVOKVARM7SXBJ7IV54NCPJEEY4ZWOXOQPVFC5SIJ";
const invested: Position = {
  id: `defindex:${XLMV}`,
  kind: "defindex",
  asset: "native",
  vault: XLMV,
  shares: "100",
  amount: "100", // lumens
  valueUsd: "25.00", // 1 lumen ≈ US$ 0,25 at the market
  payableUsd: "24.25",
  unyield: true,
  pricing: "estimated",
  payable: true,
  exit: { steps: 3, slippageBps: 100, estimated: true },
};
const blend = "classic:USDC:GATALT";

describe("lumens out first (T-026)", () => {
  it("takes out the lumens the share needs at the market price, plus 3%, and pays that share from the wallet", () => {
    const u = unyieldFirst(
      [
        { id: invested.id, amount: "5" },
        { id: blend, amount: "1" },
      ],
      [invested],
    );
    expect(u).toEqual({
      vault: XLMV,
      lumens: "20.6", // US$ 5 ÷ 0,25 = 20 lumens, + 3%
      picks: [
        { id: blend, amount: "1" },
        { id: "classic:native", amount: "5" },
      ],
    });
  });

  it("adds to lumens already picked from the wallet, and never takes out more than is invested", () => {
    const u = unyieldFirst(
      [
        { id: "classic:native", amount: "2" },
        { id: invested.id, amount: "25" },
      ],
      [invested],
    );
    expect(u?.lumens).toBe("100");
    expect(u?.picks).toEqual([{ id: "classic:native", amount: "27" }]);
  });

  it("does nothing when no pick has to come out first", () => {
    expect(unyieldFirst([{ id: blend, amount: "1" }], [invested])).toBeNull();
    const { unyield: _, ...viaRouter } = invested; // the AMM pays near the market: one transaction, nothing out first
    expect(unyieldFirst([{ id: invested.id, amount: "1" }], [viaRouter])).toBeNull();
  });
});
