// USDC precision across CCTP (ported from the spike, `src/cctp/decimals.ts` and `stellarToBase.ts`): Stellar uses 7
// decimals, CCTP messages and Base use 6. All bigint.

/** The burn debits only through the 6th decimal: the 7th digit stays on Stellar. */
export function stellarToCctp(amount7: bigint): { amount6: bigint; burned7: bigint; dust7: bigint } {
  if (amount7 < 0n) throw new Error("amount must be non-negative");
  const amount6 = amount7 / 10n;
  return { amount6, burned7: amount6 * 10n, dust7: amount7 % 10n };
}

/** 20-byte EVM address → the 32-byte left-padded CCTP `mint_recipient`. */
export function evmAddressToBytes32(address: string): Buffer {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error(`invalid EVM address "${address}"`);
  const out = Buffer.alloc(32);
  Buffer.from(address.slice(2), "hex").copy(out, 12);
  return out;
}

/** CCTP V2 header: version(4) | srcDomain(4) | dstDomain(4) | nonce(32) | …: the nonce is bytes 12..44. */
export function nonceFromMessage(message: `0x${string}`): `0x${string}` {
  const bytes = Buffer.from(message.slice(2), "hex");
  if (bytes.length < 44) throw new Error("CCTP message too short");
  return `0x${bytes.subarray(12, 44).toString("hex")}`;
}

/** Iris' fee schedule is in basis points; allow 50% headroom, rounded up, in integer math. */
export function computeMaxFee6(amount6: bigint, bps: number | undefined): bigint {
  if (!bps || bps <= 0) return 0n;
  const microBps = BigInt(Math.ceil(bps * 1.5 * 1_000_000));
  const denom = 10_000n * 1_000_000n;
  return (amount6 * microBps + denom - 1n) / denom;
}
