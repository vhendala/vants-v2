// Pix keys (DICT) as people type them (T-025): the five kinds, a best guess at which one was typed, the canonical form the
// directory stores (CPF/CNPJ digits, +55 phone, lower-case e-mail and EVP), and the masked form bank apps display. Pure, so
// the API (validation) and the mini app (detection, masking) share it.

export type PixKeyType = "CPF" | "CNPJ" | "EMAIL" | "PHONE" | "RANDOM";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const digitsOf = (s: string) => s.replace(/\D/g, "");

function cpfValid(d: string): boolean {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  const check = (n: number) => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Number(d[i]) * (n + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return check(9) === Number(d[9]) && check(10) === Number(d[10]);
}

function cnpjValid(d: string): boolean {
  if (!/^\d{14}$/.test(d) || /^(\d)\1{13}$/.test(d)) return false;
  const check = (weights: number[]) => {
    const sum = weights.reduce((acc, w, i) => acc + w * Number(d[i]), 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  return check(w1) === Number(d[12]) && check([6, ...w1]) === Number(d[13]);
}

/** The kind of key `raw` looks like, or null. Eleven digits are a CPF when the check digits hold, else a mobile number. */
export function detectPixKeyType(raw: string): PixKeyType | null {
  const s = raw.trim();
  if (!s) return null;
  if (s.includes("@")) return "EMAIL";
  if (UUID.test(s)) return "RANDOM";
  if (/[^\d\s().+/-]/.test(s)) return null;
  const d = digitsOf(s);
  if (s.startsWith("+")) return "PHONE";
  if (d.length === 14) return cnpjValid(d) ? "CNPJ" : null;
  if (d.length === 11) return cpfValid(d) ? "CPF" : "PHONE";
  if (d.length === 10 || ((d.length === 12 || d.length === 13) && d.startsWith("55"))) return "PHONE";
  return null;
}

/** The key in the directory's canonical form, or why it isn't one (in pt-BR, for the person typing it). */
export function normalizePixKey(
  type: PixKeyType,
  raw: string,
): { ok: true; key: string } | { ok: false; message: string } {
  const s = raw.trim();
  switch (type) {
    case "CPF": {
      const d = digitsOf(s);
      return cpfValid(d) ? { ok: true, key: d } : { ok: false, message: "CPF inválido: confira os dígitos" };
    }
    case "CNPJ": {
      const d = digitsOf(s);
      return cnpjValid(d) ? { ok: true, key: d } : { ok: false, message: "CNPJ inválido: confira os dígitos" };
    }
    case "EMAIL": {
      const e = s.toLowerCase();
      return EMAIL.test(e) && e.length <= 77
        ? { ok: true, key: e }
        : { ok: false, message: "Esse e-mail não parece completo" };
    }
    case "PHONE": {
      let d = digitsOf(s);
      if (!s.startsWith("+") && (d.length === 10 || d.length === 11)) d = `55${d}`;
      return /^55\d{10,11}$/.test(d)
        ? { ok: true, key: `+${d}` }
        : { ok: false, message: "Celular com DDD: 11 98765-4321" };
    }
    case "RANDOM":
      return UUID.test(s) ? { ok: true, key: s.toLowerCase() } : { ok: false, message: "Chave aleatória incompleta" };
  }
}

/** The key as bank apps show it: documents and phones with their middle hidden; e-mails whole; EVPs shortened. */
export function maskPixKey(type: PixKeyType, key: string): string {
  switch (type) {
    case "CPF":
      return `•••.${key.slice(3, 6)}.${key.slice(6, 9)}-••`;
    case "CNPJ":
      return `${key.slice(0, 2)}.${key.slice(2, 5)}.${key.slice(5, 8)}/${key.slice(8, 12)}-${key.slice(12)}`;
    case "PHONE":
      return `+55 ${key.slice(3, 5)} •••••-${key.slice(-4)}`;
    case "EMAIL":
      return key;
    case "RANDOM":
      return `${key.slice(0, 8)}…${key.slice(-4)}`;
  }
}

export const PIX_KEY_LABEL: Record<PixKeyType, string> = {
  CPF: "CPF",
  CNPJ: "CNPJ",
  EMAIL: "E-mail",
  PHONE: "Celular",
  RANDOM: "Chave aleatória",
};
