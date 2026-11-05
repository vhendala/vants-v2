// Transfer envelopes as Pier delivers them (recorded on testnet, T-008 probe): both deposit paths carry the muxed id.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTransfer } from "./envelope.ts";

const rec = JSON.parse(readFileSync(new URL("../test/fixtures/envelopes.json", import.meta.url), "utf8"));
const XLM_SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

describe("parseTransfer", () => {
  it("reads a classic payment with a memo id: the memo id is the muxed id", () => {
    expect(parseTransfer(rec.classicMemoId.envelope)).toEqual({
      eventId: rec.classicMemoId.envelope.id,
      position: rec.classicMemoId.envelope.position,
      txHash: rec.classicMemoId.envelope.txHash,
      ledger: rec.classicMemoId.envelope.ledger,
      ledgerClosedAt: rec.classicMemoId.envelope.ledgerClosedAt,
      asset: XLM_SAC,
      assetName: "native",
      from: rec.sender,
      to: rec.treasury,
      amount7: 12_345_678n,
      muxedId: "42",
    });
  });

  it("reads a SAC transfer to the treasury's M… address the same way (DEC-004)", () => {
    const t = parseTransfer(rec.sacTransferToMuxed.envelope);
    expect(t).toMatchObject({ to: rec.treasury, amount7: 23_456_789n, muxedId: "43", asset: XLM_SAC });
  });

  it("leaves muxedId out when the transfer has none (plain amount value)", () => {
    const env = { ...rec.classicMemoId.envelope, decoded: { ...rec.classicMemoId.envelope.decoded, value: "500" } };
    const t = parseTransfer(env);
    expect(t?.amount7).toBe(500n);
    expect(t && "muxedId" in t).toBe(false);
  });

  it("does not treat a text memo (bytes) as a muxed id", () => {
    const env = {
      ...rec.classicMemoId.envelope,
      decoded: { ...rec.classicMemoId.envelope.decoded, value: { amount: "500", to_muxed_id: "V0QtN0YzSzJR" } },
    };
    const t = parseTransfer(env);
    expect(t && "muxedId" in t).toBe(false);
  });

  it("ignores events that are not transfers", () => {
    const env = { ...rec.classicMemoId.envelope, decoded: { topic: ["mint", rec.treasury, "native"], value: "1" } };
    expect(parseTransfer(env)).toBeNull();
  });
});
