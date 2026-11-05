// @vants/adapter-cctp: CCTP V2 Stellar testnet → Base Sepolia refill: burn, attest, mint (SPEC §3.7, T-016). Worker only.
export { BASE_SEPOLIA, DOMAIN, FINALITY_STANDARD, STELLAR_TESTNET, verifyUsdcSac } from "./addresses.ts";
export { BaseMinter } from "./base.ts";
export { type Attested, Iris } from "./iris.ts";
export { type Envelope, StellarCctp } from "./stellar.ts";
export { computeMaxFee6, evmAddressToBytes32, nonceFromMessage, stellarToCctp } from "./units.ts";
