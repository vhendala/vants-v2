// Ported from the spike's test/cctp.test.ts and test/decimals.test.ts (same author).
import { describe, expect, it } from "vitest";
import { STELLAR_TESTNET, verifyUsdcSac } from "../src/addresses.ts";
import { computeMaxFee6, evmAddressToBytes32, nonceFromMessage, stellarToCctp } from "../src/units.ts";

describe("CCTP units", () => {
  it("derives the configured testnet USDC SAC from the issuer", () => {
    expect(verifyUsdcSac()).toBe(STELLAR_TESTNET.usdcSac);
  });

  it("burns only through the 6th decimal and leaves 7th-digit dust", () => {
    expect(stellarToCctp(10_000_007n)).toEqual({ amount6: 1_000_000n, burned7: 10_000_000n, dust7: 7n });
    expect(stellarToCctp(5_000_000n)).toEqual({ amount6: 500_000n, burned7: 5_000_000n, dust7: 0n });
    expect(() => stellarToCctp(-1n)).toThrow();
  });

  it("left-pads an EVM address to the 32-byte mint recipient", () => {
    const b = evmAddressToBytes32("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
    expect(b.length).toBe(32);
    expect(b.subarray(0, 12).every((x) => x === 0)).toBe(true);
    expect(b.subarray(12).toString("hex")).toBe("036cbd53842c5426634e7929541ec2318f3dcf7e");
    expect(() => evmAddressToBytes32("0x123")).toThrow();
  });

  it("extracts the 32-byte nonce from a V2 message header", () => {
    const nonce = "ab".repeat(32);
    expect(nonceFromMessage(`0x00000001${"0000001b"}${"00000006"}${nonce}${"00".repeat(100)}`)).toBe(`0x${nonce}`);
    expect(() => nonceFromMessage("0x00")).toThrow();
  });

  it("computes the max fee with 50% headroom, rounding up, in integer math", () => {
    expect(computeMaxFee6(1_000_000n, 0)).toBe(0n);
    expect(computeMaxFee6(1_000_000n, 1)).toBe(150n);
    expect(computeMaxFee6(123_456n, 1.3)).toBe(25n);
  });
});
