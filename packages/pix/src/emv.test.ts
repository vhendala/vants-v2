// Ported from spike test/emv.test.ts (T-003), without the BlindPay sandbox-sequence cases, plus property tests.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  buildStaticBrCode,
  crc16ccitt,
  formatAmountCents,
  parseAmountToCents,
  parseBrCode,
  sanitizeEmvText,
  uniqueStaticCode,
  withFixedCrc,
} from "./emv.ts";

// Example from BCB "Manual de Padrões para Iniciação do Pix" (static code, EVP key).
const BCB_EXAMPLE =
  "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D";

const base = { key: "pix@vants.test", merchantName: "Vants Teste", merchantCity: "Sao Paulo" };

describe("crc16ccitt", () => {
  it("matches the CRC-16/CCITT-FALSE check value", () => {
    expect(crc16ccitt("123456789")).toBe("29B1");
  });

  it("matches the CRC of the BCB manual example", () => {
    expect(crc16ccitt(BCB_EXAMPLE.slice(0, -4))).toBe("1D3D");
  });
});

describe("parseBrCode", () => {
  it("accepts the BCB manual example", () => {
    const r = parseBrCode(BCB_EXAMPLE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.code.key).toBe("123e4567-e12b-12d1-a456-426655440000");
    expect(r.code.merchantName).toBe("Fulano de Tal");
    expect(r.code.merchantCity).toBe("BRASILIA");
    expect(r.code.txid).toBe("***");
    expect(r.code.amount).toBeUndefined();
    expect(r.code.isDynamic).toBe(false);
  });

  it("rejects a bad CRC", () => {
    const r = parseBrCode(`${BCB_EXAMPLE.slice(0, -4)}0000`);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.code)).toContain("CRC_MISMATCH");
  });

  it("rejects a declared length that overruns the payload", () => {
    const r = parseBrCode("000201265800");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]?.code).toBe("LENGTH_OVERFLOW");
  });

  it("rejects non-numeric TLV headers", () => {
    const r = parseBrCode("00020X26");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]?.code).toBe("MALFORMED_TLV");
  });

  it("rejects empty input", () => {
    const r = parseBrCode("   ");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]?.code).toBe("EMPTY");
  });

  it("reports missing required tags even when the CRC is valid", () => {
    const noCity = withFixedCrc(BCB_EXAMPLE.replace("6008BRASILIA", ""));
    const r = parseBrCode(noCity);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toContainEqual(expect.objectContaining({ code: "MISSING_TAG", tag: "60" }));
  });

  it("rejects codes without the Pix GUI", () => {
    const r = parseBrCode(withFixedCrc(BCB_EXAMPLE.replace("br.gov.bcb.pix", "br.gov.bcb.xyz")));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.code)).toContain("NOT_PIX");
  });

  it("detects dynamic codes (tag 26-25 URL, point of initiation 12)", () => {
    const mai = "0014br.gov.bcb.pix2532qr.example.com/v2/cobv/abc123def";
    const body = `000201010212${`26${mai.length}${mai}`}52040000530398654041.005802BR5903PSP6008BRASILIA62070503***6304`;
    const r = parseBrCode(withFixedCrc(body));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.code.isDynamic).toBe(true);
    expect(r.code.url).toBe("qr.example.com/v2/cobv/abc123def");
    expect(r.code.amountCents).toBe(100);
  });
});

describe("buildStaticBrCode", () => {
  it("round-trips a fixed-amount code", () => {
    const r = parseBrCode(buildStaticBrCode({ ...base, amountCents: 6000 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.code.amount).toBe("60.00");
    expect(r.code.amountCents).toBe(6000);
    expect(r.code.key).toBe("pix@vants.test");
    expect(r.code.merchantName).toBe("VANTS TESTE");
    expect(r.code.txid).toBe("***");
  });

  it("round-trips an amount-less code", () => {
    const r = parseBrCode(buildStaticBrCode(base));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.code.amount).toBeUndefined();
  });

  it("strips accents and truncates name (25) and city (15)", () => {
    const r = parseBrCode(
      buildStaticBrCode({
        ...base,
        merchantName: "Padaria São João da Esquina Ltda",
        merchantCity: "São José dos Campos",
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.code.merchantName).toBe("PADARIA SAO JOAO DA ESQUI");
    expect(r.code.merchantCity).toBe("SAO JOSE DOS CA");
  });

  it("rejects invalid txids and amounts", () => {
    expect(() => buildStaticBrCode({ ...base, txid: "has space" })).toThrow();
    expect(() => buildStaticBrCode({ ...base, txid: "A".repeat(26) })).toThrow();
    expect(() => buildStaticBrCode({ ...base, amountCents: 0 })).toThrow();
    expect(() => buildStaticBrCode({ ...base, amountCents: 12.5 })).toThrow();
  });

  it("rejects a non-ASCII key, so TLV lengths never depend on bytes vs characters", () => {
    expect(() => buildStaticBrCode({ ...base, key: "joão@vants.test" })).toThrow(/printable ASCII/);
  });
});

describe("uniqueStaticCode", () => {
  it("produces distinct valid codes with the given TXID prefix", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const { code, txid } = uniqueStaticCode({ ...base, amountCents: 6000, txidPrefix: "VANTS" });
      expect(parseBrCode(code).ok).toBe(true);
      expect(txid).toMatch(/^VANTS[A-Z0-9]+$/);
      codes.add(code);
    }
    expect(codes.size).toBe(50);
  });
});

describe("amount helpers", () => {
  it("formats and parses cents without floats", () => {
    expect(formatAmountCents(6000)).toBe("60.00");
    expect(formatAmountCents(7505)).toBe("75.05");
    expect(formatAmountCents(1)).toBe("0.01");
    expect(parseAmountToCents("60.00")).toBe(6000);
    expect(parseAmountToCents("60.5")).toBe(6050);
    expect(parseAmountToCents("60")).toBe(6000);
  });

  it("sanitizes EMV text", () => {
    expect(sanitizeEmvText("  Café & Pão  ", 25)).toBe("CAFE PAO");
  });
});

describe("properties", () => {
  const keyArb = fc.oneof(
    fc.emailAddress().filter((e) => e.length <= 77),
    fc.uuid(),
    fc.stringMatching(/^\d{11}$/), // CPF
    fc.stringMatching(/^\+55\d{10,11}$/), // phone
  );
  const textArb = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,30}$/);
  const amountArb = fc.option(fc.integer({ min: 1, max: 99_999_999 }), { nil: undefined });

  it("any valid input builds a code that parses back to the same key and amount", () => {
    fc.assert(
      fc.property(keyArb, textArb, textArb, amountArb, (key, merchantName, merchantCity, amountCents) => {
        const code = buildStaticBrCode({ key, merchantName, merchantCity, ...(amountCents ? { amountCents } : {}) });
        const r = parseBrCode(code);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.code.key).toBe(key);
        expect(r.code.amountCents).toBe(amountCents);
      }),
    );
  });

  it("any single changed character, keeping the old CRC, is rejected", () => {
    const code = buildStaticBrCode({ ...base, amountCents: 1234 });
    const body = code.slice(0, -4);
    fc.assert(
      fc.property(fc.nat({ max: body.length - 1 }), fc.constantFrom(..."0123456789ABCXYZ."), (i, ch) => {
        fc.pre(body[i] !== ch);
        const tampered = `${body.slice(0, i)}${ch}${body.slice(i + 1)}${code.slice(-4)}`;
        expect(parseBrCode(tampered).ok).toBe(false);
      }),
    );
  });
});
