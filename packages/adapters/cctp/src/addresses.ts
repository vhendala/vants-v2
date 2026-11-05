// CCTP V2 constants for Stellar testnet → Base Sepolia (ported from the spike, `src/cctp/addresses.ts`).
// Stellar contract ids and domain re-checked against Circle's "Stellar contracts" page on 2026-10-23; the USDC SAC is derived
// from the issuer and checked at runtime (`verifyUsdcSac`), since Circle's testnet table doesn't list it.
import { Asset, Networks } from "@stellar/stellar-sdk";

export const DOMAIN = { base: 6, stellar: 27 } as const;

export const STELLAR_TESTNET = {
  tokenMessengerMinter: "CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP",
  usdcSac: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  usdcIssuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
} as const;

export const BASE_SEPOLIA = {
  chainId: 84532,
  messageTransmitterV2: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
} as const;

/** CCTP V2 minFinalityThreshold. Stellar sources always execute at Standard (measured in the spike). */
export const FINALITY_STANDARD = 2000;

/** The hard-coded USDC SAC must be the one derived from the issuer on testnet (a testnet reset would change it). */
export function verifyUsdcSac(): string {
  const derived = new Asset("USDC", STELLAR_TESTNET.usdcIssuer).contractId(Networks.TESTNET);
  if (derived !== STELLAR_TESTNET.usdcSac) throw new Error(`USDC SAC mismatch: derived ${derived}`);
  return derived;
}
