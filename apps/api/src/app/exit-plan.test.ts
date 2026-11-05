// T-019 (DEC-031): one transaction per payment. The planner turns the user's ordered picks into a single route, or refuses.
import { sharesForUnderlying, underlyingForShares } from "@vants/adapter-defindex";
import { describe, expect, it } from "vitest";
import { planExit } from "./exit-plan.ts";
import type { Position } from "./portfolio.ts";

const BLEND = "USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56";
const CIRCLE = "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const VAULT = "CBMVK2JK6NTOT2O4HNQAIQFJY232BHKGLIMXDVQVHIIZKDACXDFZDWHN";
const vaultState = { totalSupply: 1_000_0000000n, totalAmount: 1_037_1234567n }; // share price ≈ 1.0371

const pos = (p: Partial<Position> & Pick<Position, "id" | "kind" | "asset" | "amount">): Position => ({
  valueUsd: p.amount,
  pricing: "par",
  payable: true,
  exit: { steps: 1, slippageBps: 0, estimated: false },
  ...p,
});
const blend = pos({ id: `classic:${BLEND}`, kind: "classic", asset: BLEND, amount: "3" });
const circle = pos({ id: `classic:${CIRCLE}`, kind: "classic", asset: CIRCLE, amount: "50" });
const vault = pos({
  id: `defindex:${VAULT}`,
  kind: "defindex",
  asset: BLEND,
  vault: VAULT,
  shares: "100",
  amount: "103.7123456",
});
const xlm = pos({
  id: "classic:native",
  kind: "classic",
  asset: "native",
  amount: "96.5",
  valueUsd: "9.65",
  pricing: "estimated",
});
const positions = [blend, circle, vault, xlm];
const vaults = new Map([[VAULT, vaultState]]);

describe("planExit (one transaction per payment)", () => {
  it("vault then balance: one router call withdrawing just enough shares, then the exact transfer", () => {
    const plan = planExit({ asset: BLEND, amount7: 10_0000000n }, [vault.id, blend.id], positions, vaults);
    expect(plan).toEqual({
      ok: true,
      route: "router",
      amount7: 10_0000000n,
      withdraw: { vault: VAULT, shares7: sharesForUnderlying(10_0000000n, vaultState), minOut7: 10_0000000n },
      fromBalance7: 0n,
      swap: null,
    });
    // The fewest shares that still cover the amount at this share price.
    const w = plan.ok && plan.route === "router" ? plan.withdraw : null;
    const shares = w && "shares7" in w ? w.shares7 : 0n;
    expect(underlyingForShares(shares, vaultState)).toBeGreaterThanOrEqual(10_0000000n);
    expect(underlyingForShares(shares - 1n, vaultState)).toBeLessThan(10_0000000n);
  });

  it("balance first, vault for the rest, in the user's order", () => {
    const plan = planExit({ asset: BLEND, amount7: 10_0000000n }, [blend.id, vault.id], positions, vaults);
    expect(plan).toMatchObject({
      ok: true,
      route: "router",
      fromBalance7: 3_0000000n,
      withdraw: { minOut7: 7_0000000n },
    });
  });

  it("a balance alone that covers the payment is a classic route with one payment", () => {
    expect(planExit({ asset: CIRCLE, amount7: 2_2851852n }, [circle.id], positions, vaults)).toEqual({
      ok: true,
      route: "classic",
      amount7: 2_2851852n,
      fromBalance7: 2_2851852n,
      swaps: [],
    });
  });

  it("XLM tops up a balance through a swap in the same classic transaction", () => {
    const plan = planExit({ asset: BLEND, amount7: 5_0000000n }, [blend.id, xlm.id], positions, vaults);
    expect(plan).toEqual({
      ok: true,
      route: "classic",
      amount7: 5_0000000n,
      fromBalance7: 3_0000000n,
      swaps: [{ from: "native", receive7: 2_0000000n, slippageBps: 100, spendable7: 96_5000000n }],
    });
  });

  it("XLM with a vault: one router call that withdraws, buys the rest with XLM on the AMM, and pays (DEC-034)", () => {
    const plan = planExit({ asset: BLEND, amount7: 110_0000000n }, [vault.id, xlm.id], positions, vaults);
    expect(plan).toEqual({
      ok: true,
      route: "router",
      amount7: 110_0000000n,
      withdraw: {
        vault: VAULT,
        shares7: sharesForUnderlying(103_7123456n, vaultState),
        minOut7: 103_7123456n,
      },
      fromBalance7: 0n,
      swap: { from: "native", receive7: 6_2876544n, slippageBps: 100, spendable7: 96_5000000n },
    });
  });

  it("XLM first, then the vault, then a balance: still one router call, in the user's order", () => {
    const plan = planExit({ asset: BLEND, amount7: 20_0000000n }, [xlm.id, vault.id, blend.id], positions, vaults);
    expect(plan).toMatchObject({
      ok: true,
      route: "router",
      swap: { receive7: 9_6500000n },
      withdraw: { minOut7: 10_3500000n },
      fromBalance7: 0n,
    });
  });

  it("takes exactly the amount the user chose from each position (T-023)", () => {
    const plan = planExit(
      { asset: BLEND, amount7: 10_0000000n },
      [
        { id: blend.id, amount7: 1_0000000n },
        { id: xlm.id, amount7: 2_5000000n },
        { id: vault.id, amount7: 6_5000000n },
      ],
      positions,
      vaults,
    );
    expect(plan).toMatchObject({
      ok: true,
      route: "router",
      fromBalance7: 1_0000000n,
      swap: { receive7: 2_5000000n },
      withdraw: { minOut7: 6_5000000n },
    });
  });

  it("chosen amounts that don't reach the total are a shortfall; more than a position holds is refused", () => {
    expect(
      planExit({ asset: BLEND, amount7: 10_0000000n }, [{ id: vault.id, amount7: 9_0000000n }], positions, vaults),
    ).toMatchObject({ ok: false, reason: "shortfall", covered7: 9_0000000n });
    expect(
      planExit({ asset: BLEND, amount7: 4_0000000n }, [{ id: blend.id, amount7: 4_0000000n }], positions, vaults),
    ).toMatchObject({ ok: false, reason: "over_position" });
    expect(
      planExit({ asset: BLEND, amount7: 4_0000000n }, [{ id: blend.id, amount7: 0n }], positions, vaults),
    ).toMatchObject({ ok: false, reason: "over_position" });
  });

  it("chosen amounts above the total are trimmed in the user's order", () => {
    const plan = planExit(
      { asset: BLEND, amount7: 5_0000000n },
      [
        { id: vault.id, amount7: 4_0000000n },
        { id: blend.id, amount7: 3_0000000n },
      ],
      positions,
      vaults,
    );
    expect(plan).toMatchObject({
      ok: true,
      route: "router",
      withdraw: { minOut7: 4_0000000n },
      fromBalance7: 1_0000000n,
    });
  });

  it("stops at the amount: later picks are not touched", () => {
    const plan = planExit({ asset: BLEND, amount7: 2_0000000n }, [blend.id, xlm.id], positions, vaults);
    expect(plan).toMatchObject({ ok: true, route: "classic", fromBalance7: 2_0000000n, swaps: [] });
  });

  it.each([
    ["shortfall", [blend.id], 5_0000000n, "shortfall"],
    ["the same vault twice", [vault.id, vault.id], 200_0000000n, "mixed_routes"],
    ["another stablecoin", [circle.id], 1_0000000n, "wrong_asset"],
    ["an unknown position", ["classic:nope"], 1_0000000n, "unknown_position"],
  ])("refuses %s, building nothing", (_, picks, amount7, reason) => {
    expect(planExit({ asset: BLEND, amount7 }, picks as string[], positions, vaults)).toMatchObject({
      ok: false,
      reason,
    });
  });

  it("refuses positions that aren't payable (unpriced XLM: signing stays disabled)", () => {
    const unpriced = { ...xlm, valueUsd: null, pricing: "unpriced" as const, payable: false };
    expect(planExit({ asset: BLEND, amount7: 1_0000000n }, [unpriced.id], [unpriced], vaults)).toMatchObject({
      ok: false,
      reason: "unpayable",
    });
  });
});

describe("planExit: lumens invested in the XLM vault (T-026)", () => {
  const XLM_VAULT = "CD72HOSTSKA2KA4RMVOKVARM7SXBJ7IV54NCPJEEY4ZWOXOQPVFC5SIJ";
  const xlmVaultState = { totalSupply: 500_0000000n, totalAmount: 550_0000000n }; // a share ≈ 1.1 XLM
  const lumensInvested = pos({
    id: `defindex:${XLM_VAULT}`,
    kind: "defindex",
    asset: "native",
    vault: XLM_VAULT,
    shares: "100",
    amount: "110", // XLM
    valueUsd: "11.00",
    pricing: "estimated",
  });
  const all = [...positions, lumensInvested];
  const states = new Map([...vaults, [XLM_VAULT, xlmVaultState]]);

  it("pays in any dollar Vants takes: one router call that takes lumens out and swaps them; the builder sizes the withdrawal", () => {
    const plan = planExit({ asset: CIRCLE, amount7: 8_0000000n }, [lumensInvested.id], all, states);
    expect(plan).toEqual({
      ok: true,
      route: "router",
      amount7: 8_0000000n,
      withdraw: { vault: XLM_VAULT, lumensFor7: 8_0000000n, heldShares7: 100_0000000n, state: xlmVaultState },
      fromBalance7: 0n,
      swap: { from: "native", receive7: 8_0000000n, slippageBps: 100, spendable7: 110_0000000n },
    });
  });

  it("joins lumens in the wallet in ONE swap, and a dollar balance pays the rest", () => {
    const plan = planExit(
      { asset: BLEND, amount7: 20_0000000n },
      [{ id: lumensInvested.id, amount7: 5_0000000n }, { id: xlm.id, amount7: 4_0000000n }, blend.id],
      all,
      states,
    );
    expect(plan).toMatchObject({
      ok: false,
      reason: "shortfall", // 5 + 4 + 3 < 20
    });
    const ok = planExit(
      { asset: BLEND, amount7: 12_0000000n },
      [{ id: lumensInvested.id, amount7: 5_0000000n }, { id: xlm.id, amount7: 4_0000000n }, blend.id],
      all,
      states,
    );
    expect(ok).toEqual({
      ok: true,
      route: "router",
      amount7: 12_0000000n,
      withdraw: { vault: XLM_VAULT, lumensFor7: 5_0000000n, heldShares7: 100_0000000n, state: xlmVaultState },
      fromBalance7: 3_0000000n,
      swap: { from: "native", receive7: 9_0000000n, slippageBps: 100, spendable7: 206_5000000n },
    });
  });

  it("refuses lumens that must come out of the vault first (the app takes them out, then pays from the wallet)", () => {
    const first = { ...lumensInvested, unyield: true as const };
    expect(planExit({ asset: CIRCLE, amount7: 1_0000000n }, [first.id], [first], states)).toMatchObject({
      ok: false,
      reason: "unyield_first",
    });
  });

  it("is still one vault per payment", () => {
    // the dollar vault holds ≈ 103.71: the rest would have to come out of the lumens vault too
    expect(planExit({ asset: BLEND, amount7: 120_0000000n }, [vault.id, lumensInvested.id], all, states)).toMatchObject(
      {
        ok: false,
        reason: "mixed_routes",
      },
    );
  });
});

describe("planExit: Tesouro, sold on the order book (T-029)", () => {
  const TESOURO = "TESOURO:GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4";
  const tesouro = pos({
    id: `classic:${TESOURO}`,
    kind: "classic",
    asset: TESOURO,
    amount: "256.98",
    valueUsd: "59.31",
    pricing: "estimated",
  });

  it("pays alone as one swap into the payment's dollar, from at most what the wallet holds", () => {
    expect(planExit({ asset: CIRCLE, amount7: 5_4000000n }, [tesouro.id], [tesouro], vaults)).toEqual({
      ok: true,
      route: "classic",
      amount7: 5_4000000n,
      fromBalance7: 0n,
      swaps: [{ from: TESOURO, receive7: 5_4000000n, slippageBps: 100, spendable7: 256_9800000n }],
    });
  });

  it("joins lumens and a dollar balance in the same classic transaction", () => {
    const plan = planExit(
      { asset: CIRCLE, amount7: 70_0000000n },
      [tesouro.id, xlm.id, circle.id],
      [tesouro, xlm, circle],
      vaults,
    );
    expect(plan).toMatchObject({
      ok: true,
      route: "classic",
      fromBalance7: 1_0400000n,
      swaps: [
        { from: TESOURO, receive7: 59_3100000n },
        { from: "native", receive7: 9_6500000n },
      ],
    });
  });

  it("can't share a payment with money invested: the router can't reach the order book", () => {
    expect(
      planExit({ asset: BLEND, amount7: 110_0000000n }, [vault.id, tesouro.id], [vault, tesouro], vaults),
    ).toMatchObject({ ok: false, reason: "mixed_routes" });
  });
});
