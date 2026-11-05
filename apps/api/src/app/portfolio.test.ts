// T-018: the mini app's portfolio (SPEC §5.3): what an account can spend, what it's worth, and what it takes to exit.
import { describe, expect, it } from "vitest";
import { type AccountView, type PortfolioSources, readPortfolio } from "./portfolio.ts";

const CIRCLE = "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const BLEND = "USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56";
const EURC = "EURC:GB3Q6QDZYTHWT7E5PVS3W7FUT5GVAFC5KSZFFLPU25GO7VTC3NM2ZTVO";
const VAULT = "CBMVK2JK6NTOT2O4HNQAIQFJY232BHKGLIMXDVQVHIIZKDACXDFZDWHN";
const ME = "GCLFUKIR3AW6NIRV7VEAYGO527YRONFEWL5V4HJBTOQRQ6R64U6UOYTT";
const config = {
  fundingAssets: [CIRCLE, BLEND],
  vaults: [{ id: VAULT, assetName: BLEND }],
  xlmFeeBuffer7: 10_000_000n,
  xlmSlippageBps: 100,
};

const sources = (account: AccountView | null, o: Partial<PortfolioSources> = {}): PortfolioSources => ({
  account: async () => account,
  vaultState: async () => ({
    totalSupply: 1_000_0000000n,
    totalAmount: 1_037_1234567n,
    idle: 0n,
    invested: 0n,
    asset: "C",
  }),
  shares: async () => 0n,
  quoteXlm: async (amount7) => amount7 / 10n, // 1 XLM ≈ 0.10 USDC
  ...o,
});

const account = (o: Partial<AccountView> = {}): AccountView => ({
  balances: [
    { asset: "native", balance7: 100_0000000n, sellingLiabilities7: 0n },
    { asset: CIRCLE, balance7: 12_5000000n, sellingLiabilities7: 2_0000000n },
  ],
  subentryCount: 3,
  numSponsoring: 0,
  numSponsored: 0,
  ...o,
});

describe("readPortfolio", () => {
  it("counts only what can be spent: liabilities out; XLM net of its minimum balance and a fee buffer", async () => {
    const p = await readPortfolio(ME, sources(account()), config);
    const usdc = p.positions.find((x) => x.asset === CIRCLE);
    expect(usdc).toMatchObject({
      kind: "classic",
      amount: "10.5",
      valueUsd: "10.50",
      pricing: "par",
      payable: true,
      exit: { steps: 1 },
    });
    // minimum balance (2 + 3 subentries) × 0.5 = 2.5 XLM; fee buffer 1 XLM → 96.5 spendable
    const xlm = p.positions.find((x) => x.asset === "native");
    expect(xlm).toMatchObject({
      amount: "96.5",
      valueUsd: "9.65",
      pricing: "estimated",
      payable: true,
      exit: { steps: 2, slippageBps: 100, estimated: true },
    });
    expect(p.totalUsd).toBe("20.15");
  });

  it("follows sponsorship: sponsoring raises the minimum balance, being sponsored lowers it", async () => {
    const spendable = async (o: Partial<AccountView>) =>
      (await readPortfolio(ME, sources(account(o)), config)).positions.find((x) => x.asset === "native")?.amount;
    expect(await spendable({ numSponsoring: 2 })).toBe("95.5");
    expect(await spendable({ numSponsored: 2 })).toBe("97.5");
  });

  it("values vault shares through the share price, rounded down, and needs two steps to exit", async () => {
    const p = await readPortfolio(ME, sources(account(), { shares: async () => 100_0000000n }), config);
    expect(p.positions.find((x) => x.kind === "defindex")).toMatchObject({
      id: `defindex:${VAULT}`,
      vault: VAULT,
      asset: BLEND,
      shares: "100",
      amount: "103.7123456",
      valueUsd: "103.71",
      pricing: "par",
      payable: true,
      exit: { steps: 2, slippageBps: 0, estimated: false },
    });
  });

  it("shows XLM it can't price as unpriced and unpayable (signing stays disabled)", async () => {
    const p = await readPortfolio(ME, sources(account(), { quoteXlm: async () => null }), config);
    expect(p.positions.find((x) => x.asset === "native")).toMatchObject({
      valueUsd: null,
      pricing: "unpriced",
      payable: false,
    });
    expect(p.totalUsd).toBe("10.50");
  });

  it("lists assets Vants doesn't take as unpriced and unpayable; leaves out empty balances and dust XLM", async () => {
    const p = await readPortfolio(
      ME,
      sources(
        account({
          balances: [
            { asset: "native", balance7: 3_0000000n, sellingLiabilities7: 0n },
            { asset: EURC, balance7: 5_0000000n, sellingLiabilities7: 0n },
            { asset: BLEND, balance7: 0n, sellingLiabilities7: 0n },
          ],
        }),
      ),
      config,
    );
    expect(p.positions.map((x) => [x.asset, x.pricing, x.payable])).toEqual([[EURC, "unpriced", false]]);
  });

  it("an account that doesn't exist yet has no positions", async () => {
    expect(await readPortfolio(ME, sources(null), config)).toMatchObject({
      account: ME,
      funded: false,
      positions: [],
      totalUsd: "0.00",
    });
  });

  it("values an XLM vault like XLM, as an estimate, and pays a Pix from it (T-026: out, swapped, transferred)", async () => {
    const XLMV = "CD72HOSTSKA2KA4RMVOKVARM7SXBJ7IV54NCPJEEY4ZWOXOQPVFC5SIJ";
    const p = await readPortfolio(
      ME,
      sources(account(), {
        shares: async (v) => (v === XLMV ? 100_0000000n : 0n),
        vaultState: async () => ({ totalSupply: 1n, totalAmount: 1n, idle: 0n, invested: 0n, asset: "C" }),
      }),
      { ...config, vaults: [{ id: XLMV, assetName: "native" }] },
    );
    expect(p.positions.find((x) => x.kind === "defindex")).toMatchObject({
      asset: "native",
      amount: "100",
      valueUsd: "10.00",
      pricing: "estimated",
      payable: true,
    });
  });

  it("says what lumens invested can PAY at the AMM the payment uses, apart from what they're worth (T-026)", async () => {
    const XLMV = "CD72HOSTSKA2KA4RMVOKVARM7SXBJ7IV54NCPJEEY4ZWOXOQPVFC5SIJ";
    const p = await readPortfolio(
      ME,
      sources(account(), {
        shares: async (v) => (v === XLMV ? 100_0000000n : 0n),
        vaultState: async () => ({ totalSupply: 1n, totalAmount: 1n, idle: 0n, invested: 0n, asset: "C" }),
        // the AMM gives a fifth of the order book's price for these lumens
        quoteXlmAmm: async (amount7) => amount7 / 50n,
      }),
      { ...config, vaults: [{ id: XLMV, assetName: "native" }] },
    );
    expect(p.positions.find((x) => x.kind === "defindex")).toMatchObject({
      valueUsd: "10.00", // worth: the market's estimate
      payableUsd: "9.70", // the AMM pays far less: the lumens come out first and pay at the market, less 3%
      unyield: true,
      payable: true,
    });
  });

  it("lumens invested come out first when the AMM pays well below the market (T-026: unyield, then the order book)", async () => {
    const XLMV = "CD72HOSTSKA2KA4RMVOKVARM7SXBJ7IV54NCPJEEY4ZWOXOQPVFC5SIJ";
    const read = (amm: (a: bigint) => bigint) =>
      readPortfolio(
        ME,
        sources(account(), {
          shares: async (v) => (v === XLMV ? 100_0000000n : 0n),
          vaultState: async () => ({ totalSupply: 1n, totalAmount: 1n, idle: 0n, invested: 0n, asset: "C" }),
          quoteXlmAmm: async (a) => amm(a),
        }),
        { ...config, vaults: [{ id: XLMV, assetName: "native" }] },
      );
    // The AMM pays a fifth of the market: take the lumens out first, pay at the market (less 3%)
    expect((await read((a) => a / 50n)).positions.find((x) => x.kind === "defindex")).toMatchObject({
      valueUsd: "10.00",
      payableUsd: "9.70",
      unyield: true,
      payable: true,
    });
    // The AMM pays the market: one transaction through the router, as before
    const near = (await read((a) => a / 10n)).positions.find((x) => x.kind === "defindex");
    expect(near).toMatchObject({ payableUsd: "9.80", payable: true });
    expect(near?.unyield).toBeUndefined();
  });

  it("prices an asset Vants doesn't pay with from an outside quote, as an estimate and not payable (T-026)", async () => {
    const TESOURO = "TESOURO:GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4";
    const p = await readPortfolio(
      ME,
      sources(account({ balances: [{ asset: TESOURO, balance7: 42_8300000n, sellingLiabilities7: 0n }] }), {
        valueUsd7: async (asset, amount7) => (asset === TESOURO ? (amount7 * 216n) / 1000n : null),
      }),
      config,
    );
    expect(p.positions[0]).toMatchObject({ asset: TESOURO, valueUsd: "9.25", pricing: "estimated", payable: false });
    expect(p.totalUsd).toBe("9.25");
  });

  it("prices Tesouro at what the order book pays for all of it, and makes it payable like lumens (T-029)", async () => {
    const TESOURO = "TESOURO:GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4";
    const held = account({ balances: [{ asset: TESOURO, balance7: 256_9800000n, sellingLiabilities7: 0n }] });
    const p = await readPortfolio(
      ME,
      sources(held, {
        quoteSend: async (from, amount7, to) => (from === TESOURO && to === CIRCLE ? (amount7 * 2307n) / 10000n : null),
        valueUsd7: async () => 1n, // the fallback is not used while the book quotes
      }),
      { ...config, swapAssets: [TESOURO] },
    );
    expect(p.positions[0]).toMatchObject({
      id: `classic:${TESOURO}`,
      valueUsd: "59.28",
      pricing: "estimated",
      payable: true,
      exit: { steps: 2, estimated: true },
    });
    // No offers on the book: back to the outside estimate, shown but not payable
    const off = await readPortfolio(
      ME,
      sources(held, { quoteSend: async () => null, valueUsd7: async (_, a) => (a * 216n) / 1000n }),
      { ...config, swapAssets: [TESOURO] },
    );
    expect(off.positions[0]).toMatchObject({ valueUsd: "55.50", payable: false });
  });
});

// T-039: the reads are independent, so they run side by side; the slow testnet RPC then costs one wait, not the sum.
describe("readPortfolio runs its reads side by side (T-039)", () => {
  const TESOURO = "TESOURO:GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4";
  /** Sources whose every read waits until released, counting how many are waiting at once. */
  const slowSources = () => {
    let waiting = 0;
    let most = 0;
    const releases: (() => void)[] = [];
    const slow =
      <A extends unknown[], R>(f: (...a: A) => R) =>
      (...a: A) =>
        new Promise<R>((resolve) => {
          waiting++;
          most = Math.max(most, waiting);
          releases.push(() => {
            waiting--;
            resolve(f(...a));
          });
        });
    const XLMV2 = "CD72HOSTSKA2KA4RMVOKVARM7SXBJ7IV54NCPJEEY4ZWOXOQPVFC5SIJ";
    const src: PortfolioSources = {
      account: async () =>
        account({
          balances: [
            { asset: "native", balance7: 100_0000000n, sellingLiabilities7: 0n },
            { asset: CIRCLE, balance7: 12_5000000n, sellingLiabilities7: 0n },
            { asset: TESOURO, balance7: 50_0000000n, sellingLiabilities7: 0n },
          ],
        }),
      vaultState: slow(() => ({
        totalSupply: 10_0000000n,
        totalAmount: 10_0000000n,
        idle: 0n,
        invested: 0n,
        asset: "C",
      })),
      shares: slow(() => 5_0000000n),
      quoteXlm: slow((a: bigint) => a / 10n),
      quoteXlmAmm: slow((a: bigint) => a / 10n),
      quoteSend: slow((_f: string, a: bigint) => a / 5n),
    };
    const cfg = {
      ...config,
      swapAssets: [TESOURO],
      vaults: [
        { id: VAULT, assetName: BLEND },
        { id: XLMV2, assetName: "native" },
      ],
    };
    const drain = async () => {
      // Release everything waiting, round after round, until the read is done.
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 0));
        for (const r of releases.splice(0)) r();
      }
    };
    return { src, cfg, drain, most: () => most };
  };

  it("starts the balance quotes and every vault's shares and state together", async () => {
    const s = slowSources();
    const read = readPortfolio(ME, s.src, s.cfg);
    await s.drain();
    const p = await read;
    // XLM quote + Tesouro sale + 2 vaults × (shares + state) all in flight at once.
    expect(s.most()).toBeGreaterThanOrEqual(6);
    // Order and values unchanged: balances as Horizon lists them, then the vaults in config order.
    expect(p.positions.map((x) => x.id)).toEqual([
      "classic:native",
      `classic:${CIRCLE}`,
      `classic:${TESOURO}`,
      `defindex:${VAULT}`,
      "defindex:CD72HOSTSKA2KA4RMVOKVARM7SXBJ7IV54NCPJEEY4ZWOXOQPVFC5SIJ",
    ]);
  });

  it("a vault's state failing doesn't break the portfolio of someone with no shares in it", async () => {
    const p = await readPortfolio(
      ME,
      sources(account(), {
        shares: async () => 0n,
        vaultState: async () => {
          throw new Error("simulate failed");
        },
      }),
      config,
    );
    expect(p.positions.some((x) => x.kind === "defindex")).toBe(false);
  });

  it("but does fail it for someone who holds shares (their value can't be shown)", async () => {
    await expect(
      readPortfolio(
        ME,
        sources(account(), {
          shares: async () => 1_0000000n,
          vaultState: async () => {
            throw new Error("simulate failed");
          },
        }),
        config,
      ),
    ).rejects.toThrow("simulate failed");
  });
});
