// DeFindex vaults on testnet, read directly on Soroban (ported from the spike, `src/defindex/vault.ts`). Direct calls need no API
// key; the DeFindex API's testnet indexer was down when the spike ran (2026-10-22). Reads are simulations, never submitted.
// Contract ids re-checked against paltalabs/defindex `public/testnet.contracts.json` on 2026-10-23.
import {
  Account,
  Address,
  Contract,
  Networks,
  nativeToScVal,
  rpc,
  scValToNative,
  TransactionBuilder,
  type xdr,
} from "@stellar/stellar-sdk";

export const DEFINDEX_TESTNET = {
  factory: "CDSCWE4GLNBYYTES2OCYDFQA2LLY4RBIAX6ZI32VSUXD7GO6HRPO4A32",
  /** `usdc_paltalabs_vault`: Blend's testnet USDC through the Blend strategy. */
  usdcVault: "CBMVK2JK6NTOT2O4HNQAIQFJY232BHKGLIMXDVQVHIIZKDACXDFZDWHN",
  usdcBlendStrategy: "CALLOM5I7XLQPPOPQMYAHUWW4N7O3JKT42KQ4ASEEVBXDJQNJOALFSUY",
  /** The vault's asset: Blend's testnet USDC (not Circle's, which CCTP uses). */
  blendUsdc: "USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56",
  /** "Vants XLM Yield": native XLM through a Blend fixed-pool strategy (deployed for earlier prototype; T-026). */
  xlmVault: "CD72HOSTSKA2KA4RMVOKVARM7SXBJ7IV54NCPJEEY4ZWOXOQPVFC5SIJ",
} as const;

/** The vaults the mini app offers for investing (T-026), each with its asset and the name people see. */
export const INVEST_VAULTS = [
  { id: DEFINDEX_TESTNET.usdcVault, assetName: DEFINDEX_TESTNET.blendUsdc, name: "Dólar que rende" },
  { id: DEFINDEX_TESTNET.xlmVault, assetName: "native", name: "Lumens que rendem" },
] as const;

/**
 * The DeFindex API, for what the contracts can't say on their own: a vault's annual yield. Server-side (the key is a bearer
 * token). Every call names the network: without it the API silently answers for mainnet (earlier prototype `lib/defindex/client.ts`).
 */
export class DefindexApi {
  readonly #baseUrl: string;
  readonly #apiKey: string;

  constructor(opts: { baseUrl: string; apiKey: string }) {
    this.#baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.#apiKey = opts.apiKey;
  }

  /** Annual yield as a percentage (12.27 = 12.27% a year), or null when the API has none. */
  async apyPercent(vault: string): Promise<number | null> {
    const res = await fetch(`${this.#baseUrl}/vault/${encodeURIComponent(vault)}/apy?network=testnet`, {
      headers: { authorization: `Bearer ${this.#apiKey}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`DeFindex ${res.status} on /vault/${vault}/apy`);
    const body = (await res.json()) as { apy?: number | null };
    return typeof body.apy === "number" ? body.apy : null;
  }
}

export interface VaultState {
  /** Total dfToken (share) supply, 7 decimals. */
  totalSupply: bigint;
  /** Underlying the vault manages (idle + invested), in the asset's 7-decimal units. */
  totalAmount: bigint;
  idle: bigint;
  invested: bigint;
  /** The asset's contract id. */
  asset: string;
}

/** Underlying value of `shares`, rounded down: what a withdraw of them pays (no withdraw fee is documented). */
export function underlyingForShares(shares: bigint, s: Pick<VaultState, "totalSupply" | "totalAmount">): bigint {
  if (s.totalSupply === 0n) return 0n;
  return (shares * s.totalAmount) / s.totalSupply;
}

/** Shares worth at least `amount`, rounded up so a withdraw always covers it. DeFindex's formula: total_supply × amount ÷ total_amount. */
export function sharesForUnderlying(amount: bigint, s: Pick<VaultState, "totalSupply" | "totalAmount">): bigint {
  if (s.totalAmount === 0n) throw new Error("vault has no managed funds");
  return (amount * s.totalSupply + s.totalAmount - 1n) / s.totalAmount;
}

/** Read-only vault calls, simulated with `reader` as the transaction source (any funded account; nothing is signed). */
export class DefindexReader {
  readonly #server: rpc.Server;
  readonly #reader: string;

  constructor(opts: { server: rpc.Server; reader: string }) {
    this.#server = opts.server;
    this.#reader = opts.reader;
  }

  async state(vault: string): Promise<VaultState> {
    const [totalSupply, funds] = await Promise.all([
      this.#read<bigint>(vault, "total_supply", []),
      this.#read<{ asset: string; idle_amount: bigint; invested_amount: bigint; total_amount: bigint }[]>(
        vault,
        "fetch_total_managed_funds",
        [],
      ),
    ]);
    const f = funds[0];
    if (!f) throw new Error(`vault ${vault} manages no asset`);
    return {
      totalSupply: BigInt(totalSupply),
      totalAmount: BigInt(f.total_amount),
      idle: BigInt(f.idle_amount),
      invested: BigInt(f.invested_amount),
      asset: f.asset,
    };
  }

  /** The vault's own share → asset conversion (`get_asset_amounts_per_shares`), for cross-checking our maths. */
  async amountsForShares(vault: string, shares: bigint): Promise<bigint[]> {
    const out = await this.#read<bigint[]>(vault, "get_asset_amounts_per_shares", [
      nativeToScVal(shares, { type: "i128" }),
    ]);
    return out.map((v) => BigInt(v));
  }

  /** dfToken balance (SEP-41 `balance`). */
  async shares(vault: string, owner: string): Promise<bigint> {
    return BigInt(await this.#read<bigint>(vault, "balance", [new Address(owner).toScVal()]));
  }

  async #read<T>(contractId: string, method: string, args: xdr.ScVal[]): Promise<T> {
    const tx = new TransactionBuilder(new Account(this.#reader, "0"), {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(new Contract(contractId).call(method, ...args))
      .setTimeout(30)
      .build();
    const sim = await this.#server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw new Error(`simulate ${method} on ${contractId}: ${sim.error}`);
    if (!sim.result) throw new Error(`simulate ${method} on ${contractId} returned no result`);
    return scValToNative(sim.result.retval) as T;
  }
}

/** For callers that need an i128 vector (withdraw's min_amounts_out, T-019). */
export const vecI128 = (values: bigint[]) => nativeToScVal(values.map((v) => nativeToScVal(v, { type: "i128" })));
