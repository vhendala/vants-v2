// The single transactions behind investing and adding money (T-026), built unsigned for the person's wallet, like exits
// (exit-tx.ts): investing in a DeFindex vault, taking money out of one, opening a trustline so an asset bought by Pix
// can arrive, and buying or selling TESOURO on the order book (T-029). Summaries are what the review screen shows, in plain words (PRODUCT.md: no crypto jargon).
import {
  Address,
  Asset,
  BASE_FEE,
  Contract,
  type Horizon,
  Networks,
  nativeToScVal,
  Operation,
  type rpc,
  type Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { classicAsset, formatAmount7 } from "@vants/adapter-stellar";
import { type ExitTransaction, swapLimit } from "./exit-tx.ts";
import { parseAmount7 } from "./sources.ts";
import { inWords } from "./words.ts";

const i128 = (v: bigint) => nativeToScVal(v, { type: "i128" });
const vec = (v: bigint) => nativeToScVal([v], { type: "i128" });
const hashOf = (tx: Transaction) => Buffer.from(tx.hash()).toString("hex");

export interface VaultTxInput {
  kind: "invest" | "redeem";
  account: string;
  vault: string;
  /** The vault's name as people see it ("Dólar que rende"). */
  vaultName: string;
  /** "USDC" or "XLM": the unit the summary speaks in. */
  unit: string;
  /** invest: what goes in; redeem: what comes out (the asset's 7-decimal units). */
  amount7: bigint;
  /** redeem: the shares burned for it (rounded up so the amount is covered). */
  shares7?: bigint;
}

/**
 * invest: `deposit([amount], [min], from, invest=true)`; redeem: `withdraw(shares, [min], from)`. The minimum allows 0.5%
 * for rounding inside the vault. Simulated so the one envelope signature covers the call (source-account authorization).
 */
export async function buildVaultTransaction(
  input: VaultTxInput,
  deps: { server: rpc.Server; nowSeconds?: () => number; timeoutSeconds?: number },
): Promise<ExitTransaction> {
  const now = deps.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
  const maxTime = now + (deps.timeoutSeconds ?? 300);
  const min = (input.amount7 * 995n) / 1000n;
  const from = new Address(input.account).toScVal();
  const call =
    input.kind === "invest"
      ? new Contract(input.vault).call("deposit", vec(input.amount7), vec(min), from, nativeToScVal(true))
      : new Contract(input.vault).call("withdraw", i128(input.shares7 ?? 0n), vec(min), from);
  const tx = new TransactionBuilder(await deps.server.getAccount(input.account), {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
    timebounds: { minTime: 0, maxTime },
  })
    .addOperation(call)
    .build();
  const prepared = await deps.server.prepareTransaction(tx);
  const summary =
    input.kind === "invest"
      ? [`Investir ${inWords(input.amount7, input.unit)} em ${input.vaultName}`, "O rendimento começa na hora"]
      : [`Resgatar ${inWords(input.amount7, input.unit)} de ${input.vaultName}`, "O valor volta para o seu saldo"];
  return {
    xdr: prepared.toXDR(),
    hash: hashOf(prepared),
    maxTime: Number(prepared.timeBounds?.maxTime ?? maxTime),
    summary,
  };
}

/** A trustline so `asset` (CODE:ISSUER) can arrive in the account: one classic operation, a 0.5 XLM reserve held. */
export async function buildTrustlineTransaction(
  input: { account: string; asset: string; label: string },
  deps: { horizon: Horizon.Server; nowSeconds?: () => number; timeoutSeconds?: number },
): Promise<ExitTransaction> {
  const now = deps.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
  const maxTime = now + (deps.timeoutSeconds ?? 300);
  const [code = "", issuer = ""] = input.asset.split(":");
  const tx = new TransactionBuilder(await deps.horizon.loadAccount(input.account), {
    fee: String(Number(BASE_FEE) * 10),
    networkPassphrase: Networks.TESTNET,
    timebounds: { minTime: 0, maxTime },
  })
    .addOperation(Operation.changeTrust({ asset: new Asset(code, issuer) }))
    .build();
  return {
    xdr: tx.toXDR(),
    hash: hashOf(tx),
    maxTime,
    summary: [`Permitir que sua carteira receba ${input.label}`, "Uma vez só: meio lumen fica reservado na carteira"],
  };
}

export interface TradeTxInput {
  side: "buy" | "sell";
  account: string;
  /** What is bought or sold (TESOURO). */
  asset: string;
  /** buy: what pays for it; sell: what it's sold for ("native" or a dollar the account trusts). */
  other: string;
  /** The dollar that values the trade (Circle USDC, the market maker's side of the book). */
  dollar: string;
  /** The trade's size in that dollar (7 decimals); `all` sells the whole balance instead. */
  value7: bigint;
  all?: boolean;
  /** sell: the balance on hand, which is what `all` sells and what a sale may not pass. */
  held7?: bigint;
  slippageBps: number;
}

/** No path on the order book for this trade now (the market maker's offers are gone or too thin). */
export class NoMarketError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoMarketError";
  }
}

const unitOf = (asset: string) => (asset === "native" ? "XLM" : (asset.split(":")[0] ?? asset));
const pathOf = (records: { path: { asset_type: string; asset_code?: string; asset_issuer?: string }[] }) =>
  records.path.map((p) =>
    p.asset_type === "native" ? Asset.native() : new Asset(p.asset_code ?? "", p.asset_issuer ?? ""),
  );

/**
 * buy: pathPaymentStrictReceive(other → exactly the asset worth `value7` dollars now, sendMax + slippage, to self);
 * sell: pathPaymentStrictSend(exactly the asset worth `value7` dollars, or all of it → other, destMin − slippage, to self).
 * Classic, so it trades on the order book, where Etherfuse's market maker quotes TESOURO against Circle USDC.
 */
export async function buildTradeTransaction(
  input: TradeTxInput,
  deps: { horizon: Horizon.Server; nowSeconds?: () => number; timeoutSeconds?: number },
): Promise<ExitTransaction> {
  const now = deps.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
  const maxTime = now + (deps.timeoutSeconds ?? 300);
  const asset = classicAsset(input.asset);
  const other = classicAsset(input.other);
  const best = <T>(records: T[], by: (r: T) => bigint, most: boolean) =>
    [...records].sort((a, b) => (most ? Number(by(b) - by(a)) : Number(by(a) - by(b))))[0];
  let op: ReturnType<typeof Operation.pathPaymentStrictReceive>;
  let summary: string[];

  if (input.side === "buy") {
    // How much of the asset `value7` dollars buy now: that exact amount is received, whatever pays for it.
    const sized = best(
      (await deps.horizon.strictSendPaths(classicAsset(input.dollar), formatAmount7(input.value7), [asset]).call())
        .records,
      (r) => parseAmount7(r.destination_amount),
      true,
    );
    if (!sized) throw new NoMarketError(`no offers sell ${input.asset} for ${formatAmount7(input.value7)} dollars`);
    const receive7 = parseAmount7(sized.destination_amount);
    const path = best(
      (await deps.horizon.strictReceivePaths([other], asset, formatAmount7(receive7)).call()).records,
      (r) => parseAmount7(r.source_amount),
      false,
    );
    if (!path) throw new NoMarketError(`no path from ${input.other} to ${input.asset}`);
    const sendMax = swapLimit(parseAmount7(path.source_amount), input.slippageBps);
    op = Operation.pathPaymentStrictReceive({
      sendAsset: other,
      sendMax: formatAmount7(sendMax),
      destination: input.account,
      destAsset: asset,
      destAmount: formatAmount7(receive7),
      path: pathOf(path),
    });
    summary = [
      `Comprar ${inWords(receive7, unitOf(input.asset))} com até ${inWords(sendMax, unitOf(input.other))}`,
      "O Tesouro rende em reais, todo dia",
    ];
  } else {
    // How much of the asset makes `value7` dollars now (or all of it), sold exactly; at least the quote less slippage back.
    let sell7 = input.held7 ?? 0n;
    if (!input.all) {
      const sized = best(
        (await deps.horizon.strictReceivePaths([asset], classicAsset(input.dollar), formatAmount7(input.value7)).call())
          .records,
        (r) => parseAmount7(r.source_amount),
        false,
      );
      if (!sized) throw new NoMarketError(`no offers buy ${input.asset} for ${formatAmount7(input.value7)} dollars`);
      sell7 = parseAmount7(sized.source_amount);
      if (input.held7 !== undefined && sell7 > input.held7) sell7 = input.held7; // a rounding hair over: all of it
    }
    if (sell7 <= 0n) throw new NoMarketError(`nothing to sell`);
    const path = best(
      (await deps.horizon.strictSendPaths(asset, formatAmount7(sell7), [other]).call()).records,
      (r) => parseAmount7(r.destination_amount),
      true,
    );
    if (!path) throw new NoMarketError(`no path from ${input.asset} to ${input.other}`);
    const got7 = parseAmount7(path.destination_amount);
    const destMin = got7 - (got7 * BigInt(input.slippageBps) + 9_999n) / 10_000n;
    op = Operation.pathPaymentStrictSend({
      sendAsset: asset,
      sendAmount: formatAmount7(sell7),
      destination: input.account,
      destAsset: other,
      destMin: formatAmount7(destMin),
      path: pathOf(path),
    });
    summary = [
      `Vender ${inWords(sell7, unitOf(input.asset))} por pelo menos ${inWords(destMin, unitOf(input.other))}`,
      "O valor volta para o seu saldo",
    ];
  }
  const tx = new TransactionBuilder(await deps.horizon.loadAccount(input.account), {
    fee: String(Number(BASE_FEE) * 10),
    networkPassphrase: Networks.TESTNET,
    timebounds: { minTime: 0, maxTime },
  })
    .addOperation(op)
    .build();
  return { xdr: tx.toXDR(), hash: hashOf(tx), maxTime, summary };
}
