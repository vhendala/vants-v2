// pnpm portfolio <G…>: the mini app's portfolio for an account, read live from testnet (T-018). Read-only.
import { DEFINDEX_TESTNET } from "@vants/adapter-defindex";
import { loadApiConfig } from "@vants/config";
import { Horizon, rpc, StrKey } from "@stellar/stellar-sdk";
import { readPortfolio } from "./app/portfolio.ts";
import { stellarPortfolioSources } from "./app/sources.ts";

const account = process.argv[2] ?? "";
if (!StrKey.isValidEd25519PublicKey(account)) throw new Error("usage: pnpm portfolio <G… account>");
const config = loadApiConfig();
const p = await readPortfolio(
  account,
  stellarPortfolioSources({
    horizon: new Horizon.Server(config.stellar.horizonUrl),
    server: new rpc.Server(config.stellar.rpcUrl),
    reader: config.treasuryAccount,
  }),
  {
    fundingAssets: config.fundingAssets,
    vaults: [{ id: DEFINDEX_TESTNET.usdcVault, assetName: DEFINDEX_TESTNET.blendUsdc }],
    xlmFeeBuffer7: 10_000_000n,
    xlmSlippageBps: 100,
  },
);
console.log(JSON.stringify(p, null, 2));
