// The mini app's live network (T-020): Horizon, Stellar RPC, DeFindex reads and host wallets' stellar.toml. Testnet only.
// T-026 adds investing (DeFindex vaults, yields from the DeFindex API) and adding money by Pix (Etherfuse sandbox).
import { DefindexApi, DefindexReader, INVEST_VAULTS } from "@vants/adapter-defindex";
import { EtherfuseClient, RAMP_TARGETS } from "@vants/adapter-etherfuse";
import type { ApiConfig } from "@vants/config";
import { Horizon, Networks, NotFoundError, rpc, StellarToml, StrKey, TransactionBuilder } from "@stellar/stellar-sdk";
import { buildExitTransaction, SOROSWAP_TESTNET_ROUTER } from "./exit-tx.ts";
import { buildTradeTransaction, buildTrustlineTransaction, buildVaultTransaction } from "./money-tx.ts";
import { readPortfolio } from "./portfolio.ts";
import { shared } from "./reuse.ts";
import type { AppPorts } from "./routes.ts";
import { stellarPortfolioSources } from "./sources.ts";

/**
 * What one TESOURO is worth in reais when the order book can't say (T-029 prices it from the book first): the Etherfuse
 * sandbox quoted 0.8566 TESOURO per real on 2026-10-23 (docs/SOURCES.md). Shown as an estimate, never paid from.
 */
const TESOURO_BRL = 1 / 0.8566;

export function liveAppPorts(config: ApiConfig): AppPorts {
  const horizon = new Horizon.Server(config.stellar.horizonUrl);
  const server = new rpc.Server(config.stellar.rpcUrl);
  const vaults = new DefindexReader({ server, reader: config.treasuryAccount });
  const rate = Number(config.pricing.rateBrlPerUsd);
  // T-039 (DEC-056): the app opens several screens' reads at once (portfolio, invest, activity), and each reads the same
  // chain state. Reads of the same thing in flight together run once. The account, its shares and a vault's totals are
  // never kept after the read (paying and redeeming build transactions from them); quotes, which are estimates, are
  // kept 15 s, and a vault's yield 5 min.
  const vaultState = shared((vault: string) => vaults.state(vault));
  const shares = shared((vault: string, owner: string) => vaults.shares(vault, owner));
  const live = stellarPortfolioSources({
    horizon,
    server,
    reader: config.treasuryAccount,
    ammRouter: SOROSWAP_TESTNET_ROUTER,
  });
  const QUOTE_TTL_MS = 15_000;
  const { quoteSend, quoteXlmAmm } = live;
  const sources = {
    account: shared(live.account),
    vaultState,
    shares,
    quoteXlm: shared(live.quoteXlm, { ttlMs: QUOTE_TTL_MS }),
    ...(quoteSend ? { quoteSend: shared(quoteSend, { ttlMs: QUOTE_TTL_MS }) } : {}),
    ...(quoteXlmAmm ? { quoteXlmAmm: shared(quoteXlmAmm, { ttlMs: QUOTE_TTL_MS }) } : {}),
    async valueUsd7(asset: string, amount7: bigint) {
      if (asset !== RAMP_TARGETS.TESOURO || !(rate > 0)) return null;
      return BigInt(Math.floor((Number(amount7) * TESOURO_BRL) / rate));
    },
  };
  const defindexApi = config.defindex ? new DefindexApi(config.defindex) : null;
  const vaultApy = defindexApi
    ? shared((vault: string) => defindexApi.apyPercent(vault), { ttlMs: 5 * 60_000 })
    : async () => null;
  const ramp = config.etherfuse ? new EtherfuseClient(config.etherfuse) : null;
  const submit = async (signedXdr: string) => {
    const sent = await server.sendTransaction(TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET));
    return sent.status === "ERROR"
      ? { status: "ERROR", error: sent.errorResult?.toXDR("base64") ?? "rejected" }
      : { status: sent.status };
  };
  const portfolioConfig = {
    fundingAssets: config.fundingAssets,
    swapAssets: [RAMP_TARGETS.TESOURO],
    vaults: INVEST_VAULTS.map((v) => ({ id: v.id, assetName: v.assetName })),
    xlmFeeBuffer7: 10_000_000n,
    xlmSlippageBps: 100,
  };
  const portfolio = shared((account: string) => readPortfolio(account, sources, portfolioConfig));
  return {
    async accountSigners(account) {
      try {
        const a = await horizon.loadAccount(account);
        return {
          thresholds: {
            low: a.thresholds.low_threshold,
            med: a.thresholds.med_threshold,
            high: a.thresholds.high_threshold,
          },
          signers: a.signers.map((s) => ({ key: s.key, weight: s.weight, type: s.type })),
        };
      } catch (err) {
        if (err instanceof NotFoundError) return null;
        throw err;
      }
    },
    async clientSigningKey(domain) {
      const toml = await StellarToml.Resolver.resolve(domain, { timeout: 5_000 });
      const key = toml.SIGNING_KEY;
      if (typeof key !== "string" || !StrKey.isValidEd25519PublicKey(key))
        throw new Error(`${domain} publishes no SIGNING_KEY`);
      return key;
    },
    portfolio,
    vaultStates: async () =>
      new Map(await Promise.all(INVEST_VAULTS.map(async (v) => [v.id, await vaultState(v.id)] as const))),
    buildTx: (plan, ctx, maxTime) =>
      buildExitTransaction(plan, ctx, {
        horizon,
        server,
        routerId: config.exitRouterId ?? "",
        ammRouterId: SOROSWAP_TESTNET_ROUTER,
        timeoutSeconds: maxTime - Math.floor(Date.now() / 1000),
      }),
    submit,
    money: {
      portfolio,
      vaultState,
      shares,
      vaultApy,
      buildVaultTx: (input) => buildVaultTransaction(input, { server }),
      buildTrustlineTx: (input) => buildTrustlineTransaction(input, { horizon }),
      buildTradeTx: (input) => buildTradeTransaction(input, { horizon }),
      async hasTrustline(account, asset) {
        try {
          const a = await horizon.loadAccount(account);
          return a.balances.some(
            (b) => "asset_code" in b && "asset_issuer" in b && `${b.asset_code}:${b.asset_issuer}` === asset,
          );
        } catch (err) {
          if (err instanceof NotFoundError) return false;
          throw err;
        }
      },
      submit,
      async txStatus(hash) {
        const r = await server.getTransaction(hash);
        return r.status === rpc.Api.GetTransactionStatus.SUCCESS
          ? "success"
          : r.status === rpc.Api.GetTransactionStatus.FAILED
            ? "failed"
            : "pending";
      },
      ...(ramp ? { ramp } : {}),
    },
  };
}
