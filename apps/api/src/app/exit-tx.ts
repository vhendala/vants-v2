// The one transaction a mini-app payment needs (SPEC §3.5, DEC-031), built unsigned for the user's wallet:
//   classic route  [pathPaymentStrictReceive XLM|TESOURO → asset, to self]* + payment(asset, exact amount, → M…); with one
//                  swap alone, one pathPaymentStrictReceive straight to M… (no trustline needed)
//   router route   ExitRouter.pay(from, vault?, shares, min_out, swap?, asset SAC, amount, M…), simulated so the payer's single
//                  envelope signature covers the whole call tree (source-account authorization); the XLM leg, if any, is an
//                  exact-output Soroswap swap priced here (DEC-034)
// The submit step accepts only an envelope with this hash, signed (INV-09: Vants never holds the user's key).
import { sharesForUnderlying, underlyingForShares } from "@vants/adapter-defindex";
import { classicAsset, formatAmount7, sacIdOf } from "@vants/adapter-stellar";
import {
  Address,
  Asset,
  BASE_FEE,
  Contract,
  type Horizon,
  Networks,
  nativeToScVal,
  Operation,
  rpc,
  scValToNative,
  type Transaction,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { inWords } from "./words.ts";
import type { ExitPlan } from "./exit-plan.ts";
import { parseAmount7 } from "./sources.ts";

export interface ExitTransaction {
  xdr: string;
  hash: string;
  /** Unix seconds after which it can't land: sign and submit before. */
  maxTime: number;
  /** What the wallet is asked to sign, in plain words. */
  summary: string[];
}

export interface ExitTxDeps {
  horizon: Horizon.Server;
  server: rpc.Server;
  /** The deployed ExitRouter contract (testnet). */
  routerId: string;
  /** The Soroswap router the XLM leg of a router-route payment swaps through (testnet). */
  ammRouterId?: string;
  nowSeconds?: () => number;
  timeoutSeconds?: number;
}

type OkPlan = Extract<ExitPlan, { ok: true }>;

/** Soroswap's router on testnet (github.com/soroswap/core, public/testnet.contracts.json). */
export const SOROSWAP_TESTNET_ROUTER = "CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD";

/** The plan can't be built at today's prices (e.g. the XLM leg costs more XLM than the account can spend): nothing to sign. */
export class ExitBlockedError extends Error {
  readonly reason: "shortfall" | "router_unavailable" | "needs_trustline";
  constructor(reason: "shortfall" | "router_unavailable" | "needs_trustline", message: string) {
    super(message);
    this.name = "ExitBlockedError";
    this.reason = reason;
  }
}

/** The most input a swap may spend: its quoted cost plus the slippage allowance, rounded up. */
export function swapLimit(cost7: bigint, slippageBps: number): bigint {
  return cost7 + (cost7 * BigInt(slippageBps) + 9_999n) / 10_000n;
}

const i128 = (v: bigint) => nativeToScVal(v, { type: "i128" });
const hashOf = (tx: Transaction) => Buffer.from(tx.hash()).toString("hex");

export async function buildExitTransaction(
  plan: OkPlan,
  ctx: { account: string; asset: string; deposit: string },
  deps: ExitTxDeps,
): Promise<ExitTransaction> {
  const now = deps.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
  const maxTime = now + (deps.timeoutSeconds ?? 300);
  const asset = classicAsset(ctx.asset);
  const code = ctx.asset.split(":")[0] ?? ctx.asset;

  if (plan.route === "classic") {
    const source = await deps.horizon.loadAccount(ctx.account);
    const ops: xdr.Operation[] = [];
    const summary: string[] = [];
    // One swap alone (XLM or TESOURO): one path payment delivers the exact amount straight to the deposit address, so the user
    // needs no trustline to the asset (a wallet funded only by Friendbot has none). Mixed, the swaps go to self, then one
    // payment, which needs the trustline: say so instead of building a transaction that can only fail.
    const direct = plan.fromBalance7 === 0n && plan.swaps.length === 1;
    if (!direct && plan.swaps.length > 0) {
      const trusts = source.balances.some(
        (b) => "asset_code" in b && "asset_issuer" in b && `${b.asset_code}:${b.asset_issuer}` === ctx.asset,
      );
      if (!trusts) throw new ExitBlockedError("needs_trustline", `${ctx.account} has no trustline to ${ctx.asset}`);
    }
    for (const swap of plan.swaps) {
      // The exact amount this receive costs now, along the best path, plus the slippage allowance.
      const from = classicAsset(swap.from);
      const fromCode = swap.from === "native" ? "XLM" : (swap.from.split(":")[0] ?? swap.from);
      const page = await deps.horizon.strictReceivePaths([from], asset, formatAmount7(swap.receive7)).call();
      const best = page.records.sort((a, b) =>
        Number(parseAmount7(a.source_amount) - parseAmount7(b.source_amount)),
      )[0];
      if (!best)
        throw new ExitBlockedError(
          "shortfall",
          `no path from ${swap.from} to ${ctx.asset} for ${formatAmount7(swap.receive7)}`,
        );
      const sendMax = swapLimit(parseAmount7(best.source_amount), swap.slippageBps);
      ops.push(
        Operation.pathPaymentStrictReceive({
          sendAsset: from,
          sendMax: formatAmount7(sendMax),
          destination: direct ? ctx.deposit : ctx.account,
          destAsset: asset,
          destAmount: formatAmount7(swap.receive7),
          path: best.path.map((p) =>
            p.asset_type === "native" ? Asset.native() : new Asset(p.asset_code, p.asset_issuer),
          ),
        }),
      );
      summary.push(
        direct
          ? `Enviar ${inWords(swap.receive7, code)} para a Vants pagar o Pix, usando até ${inWords(sendMax, fromCode)}`
          : `Trocar até ${inWords(sendMax, fromCode)} por ${inWords(swap.receive7, code)}`,
      );
    }
    if (!direct) {
      ops.push(Operation.payment({ destination: ctx.deposit, asset, amount: formatAmount7(plan.amount7) }));
      summary.push(`Enviar ${inWords(plan.amount7, code)} para a Vants pagar o Pix`);
    }
    const builder = new TransactionBuilder(source, {
      fee: String(Number(BASE_FEE) * ops.length * 10),
      networkPassphrase: Networks.TESTNET,
      timebounds: { minTime: 0, maxTime },
    });
    for (const op of ops) builder.addOperation(op);
    const tx = builder.build();
    return { xdr: tx.toXDR(), hash: hashOf(tx), maxTime, summary };
  }

  const w = plan.withdraw;
  const source = await deps.server.getAccount(ctx.account);
  const sac = sacIdOf(asset);
  let swapArg: xdr.ScVal = xdr.ScVal.scvVoid();
  let swapLine: string[] = [];
  // What leaves the vault: an exact amount of the quote asset (a dollar vault), or the lumens the swap needs (the XLM vault,
  // sized below from the AMM's own quote).
  let out: { shares7: bigint; minOut7: bigint; lumens: boolean } | null =
    w && "shares7" in w ? { shares7: w.shares7, minOut7: w.minOut7, lumens: false } : null;
  if (plan.swap) {
    // The AMM pays the swap's output into the payer's own account before the router's transfer: a classic asset needs the
    // account's trustline, so say so instead of building a transaction that can only fail.
    const held = await deps.horizon.loadAccount(ctx.account);
    const trusts = held.balances.some(
      (b) => "asset_code" in b && "asset_issuer" in b && `${b.asset_code}:${b.asset_issuer}` === ctx.asset,
    );
    if (!trusts) throw new ExitBlockedError("needs_trustline", `${ctx.account} has no trustline to ${ctx.asset}`);
    const amm = deps.ammRouterId;
    if (!amm) throw new ExitBlockedError("router_unavailable", "no AMM configured for the XLM leg");
    const path = [sacIdOf(classicAsset("native")), sac];
    const cost = await ammAmountIn(deps.server, ctx.account, amm, plan.swap.receive7, path);
    const inMax = swapLimit(cost, plan.swap.slippageBps);
    if (inMax > plan.swap.spendable7) {
      throw new ExitBlockedError(
        "shortfall",
        `${formatAmount7(plan.swap.receive7)} ${code} costs up to ${formatAmount7(inMax)} XLM on the AMM; ${formatAmount7(plan.swap.spendable7)} spendable`,
      );
    }
    if (w && "lumensFor7" in w) {
      // The vault's share of the lumens the swap may spend, rounded up; never more than the account has invested.
      const lumens7 = (inMax * w.lumensFor7 + plan.swap.receive7 - 1n) / plan.swap.receive7;
      if (lumens7 > underlyingForShares(w.heldShares7, w.state))
        throw new ExitBlockedError(
          "shortfall",
          `the swap needs ${formatAmount7(lumens7)} XLM from the vault; ${formatAmount7(underlyingForShares(w.heldShares7, w.state))} invested`,
        );
      const shares7 = sharesForUnderlying(lumens7, w.state);
      out = { shares7: lesser(shares7, w.heldShares7), minOut7: lumens7, lumens: true };
    }
    swapArg = xdr.ScVal.scvMap([
      // A contracttype struct is a map with its fields in name order.
      entry("amount_in_max", i128(inMax)),
      entry("amount_out", i128(plan.swap.receive7)),
      entry("deadline", nativeToScVal(BigInt(maxTime), { type: "u64" })),
      entry("path", xdr.ScVal.scvVec(path.map((id) => new Address(id).toScVal()))),
      entry("router", new Address(amm).toScVal()),
    ]);
    swapLine = [`Trocar até ${inWords(inMax, "XLM")} por ${inWords(plan.swap.receive7, code)}`];
  }
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
    timebounds: { minTime: 0, maxTime },
  })
    .addOperation(
      new Contract(deps.routerId).call(
        "pay",
        new Address(ctx.account).toScVal(),
        w ? new Address(w.vault).toScVal() : xdr.ScVal.scvVoid(),
        i128(out?.shares7 ?? 0n),
        i128(out?.minOut7 ?? 0n),
        swapArg,
        new Address(sac).toScVal(),
        i128(plan.amount7),
        new Address(ctx.deposit).toScVal(), // M…: a MuxedAddress, so the transfer event carries the payment's id
      ),
    )
    .build();
  const prepared = await deps.server.prepareTransaction(tx); // simulation: footprint, fee, and the auth tree for the payer
  const summary = [
    ...(out
      ? [
          out.lumens
            ? `Resgatar ${inWords(out.minOut7, "XLM")} de Lumens que rendem`
            : `Resgatar ${inWords(out.minOut7, code)} do seu Dólar que rende`,
        ]
      : []),
    ...swapLine,
    `Enviar ${inWords(plan.amount7, code)} para a Vants pagar o Pix`,
  ];
  return {
    xdr: prepared.toXDR(),
    hash: hashOf(prepared),
    maxTime: Number(prepared.timeBounds?.maxTime ?? maxTime),
    summary,
  };
}

/** The smaller of two bigints (Math.min takes numbers only). */
const lesser = (a: bigint, b: bigint) => (a < b ? a : b);

const entry = (key: string, val: xdr.ScVal) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val });

/** What exactly `amountOut` of the path's last token costs in its first, read by simulating the AMM's own quote. */
async function ammAmountIn(
  server: rpc.Server,
  account: string,
  amm: string,
  amountOut: bigint,
  path: string[],
): Promise<bigint> {
  const tx = new TransactionBuilder(await server.getAccount(account), {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      new Contract(amm).call(
        "router_get_amounts_in",
        i128(amountOut),
        xdr.ScVal.scvVec(path.map((id) => new Address(id).toScVal())),
      ),
    )
    .setTimeout(60)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result)
    throw new ExitBlockedError("shortfall", `the AMM can't quote ${formatAmount7(amountOut)} out of ${path.at(-1)}`);
  const amounts = scValToNative(sim.result.retval) as bigint[];
  return BigInt(amounts[0] ?? 0n);
}
