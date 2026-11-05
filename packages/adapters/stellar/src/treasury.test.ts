// T-009: deposit addresses, refund envelopes and the resubmit-by-hash decision (pure parts, no network).
import { Account, Asset, Keypair, MuxedAccount, Networks, StrKey, TransactionBuilder } from "@stellar/stellar-sdk";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  buildRefundTx,
  classicAsset,
  depositInstructions,
  refundMemo,
  refundRetryDecision,
  sacIdOf,
  sacMatchesAsset,
} from "./treasury.ts";

const treasury = Keypair.random();
const CIRCLE_USDC = "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

describe("sacMatchesAsset (T-047)", () => {
  const circleSac = sacIdOf(classicAsset(CIRCLE_USDC));

  it("accepts an asset's own contract, native included", () => {
    expect(sacMatchesAsset(circleSac, CIRCLE_USDC)).toBe(true);
    expect(sacMatchesAsset(sacIdOf(classicAsset("native")), "native")).toBe(true);
  });

  it("refuses a contract naming an asset that isn't its own", () => {
    expect(sacMatchesAsset(StrKey.encodeContract(Buffer.alloc(32, 7)), CIRCLE_USDC)).toBe(false);
    expect(sacMatchesAsset(circleSac, "native")).toBe(false);
  });

  it("refuses a name that isn't an asset, without throwing", () => {
    expect(sacMatchesAsset(circleSac, "garbage")).toBe(false);
    expect(sacMatchesAsset(circleSac, "")).toBe(false);
  });
});

describe("depositInstructions (DEC-004)", () => {
  it("gives an M… address that decodes back to the treasury and the payment's id, plus the memo fallback", () => {
    const d = depositInstructions(treasury.publicKey(), "42");
    expect(StrKey.isValidMed25519PublicKey(d.address)).toBe(true);
    const back = MuxedAccount.fromAddress(d.address, "0");
    expect(back.baseAccount().accountId()).toBe(treasury.publicKey());
    expect(back.id()).toBe("42");
    expect(d).toMatchObject({ account: treasury.publicKey(), memoId: "42" });
  });

  it("refuses ids outside u64", () => {
    expect(() => depositInstructions(treasury.publicKey(), "-1")).toThrow();
    expect(() => depositInstructions(treasury.publicKey(), (2n ** 64n).toString())).toThrow();
    expect(() => depositInstructions(treasury.publicKey(), "0x10")).toThrow();
  });
});

describe("assets", () => {
  it("maps an event's asset name to the classic asset and its SAC id", () => {
    expect(classicAsset("native").isNative()).toBe(true);
    const usdc = classicAsset(CIRCLE_USDC);
    expect([usdc.getCode(), usdc.getIssuer()]).toEqual(CIRCLE_USDC.split(":"));
    // Circle testnet USDC's SAC id, as the spike recorded it (SOURCES.md)
    expect(sacIdOf(usdc)).toBe("CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA");
    expect(sacIdOf(Asset.native())).toBe("CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC");
    expect(() => classicAsset("not an asset")).toThrow();
  });
});

describe("refundMemo (INV-10)", () => {
  it("is a text memo of at most 28 bytes for any u64 payment id and refund number", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 2n ** 64n - 1n }), fc.integer({ min: 1, max: 99 }), (mux, n) => {
        const m = refundMemo(mux.toString(), n);
        expect(m.startsWith("vants:rf:")).toBe(true);
        expect(new TextEncoder().encode(m).length).toBeLessThanOrEqual(28);
      }),
    );
    expect(refundMemo("42", 1)).toBe("vants:rf:16:1");
  });

  it("tags refunds of deposits no payment owns as u<n>, still within 28 bytes, and refuses longer tags", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 2n ** 64n - 1n }), fc.integer({ min: 1, max: 9999 }), (mux, n) => {
        expect(new TextEncoder().encode(refundMemo(mux.toString(), `u${n}`)).length).toBeLessThanOrEqual(28);
      }),
    );
    expect(refundMemo("42", "u1")).toBe("vants:rf:16:u1");
    expect(() => refundMemo("42", 10_000)).toThrow(/tag/);
    expect(() => refundMemo("42", "x1")).toThrow(/tag/);
  });
});

describe("buildRefundTx", () => {
  it("builds one classic payment with the memo and a deadline, signed by the treasury", () => {
    const to = Keypair.random().publicKey();
    const r = buildRefundTx({
      source: new Account(treasury.publicKey(), "100"),
      signer: treasury,
      to,
      asset: classicAsset(CIRCLE_USDC),
      amount7: 22_851_852n,
      memo: "vants:rf:16:1",
      nowSeconds: 1_761_180_000,
      timeoutSeconds: 300,
    });
    const tx = TransactionBuilder.fromXDR(r.xdr, Networks.TESTNET);
    if ("innerTransaction" in tx) throw new Error("unexpected fee bump");
    expect(tx.operations).toHaveLength(1);
    expect(tx.operations[0]).toMatchObject({ type: "payment", destination: to, amount: "2.2851852" });
    // SDK 17.3 returns a text memo's value as bytes
    const memo = tx.memo.value;
    expect(typeof memo === "string" ? memo : new TextDecoder().decode(memo as Uint8Array)).toBe("vants:rf:16:1");
    expect(tx.memo.type).toBe("text");
    expect(tx.timeBounds?.maxTime).toBe(String(1_761_180_000 + 300));
    expect(r.maxTime).toBe(1_761_180_300);
    expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.hash).toBe(Buffer.from(tx.hash()).toString("hex"));
    expect(tx.signatures).toHaveLength(1);
  });

  it("refuses non-positive amounts and over-long memos", () => {
    const base = {
      source: new Account(treasury.publicKey(), "1"),
      signer: treasury,
      to: Keypair.random().publicKey(),
      asset: Asset.native(),
      nowSeconds: 1,
    };
    expect(() => buildRefundTx({ ...base, amount7: 0n, memo: "m" })).toThrow();
    expect(() => buildRefundTx({ ...base, amount7: 1n, memo: "x".repeat(29) })).toThrow();
  });
});

describe("refundRetryDecision (resubmit by hash, never twice)", () => {
  it.each([
    ["on the ledger → done", { onLedger: true, nowSeconds: 1000, maxTime: 500 }, "done"],
    [
      "not seen, deadline ahead → resubmit the same envelope",
      { onLedger: false, nowSeconds: 400, maxTime: 500 },
      "resubmit",
    ],
    [
      "not seen, just past the deadline → still resubmit (a ledger closing now may include it; a late envelope is rejected harmlessly)",
      { onLedger: false, nowSeconds: 520, maxTime: 500 },
      "resubmit",
    ],
    [
      "not seen, deadline + 30 s grace passed → it can never land: rebuild",
      { onLedger: false, nowSeconds: 531, maxTime: 500 },
      "rebuild",
    ],
  ] as const)("%s", (_, input, decision) => {
    expect(refundRetryDecision(input)).toBe(decision);
  });
});
