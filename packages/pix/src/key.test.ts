// T-025: Pix keys as people type them. Detection guesses the type; normalisation is the rule the API enforces.
import { describe, expect, it } from "vitest";
import { detectPixKeyType, maskPixKey, normalizePixKey } from "./key.ts";

describe("detectPixKeyType", () => {
  it.each([
    ["maria.souza@exemplo.com.br", "EMAIL"],
    ["111.572.277-83", "CPF"],
    ["11157227783", "CPF"],
    ["11.222.333/0001-81", "CNPJ"],
    ["+55 11 98765-4321", "PHONE"],
    ["(11) 98765-4321", "PHONE"],
    ["11987654321", "PHONE"], // 11 digits that aren't a valid CPF: a mobile number
    ["123e4567-e89b-42d3-a456-426614174000", "RANDOM"],
  ])("%s is %s", (raw, type) => {
    expect(detectPixKeyType(raw)).toBe(type);
  });

  it("says nothing when it can't tell", () => {
    expect(detectPixKeyType("")).toBeNull();
    expect(detectPixKeyType("abc")).toBeNull();
    expect(detectPixKeyType("12345")).toBeNull();
  });
});

describe("normalizePixKey", () => {
  it("keeps only what identifies the key, in the form the Pix directory stores it", () => {
    expect(normalizePixKey("CPF", "111.572.277-83")).toEqual({ ok: true, key: "11157227783" });
    expect(normalizePixKey("CNPJ", "11.222.333/0001-81")).toEqual({ ok: true, key: "11222333000181" });
    expect(normalizePixKey("EMAIL", " Maria.Souza@Exemplo.com.br ")).toEqual({
      ok: true,
      key: "maria.souza@exemplo.com.br",
    });
    expect(normalizePixKey("PHONE", "(11) 98765-4321")).toEqual({ ok: true, key: "+5511987654321" });
    expect(normalizePixKey("PHONE", "+55 11 98765-4321")).toEqual({ ok: true, key: "+5511987654321" });
    expect(normalizePixKey("RANDOM", "123E4567-E89B-42D3-A456-426614174000")).toEqual({
      ok: true,
      key: "123e4567-e89b-42d3-a456-426614174000",
    });
  });

  it.each([
    ["CPF", "111.572.277-84", "dígitos"],
    ["CPF", "111.111.111-11", "dígitos"],
    ["CNPJ", "11.222.333/0001-82", "dígitos"],
    ["EMAIL", "maria@", "e-mail"],
    ["PHONE", "98765-4321", "DDD"],
    ["RANDOM", "123e4567", "aleatória"],
  ] as const)("refuses a bad %s (%s)", (type, raw, hint) => {
    const r = normalizePixKey(type, raw);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.message).toContain(hint);
  });
});

describe("maskPixKey", () => {
  it("hides the middle of documents and phones, the way bank apps show a key", () => {
    expect(maskPixKey("CPF", "11157227783")).toBe("•••.572.277-••");
    expect(maskPixKey("CNPJ", "11222333000181")).toBe("11.222.333/0001-81");
    expect(maskPixKey("PHONE", "+5511987654321")).toBe("+55 11 •••••-4321");
    expect(maskPixKey("EMAIL", "maria.souza@exemplo.com.br")).toBe("maria.souza@exemplo.com.br");
    expect(maskPixKey("RANDOM", "123e4567-e89b-42d3-a456-426614174000")).toBe("123e4567…4000");
  });
});
