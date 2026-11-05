// BR Code (EMV® QRCPS merchant-presented mode) builder and parser for Pix "copia e cola".
// Reference: BCB "Manual de Padrões para Iniciação do Pix" (Anexo I), EMVCo QRCPS MPM.
// Ported from spike src/pix/emv.ts (T-003, DEC-018): BlindPay sandbox sequences removed; TextEncoder instead
// of Buffer so the module also runs in the browser; every field the builder writes is printable ASCII, so a TLV length
// means the same in bytes and characters.

export const PIX_GUI = "br.gov.bcb.pix";

const utf8 = new TextEncoder();
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

// CRC16/CCITT-FALSE: poly 0x1021, init 0xFFFF, no reflection, xorout 0x0000, over the payload up to and including "6304".
export function crc16ccitt(payload: string): string {
  let crc = 0xffff;
  for (const byte of utf8.encode(payload)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function tlv(id: string, value: string): string {
  if (!PRINTABLE_ASCII.test(value)) throw new Error(`EMV field ${id} must be printable ASCII`);
  const len = value.length;
  if (len > 99) throw new Error(`EMV field ${id} too long (${len} > 99)`);
  return `${id}${String(len).padStart(2, "0")}${value}`;
}

/** Strips diacritics and anything outside the EMV-safe charset, then uppercases. */
export function sanitizeEmvText(value: string, maxLength: number): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 $%*+\-./:]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
    .trim();
}

/** Integer cents → "60.00". */
export function formatAmountCents(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents <= 0)
    throw new Error(`amount must be a positive integer of cents, got ${cents}`);
  const s = `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
  if (s.length > 13) throw new Error(`amount ${s} exceeds 13 characters`);
  return s;
}

/** "60.00" → 6000. */
export function parseAmountToCents(amount: string): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount);
  if (!m) throw new Error(`invalid EMV amount "${amount}"`);
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

export interface StaticBrCodeInput {
  /** Pix key: email, +55 phone, CPF/CNPJ digits, or EVP uuid. */
  key: string;
  merchantName: string;
  merchantCity: string;
  /** Integer cents. Omit for an amount-less (payer-chooses) code. */
  amountCents?: number;
  /** `***` (default) or up to 25 alphanumerics. */
  txid?: string;
  /** Free text shown to the payer (tag 26-02). */
  description?: string;
  postalCode?: string;
  /** Emit tag 01 = "11" (reusable). Optional for static codes. */
  pointOfInitiation?: boolean;
}

export function buildStaticBrCode(input: StaticBrCodeInput): string {
  const txid = input.txid ?? "***";
  if (txid !== "***" && !/^[A-Za-z0-9]{1,25}$/.test(txid)) throw new Error(`invalid txid "${txid}"`);
  const key = input.key.trim();
  if (!key) throw new Error("Pix key is required");

  const merchantName = sanitizeEmvText(input.merchantName, 25);
  const merchantCity = sanitizeEmvText(input.merchantCity, 15);
  if (!merchantName) throw new Error("merchant name is empty after sanitizing");
  if (!merchantCity) throw new Error("merchant city is empty after sanitizing");

  const mai =
    tlv("00", PIX_GUI) + tlv("01", key) + (input.description ? tlv("02", sanitizeEmvText(input.description, 40)) : "");

  let payload =
    tlv("00", "01") +
    (input.pointOfInitiation ? tlv("01", "11") : "") +
    tlv("26", mai) +
    tlv("52", "0000") +
    tlv("53", "986") +
    (input.amountCents !== undefined ? tlv("54", formatAmountCents(input.amountCents)) : "") +
    tlv("58", "BR") +
    tlv("59", merchantName) +
    tlv("60", merchantCity) +
    (input.postalCode ? tlv("61", input.postalCode.replace(/\D/g, "").slice(0, 8)) : "") +
    tlv("62", tlv("05", txid)) +
    "6304";
  payload += crc16ccitt(payload);
  return payload;
}

/** A static code with a unique TXID (prefix + time + random), e.g. for test fixtures. */
export function uniqueStaticCode(
  input: Omit<StaticBrCodeInput, "txid"> & { txidPrefix?: string },
  random: () => number = Math.random,
): { code: string; txid: string } {
  const prefix = (input.txidPrefix ?? "VANTS")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, 10);
  const rand = `${Date.now().toString(36)}${random().toString(36).slice(2, 10)}`.toUpperCase();
  const txid = `${prefix}${rand}`.slice(0, 25);
  const { txidPrefix: _prefix, ...rest } = input;
  return { code: buildStaticBrCode({ ...rest, txid }), txid };
}

// --- Parser / validator ---------------------------------------------------------------------------------------

export interface Tlv {
  id: string;
  length: number;
  value: string;
  children?: Tlv[];
}

export type BrCodeErrorCode =
  | "EMPTY"
  | "MALFORMED_TLV"
  | "LENGTH_OVERFLOW"
  | "CRC_MISSING"
  | "CRC_NOT_LAST"
  | "CRC_MISMATCH"
  | "MISSING_TAG"
  | "INVALID_VALUE"
  | "NOT_PIX";

export interface BrCodeError {
  code: BrCodeErrorCode;
  message: string;
  tag?: string;
}

export interface ParsedBrCode {
  payloadFormat: string;
  pointOfInitiation?: string;
  isDynamic: boolean;
  gui: string;
  key?: string;
  description?: string;
  url?: string;
  mcc: string;
  currency: string;
  amount?: string;
  amountCents?: number;
  country: string;
  merchantName: string;
  merchantCity: string;
  postalCode?: string;
  txid?: string;
  crc: string;
  tags: Tlv[];
  warnings: string[];
}

export type ParseResult = { ok: true; code: ParsedBrCode } | { ok: false; errors: BrCodeError[]; tags?: Tlv[] };

const NESTED_TEMPLATE_IDS = new Set([
  "62",
  "64",
  ...Array.from({ length: 26 }, (_, i) => String(26 + i)),
  ...Array.from({ length: 20 }, (_, i) => String(80 + i)),
]);

function parseTlvs(input: string, nested: boolean): { tags: Tlv[] } | { error: BrCodeError } {
  const tags: Tlv[] = [];
  let i = 0;
  while (i < input.length) {
    const head = input.slice(i, i + 4);
    if (!/^\d{4}$/.test(head)) {
      return {
        error: { code: "MALFORMED_TLV", message: `expected 2-digit id + 2-digit length at offset ${i}, got "${head}"` },
      };
    }
    const id = head.slice(0, 2);
    const length = Number(head.slice(2, 4));
    const value = input.slice(i + 4, i + 4 + length);
    if (value.length !== length) {
      return {
        error: {
          code: "LENGTH_OVERFLOW",
          tag: id,
          message: `tag ${id} declares length ${length} but only ${value.length} chars remain`,
        },
      };
    }
    const tag: Tlv = { id, length, value };
    if (!nested && NESTED_TEMPLATE_IDS.has(id)) {
      const inner = parseTlvs(value, true);
      if ("error" in inner) return { error: { ...inner.error, message: `inside tag ${id}: ${inner.error.message}` } };
      tag.children = inner.tags;
    }
    tags.push(tag);
    i += 4 + length;
  }
  return { tags };
}

export function parseBrCode(raw: string): ParseResult {
  const code = raw.trim();
  if (!code) return { ok: false, errors: [{ code: "EMPTY", message: "empty BR Code" }] };

  const parsed = parseTlvs(code, false);
  if ("error" in parsed) return { ok: false, errors: [parsed.error] };
  const { tags } = parsed;
  const errors: BrCodeError[] = [];
  const warnings: string[] = [];

  const crcIndex = tags.findIndex((t) => t.id === "63");
  const crcTag = tags[crcIndex];
  if (!crcTag) {
    errors.push({ code: "CRC_MISSING", tag: "63", message: "tag 63 (CRC) is missing" });
  } else {
    if (crcIndex !== tags.length - 1)
      errors.push({ code: "CRC_NOT_LAST", tag: "63", message: "tag 63 must be the last field" });
    if (crcTag.length !== 4) {
      errors.push({ code: "INVALID_VALUE", tag: "63", message: "CRC must be 4 hex chars" });
    } else {
      const expected = crc16ccitt(code.slice(0, code.length - 4));
      if (expected !== crcTag.value.toUpperCase()) {
        errors.push({ code: "CRC_MISMATCH", tag: "63", message: `CRC is ${crcTag.value}, expected ${expected}` });
      }
    }
  }

  const get = (id: string) => tags.find((t) => t.id === id);
  const required = (id: string, name: string) => {
    const t = get(id);
    if (!t) errors.push({ code: "MISSING_TAG", tag: id, message: `required tag ${id} (${name}) is missing` });
    return t;
  };

  const pfi = required("00", "payload format indicator");
  if (pfi && pfi.value !== "01") {
    errors.push({ code: "INVALID_VALUE", tag: "00", message: `payload format must be "01", got "${pfi.value}"` });
  }
  if (tags[0]?.id !== "00")
    errors.push({ code: "INVALID_VALUE", tag: "00", message: "tag 00 must be the first field" });

  const poi = get("01");
  if (poi && poi.value !== "11" && poi.value !== "12") {
    errors.push({
      code: "INVALID_VALUE",
      tag: "01",
      message: `point of initiation must be 11 or 12, got "${poi.value}"`,
    });
  }

  // Merchant account information: Pix lives in one of 26..51 with GUI br.gov.bcb.pix.
  const mai = tags.find(
    (t) =>
      Number(t.id) >= 26 &&
      Number(t.id) <= 51 &&
      t.children?.some((c) => c.id === "00" && c.value.toLowerCase() === PIX_GUI),
  );
  if (!mai) errors.push({ code: "NOT_PIX", tag: "26", message: `no merchant account template with GUI ${PIX_GUI}` });
  const maiField = (id: string) => mai?.children?.find((c) => c.id === id)?.value;
  const key = maiField("01");
  const url = maiField("25");
  if (mai && !key && !url) {
    errors.push({
      code: "MISSING_TAG",
      tag: `${mai.id}-01`,
      message: "Pix template has neither a key (01) nor a URL (25)",
    });
  }

  const mcc = required("52", "merchant category code");
  const currency = required("53", "transaction currency");
  if (currency && currency.value !== "986") {
    errors.push({ code: "INVALID_VALUE", tag: "53", message: `currency must be 986 (BRL), got ${currency.value}` });
  }

  const amountTag = get("54");
  let amountCents: number | undefined;
  if (amountTag) {
    if (!/^\d+(\.\d{1,2})?$/.test(amountTag.value)) {
      errors.push({ code: "INVALID_VALUE", tag: "54", message: `invalid amount "${amountTag.value}"` });
    } else {
      amountCents = parseAmountToCents(amountTag.value);
      if (amountCents === 0) warnings.push("amount is 0.00");
    }
  }

  const country = required("58", "country code");
  const name = required("59", "merchant name");
  const city = required("60", "merchant city");
  if (name && name.length > 25)
    errors.push({ code: "INVALID_VALUE", tag: "59", message: "merchant name exceeds 25 chars" });
  if (city && city.length > 15)
    errors.push({ code: "INVALID_VALUE", tag: "60", message: "merchant city exceeds 15 chars" });

  const additional = get("62");
  const txid = additional?.children?.find((c) => c.id === "05")?.value;
  if (!additional) warnings.push("tag 62 (additional data / txid) is missing");

  if (errors.length > 0 || !pfi || !mcc || !currency || !country || !name || !city || !crcTag) {
    return { ok: false, errors, tags };
  }

  const optional = <K extends string, V>(k: K, v: V | undefined) =>
    v === undefined ? {} : ({ [k]: v } as Record<K, V>);
  return {
    ok: true,
    code: {
      payloadFormat: pfi.value,
      ...optional("pointOfInitiation", poi?.value),
      isDynamic: poi?.value === "12" || Boolean(url),
      gui: PIX_GUI,
      ...optional("key", key),
      ...optional("description", maiField("02")),
      ...optional("url", url),
      mcc: mcc.value,
      currency: currency.value,
      ...optional("amount", amountTag?.value),
      ...optional("amountCents", amountCents),
      country: country.value,
      merchantName: name.value,
      merchantCity: city.value,
      ...optional("postalCode", get("61")?.value),
      ...optional("txid", txid),
      crc: crcTag.value,
      tags,
      warnings,
    },
  };
}

/** Recomputes the CRC: handy for fixtures that tamper with a field but keep a valid checksum. */
export function withFixedCrc(code: string): string {
  const body = code.slice(0, code.lastIndexOf("6304") + 4);
  return body + crc16ccitt(body);
}
