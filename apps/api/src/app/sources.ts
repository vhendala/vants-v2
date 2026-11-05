// The portfolio's live sources on testnet (T-018): Horizon for accounts and strict-send paths, Soroban simulation for DeFindex
// vaults. Read-only (DEC-016: api may read Stellar state).
import { DefindexReader } from "@vants/adapter-defindex";
import { classicAsset, formatAmount7, sacIdOf } from "@vants/adapter-stellar";
import {
  Address,
  BASE_FEE,
  Contract,
  type Horizon,
  Networks,
  NotFoundError,
  nativeToScVal,
  rpc,
  scValToNative,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import type { ClassicBalance, PortfolioSources } from "./portfolio.ts";

/** Horizon's "12.3456789" → 123456789n. */
export function parseAmount7(value: string): bigint {
  const [whole = "0", frac = ""] = value.split(".");
  return BigInt(whole) * 10_000_000n + BigInt(frac.padEnd(7, "0").slice(0, 7));
}

export function stellarPortfolioSources(opts: {
  horizon: Horizon.Server;
  server: rpc.Server;
  reader: string;
  /** The Soroban AMM router the exit router swaps on (Soroswap): prices lumens taken out of a vault (T-026). */
  ammRouter?: string;
}): PortfolioSources {
  const vaults = new DefindexReader({ server: opts.server, reader: opts.reader });
  return {
    async account(account) {
      let a: Horizon.AccountResponse;
      try {
        a = await opts.horizon.loadAccount(account);
      } catch (err) {
        if (err instanceof NotFoundError) return null;
        throw err;
      }
      const balances: ClassicBalance[] = a.balances.flatMap((b) => {
        const name =
          b.asset_type === "native"
            ? "native"
            : "asset_code" in b && "asset_issuer" in b
              ? `${b.asset_code}:${b.asset_issuer}`
              : null; // liquidity pool shares aren't payable
        if (!name) return [];
        const selling = "selling_liabilities" in b ? b.selling_liabilities : "0";
        return [{ asset: name, balance7: parseAmount7(b.balance), sellingLiabilities7: parseAmount7(selling) }];
      });
      return {
        balances,
        subentryCount: a.subentry_count,
        numSponsoring: a.num_sponsoring ?? 0,
        numSponsored: a.num_sponsored ?? 0,
      };
    },
    vaultState: (vault) => vaults.state(vault),
    shares: (vault, owner) => vaults.shares(vault, owner),
    quoteXlm: (amount7, toAsset) => quoteSend(opts.horizon, "native", amount7, toAsset),
    quoteSend: (fromAsset, amount7, toAsset) => quoteSend(opts.horizon, fromAsset, amount7, toAsset),
    ...(opts.ammRouter
      ? {
          async quoteXlmAmm(amount7: bigint, toAsset: string) {
            // The AMM's own quote for an exact input, by simulation (read-only; nothing is signed).
            const path = [sacIdOf(classicAsset("native")), sacIdOf(classicAsset(toAsset))];
            const tx = new TransactionBuilder(await opts.server.getAccount(opts.reader), {
              fee: BASE_FEE,
              networkPassphrase: Networks.TESTNET,
            })
              .addOperation(
                new Contract(opts.ammRouter ?? "").call(
                  "router_get_amounts_out",
                  nativeToScVal(amount7, { type: "i128" }),
                  xdr.ScVal.scvVec(path.map((id) => new Address(id).toScVal())),
                ),
              )
              .setTimeout(60)
              .build();
            const sim = await opts.server.simulateTransaction(tx);
            if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) return null;
            const out = BigInt((scValToNative(sim.result.retval) as bigint[]).at(-1) ?? 0n);
            return out > 0n ? out : null;
          },
        }
      : {}),
  };
}

/** The most `toAsset` a strict-send of `amount7` of `fromAsset` delivers along the order book's best path, or null. */
async function quoteSend(
  horizon: Horizon.Server,
  fromAsset: string,
  amount7: bigint,
  toAsset: string,
): Promise<bigint | null> {
  const page = await horizon
    .strictSendPaths(classicAsset(fromAsset), formatAmount7(amount7), [classicAsset(toAsset)])
    .call();
  const best = page.records
    .map((r) => parseAmount7(r.destination_amount))
    .reduce<bigint | null>((m, v) => (m === null || v > m ? v : m), null);
  return best !== null && best > 0n ? best : null;
}
