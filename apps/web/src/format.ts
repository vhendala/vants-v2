// Display helpers (pt-BR). Money is always in the local format (design system: "be exact with money").

/** "USDC:G…" → "USDC"; "native" → "XLM". */
export const code = (asset: string) => (asset === "native" ? "XLM" : (asset.split(":")[0] ?? asset));

/** "Circle" / "Blend": which testnet USDC an asset is, by its issuer. */
export function issuerLabel(asset: string): string | null {
  const issuer = asset.split(":")[1] ?? "";
  if (issuer.startsWith("GBBD47")) return "Circle";
  if (issuer.startsWith("GATALT")) return "Blend";
  return null;
}

/** "USDC · Circle", "XLM". */
export const assetLabel = (asset: string) => {
  const issuer = issuerLabel(asset);
  return issuer ? `${code(asset)} · ${issuer}` : code(asset);
};

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const reais = (value: string | number) => brl.format(Number(value));
export const centsToReais = (cents: number) => brl.format(cents / 100);

/**
 * "1.234,56" typed or pasted → centavos; null if it isn't an amount. With no comma, a dot followed by one or two digits at
 * the end is the decimal point (decimal keypads that offer only "."): "12.50" is R$ 12,50, "1.250" is R$ 1.250 (T-034).
 */
export function parseReais(input: string): number | null {
  const raw = input.replace(/[^\d,.]/g, "");
  const dotDecimal = !raw.includes(",") && /\.\d{1,2}$/.test(raw);
  const clean = dotDecimal ? raw.replace(/\.(?=.*\.)/g, "") : raw.replace(/\./g, "").replace(",", ".");
  if (!clean) return 0;
  const n = Number(clean);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

/**
 * An amount's whole cents, rounded down without float error: `Math.floor(19.99 * 100)` is 1998, this is 1999 (T-034).
 * Seven decimals are the most any Stellar amount has.
 */
export const floorCents = (n: number) => Math.floor(Math.round(n * 1e7) / 1e5);

/** Up to `max` decimals, trailing zeros trimmed, pt-BR separators. */
export function units(value: string, max = 7): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString("pt-BR", { maximumFractionDigits: max });
}

export const usd = (value: string | number) =>
  `US$ ${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const short = (s: string, head = 6, tail = 6) =>
  s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;

const time = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const dayMonth = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short" });
const full = new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeStyle: "short" });

export const clock = (iso: string) => time.format(new Date(iso));
export const longDate = (iso: string) => full.format(new Date(iso));

/** "Hoje", "Ontem", or "22 de out." */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86_400_000);
  return days === 0 ? "Hoje" : days === 1 ? "Ontem" : dayMonth.format(d);
}

export const explorerTx = (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`;
export const explorerAccount = (account: string) => `https://stellar.expert/explorer/testnet/account/${account}`;

/** The DeFindex testnet XLM vault ("Lumens que rendem", T-026), to name a vault pick on old receipts. */
export const LUMENS_VAULT = "CD72HOSTSKA2KA4RMVOKVARM7SXBJ7IV54NCPJEEY4ZWOXOQPVFC5SIJ";
