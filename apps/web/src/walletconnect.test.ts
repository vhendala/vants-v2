// T-046: WalletConnect lets a phone wallet (Freighter mobile, LOBSTR) connect to the app on another screen. It is offered
// only when a Reown project id is configured, and only ever for Stellar testnet (INV-07).
import { describe, expect, it } from "vitest";
import { walletConnectParams, WC_TESTNET } from "./walletconnect.ts";

const ID = "0123456789abcdef0123456789abcdef";

describe("walletConnectParams", () => {
  it("is off without a project id", () => {
    expect(walletConnectParams(undefined, "https://vants.example")).toBeNull();
    expect(walletConnectParams("", "https://vants.example")).toBeNull();
    expect(walletConnectParams("   ", "https://vants.example")).toBeNull();
  });

  it("is off when the id is not a Reown project id (32 hex characters)", () => {
    expect(walletConnectParams("not-an-id", "https://vants.example")).toBeNull();
    expect(walletConnectParams(`${ID}0`, "https://vants.example")).toBeNull();
  });

  it("asks only for Stellar testnet, never the public network", () => {
    const p = walletConnectParams(ID, "https://vants.example");
    expect(p?.allowedChains).toEqual([WC_TESTNET]);
    expect(WC_TESTNET).toBe("stellar:testnet");
    expect(JSON.stringify(p)).not.toContain("pubnet");
  });

  it("names the app as Vants at the page's own origin, with its icon", () => {
    const p = walletConnectParams(` ${ID} `, "https://vants.example.com");
    expect(p?.projectId).toBe(ID);
    expect(p?.metadata).toEqual({
      name: "Vants",
      description: "Pague qualquer Pix com a sua carteira Stellar.",
      url: "https://vants.example.com",
      icons: ["https://vants.example.com/icon-192.png"],
    });
  });
});
