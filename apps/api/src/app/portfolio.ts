// The mini app's portfolio (SPEC §5.3, T-018): every position an account could pay a BR Code from, what it can actually spend,
// what that is worth, and what exiting it takes (T-019 plans the steps). Numbers that are estimates are labelled, and a
// position that can't be priced is not payable: the mini app disables signing for it (the earlier prototype rule).
import { underlyingForShares, type VaultState } from "@vants/adapter-defindex";
import { formatAmount7 } from "@vants/domain";

export interface ClassicBalance {
  /** "native" or "CODE:ISSUER". */
  asset: string;
  balance7: bigint;
  /** Held by open offers: not spendable. */
  sellingLiabilities7: bigint;
}

export interface AccountView {
  balances: ClassicBalance[];
  subentryCount: number;
  numSponsoring: number;
  numSponsored: number;
}

export interface PortfolioSources {
  /** null when the account doesn't exist on the network yet. */
  account(account: string): Promise<AccountView | null>;
  vaultState(vault: string): Promise<VaultState>;
  shares(vault: string, owner: string): Promise<bigint>;
  /** What a strict-send of `amount7` XLM would deliver in `toAsset` along the best path, or null when there's none. */
  quoteXlm(amount7: bigint, toAsset: string): Promise<bigint | null>;
  /**
   * What `amount7` XLM buys of `toAsset` on the Soroban AMM the router swaps on (T-026): lumens taken out of a vault can only
   * be swapped there, and its price can differ a lot from the order book's. Absent: the order book's quote is used.
   */
  quoteXlmAmm?(amount7: bigint, toAsset: string): Promise<bigint | null>;
  /**
   * What a strict-send of `amount7` of `fromAsset` would deliver in `toAsset` on the order book, or null when no path takes
   * it all (T-029: TESOURO, sold to Etherfuse's market maker for dollars).
   */
  quoteSend?(fromAsset: string, amount7: bigint, toAsset: string): Promise<bigint | null>;
  /** An outside estimate (USD, 7 decimals) for `amount7` of an asset Vants doesn't pay with, e.g. TESOURO (T-026). */
  valueUsd7?(asset: string, amount7: bigint): Promise<bigint | null>;
}

export interface PortfolioConfig {
  /** Assets a Vants payment can be funded with (stablecoins, valued at par). The first one prices XLM. */
  fundingAssets: string[];
  /**
   * Assets that pay by being sold on the order book for the payment's dollar, like lumens (T-029: TESOURO). Valued at what
   * selling them all would give now; payable when that sale has a path.
   */
  swapAssets?: string[];
  /** DeFindex vaults to look for, each with its underlying asset. */
  vaults: { id: string; assetName: string }[];
  /** XLM kept back for the exit's own network fees. */
  xlmFeeBuffer7: bigint;
  /** Slippage allowed when an exit swaps XLM. */
  xlmSlippageBps: number;
}

export interface Position {
  id: string;
  kind: "classic" | "defindex";
  /** The asset paid out ("native" or "CODE:ISSUER"); for a vault, its underlying. */
  asset: string;
  vault?: string;
  shares?: string;
  /** What can be spent, in the asset's units. */
  amount: string;
  /** USD, 2 decimals rounded down; null when it can't be priced. */
  valueUsd: string | null;
  /**
   * What it can pay right now, when that differs from what it's worth (T-026: lumens invested, priced at the AMM the
   * payment swaps on, less a margin for the swap's slippage allowance). Absent: `valueUsd`.
   */
  payableUsd?: string;
  /**
   * Lumens invested that come out of the vault before paying (T-026): the AMM a single transaction must swap on pays well
   * below the market, so the app takes them out (one confirmation) and pays from the wallet through the order book (another).
   */
  unyield?: true;
  /** par: a stablecoin Vants takes; estimated: a live market quote; unpriced: no price, so not payable. */
  pricing: "par" | "estimated" | "unpriced";
  payable: boolean;
  /** Transactions the wallet signs to turn it into the payment (the final transfer included). */
  exit: { steps: number; slippageBps: number; estimated: boolean };
}

export interface Portfolio {
  account: string;
  funded: boolean;
  positions: Position[];
  /** Sum of the priced positions. */
  totalUsd: string;
}

/** One base reserve (0.5 XLM) in stroops. */
const BASE_RESERVE7 = 5_000_000n;

/** 7-decimal USD → "12.34", rounded down to the cent. */
const usd = (amount7: bigint) => {
  const cents = amount7 / 100_000n;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
};
const amount = (amount7: bigint) => (amount7 > 0n ? formatAmount7(amount7) : "0");

export async function readPortfolio(
  account: string,
  sources: PortfolioSources,
  config: PortfolioConfig,
): Promise<Portfolio> {
  const view = await sources.account(account);
  if (!view) return { account, funded: false, positions: [], totalUsd: "0.00" };

  const funding = new Set(config.fundingAssets);
  // Every balance and every vault is read side by side (T-039): each one's reads are independent of the others, and on a
  // slow RPC the portfolio then costs about one wait instead of the sum. Positions keep their order.
  const balance = async (b: AccountView["balances"][number]): Promise<Position | null> => {
    if (b.asset === "native") {
      // Minimum balance: (2 + subentries + sponsoring − sponsored) base reserves (Stellar docs, "Accounts").
      const reserve = BigInt(2 + view.subentryCount + view.numSponsoring - view.numSponsored) * BASE_RESERVE7;
      const spendable = b.balance7 - reserve - b.sellingLiabilities7 - config.xlmFeeBuffer7;
      if (spendable <= 0n) return null;
      const priceIn = config.fundingAssets[0];
      const quote = priceIn ? await sources.quoteXlm(spendable, priceIn) : null;
      return {
        id: "classic:native",
        kind: "classic",
        asset: "native",
        amount: amount(spendable),
        valueUsd: quote === null ? null : usd(quote),
        pricing: quote === null ? "unpriced" : "estimated",
        payable: quote !== null,
        exit: { steps: 2, slippageBps: config.xlmSlippageBps, estimated: true }, // swap to USDC, then the transfer
      };
    }
    const spendable = b.balance7 - b.sellingLiabilities7;
    if (spendable <= 0n) return null;
    const takes = funding.has(b.asset);
    const sells = !takes && (config.swapAssets ?? []).includes(b.asset) && config.fundingAssets[0];
    const sale = sells ? await sources.quoteSend?.(b.asset, spendable, sells).catch(() => null) : null;
    if (sale) {
      // Paid like lumens (T-029): sold on the order book into the payment's dollar, in the same one transaction.
      return {
        id: `classic:${b.asset}`,
        kind: "classic",
        asset: b.asset,
        amount: amount(spendable),
        valueUsd: usd(sale),
        pricing: "estimated",
        payable: true,
        exit: { steps: 2, slippageBps: config.xlmSlippageBps, estimated: true }, // sell for dollars, then the transfer
      };
    }
    const outside = takes ? null : ((await sources.valueUsd7?.(b.asset, spendable).catch(() => null)) ?? null);
    if (outside !== null) {
      // Worth something, but not a Vants funding asset: shown and counted, not payable (T-026).
      return {
        id: `classic:${b.asset}`,
        kind: "classic",
        asset: b.asset,
        amount: amount(spendable),
        valueUsd: usd(outside),
        pricing: "estimated",
        payable: false,
        exit: { steps: 0, slippageBps: 0, estimated: true },
      };
    }
    return {
      id: `classic:${b.asset}`,
      kind: "classic",
      asset: b.asset,
      amount: amount(spendable),
      valueUsd: takes ? usd(spendable) : null,
      pricing: takes ? "par" : "unpriced",
      payable: takes,
      exit: takes ? { steps: 1, slippageBps: 0, estimated: false } : { steps: 0, slippageBps: 0, estimated: true },
    };
  };

  const vault = async (v: PortfolioConfig["vaults"][number]): Promise<Position | null> => {
    // Shares and the vault's totals together; the totals only matter (and only fail the read) when there are shares.
    const [shares, state] = await Promise.all([
      sources.shares(v.id, account),
      sources.vaultState(v.id).catch((err: unknown) => (err instanceof Error ? err : new Error(String(err)))),
    ]);
    if (shares <= 0n) return null;
    if (state instanceof Error) throw state;
    const underlying = underlyingForShares(shares, state);
    if (v.assetName === "native") {
      // An XLM vault (T-026): worth its XLM at the market's estimate, and payable two ways. When the AMM pays within 3% of
      // the market, the router takes the lumens out and swaps them in the same one transaction (what it can pay: the AMM's
      // quote in the dollar the payment will use, less 2% for the slippage allowance). Otherwise they come out of the vault
      // first and pay from the wallet through the order book, where the liquidity is (the market's value, less 3%).
      const priceIn = config.fundingAssets[0];
      const payIn = config.fundingAssets.find((a) => view.balances.some((b) => b.asset === a)) ?? priceIn;
      const [quote, ammQuote] = await Promise.all([
        priceIn ? sources.quoteXlm(underlying, priceIn) : null,
        payIn && sources.quoteXlmAmm ? sources.quoteXlmAmm(underlying, payIn).catch(() => null) : undefined,
      ]);
      const amm = ammQuote === undefined ? quote : ammQuote;
      const nearMarket = amm !== null && quote !== null && amm * 100n >= quote * 97n;
      const unyield = quote !== null && !nearMarket;
      const canPay = nearMarket ? (amm * 98n) / 100n : quote !== null ? (quote * 97n) / 100n : null;
      return {
        id: `defindex:${v.id}`,
        kind: "defindex",
        asset: "native",
        vault: v.id,
        shares: formatAmount7(shares),
        amount: amount(underlying),
        valueUsd: quote === null ? null : usd(quote),
        ...(canPay === null ? {} : { payableUsd: usd(canPay) }),
        ...(unyield ? { unyield: true as const } : {}),
        pricing: quote === null ? "unpriced" : "estimated",
        payable: quote !== null && canPay !== null && canPay > 0n,
        exit: { steps: 3, slippageBps: config.xlmSlippageBps, estimated: true }, // take out, swap, then the transfer
      };
    }
    const takes = funding.has(v.assetName);
    return {
      id: `defindex:${v.id}`,
      kind: "defindex",
      asset: v.assetName,
      vault: v.id,
      shares: formatAmount7(shares),
      amount: amount(underlying),
      valueUsd: takes ? usd(underlying) : null,
      pricing: takes ? "par" : "unpriced",
      payable: takes && underlying > 0n,
      exit: { steps: 2, slippageBps: 0, estimated: false }, // withdraw an exact amount, then the transfer
    };
  };

  const positions = (await Promise.all([...view.balances.map(balance), ...config.vaults.map(vault)])).filter(
    (p): p is Position => p !== null,
  );

  const total = positions.reduce((sum, p) => {
    if (p.valueUsd === null) return sum;
    const [whole = "0", cents = "0"] = p.valueUsd.split(".");
    return sum + BigInt(whole) * 100n + BigInt(cents);
  }, 0n);
  return {
    account,
    funded: true,
    positions,
    totalUsd: `${total / 100n}.${(total % 100n).toString().padStart(2, "0")}`,
  };
}
