// The words a person reads in a transaction's summary (T-026, PRODUCT.md voice: no crypto jargon). Amounts keep pt-BR
// decimals and all 7 places, so what's read is exactly what's signed; the asset is named as people call it.
import { formatAmount7 } from "@vants/adapter-stellar";

const pt = (amount7: bigint) => formatAmount7(amount7).replace(".", ",");

/** "12,5 dólares digitais", "1 lumen", "3 unidades de Tesouro", "3 ABC" for anything else. */
export function inWords(amount7: bigint, unit: string): string {
  const one = amount7 === 10_000_000n;
  if (unit === "XLM" || unit === "native") return `${pt(amount7)} ${one ? "lumen" : "lumens"}`;
  if (unit === "USDC") return `${pt(amount7)} ${one ? "dólar digital" : "dólares digitais"}`;
  if (unit === "TESOURO") return `${pt(amount7)} ${one ? "unidade" : "unidades"} de Tesouro`;
  return `${pt(amount7)} ${unit}`;
}
