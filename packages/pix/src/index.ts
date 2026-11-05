// @vants/pix: BR Code (Pix QR) parser and validator: CRC16, TLV, amount (SPEC §3.2, INV-05).
export {
  type BrCodeError,
  type BrCodeErrorCode,
  buildStaticBrCode,
  crc16ccitt,
  formatAmountCents,
  type ParsedBrCode,
  type ParseResult,
  parseAmountToCents,
  parseBrCode,
  PIX_GUI,
  type StaticBrCodeInput,
  sanitizeEmvText,
  type Tlv,
  uniqueStaticCode,
  withFixedCrc,
} from "./emv.ts";
export { type BrCodeCheck, checkBrCodeForPayout } from "./guard.ts";
export { detectPixKeyType, maskPixKey, normalizePixKey, PIX_KEY_LABEL, type PixKeyType } from "./key.ts";
