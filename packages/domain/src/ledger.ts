// §3.7 double-entry ledger (T-005, INV-06). Each posting is signed, in an asset's smallest unit; the postings of any one
// event sum to zero per asset. Accounts:
//   treasury            Vants' Stellar treasury, per asset
//   clearing:<payment>  what Vants owes on one payment: a deposit credits it; the payout and refunds debit it
//   conversion          the bridge between test tokens (funding asset sold ↔ USDH spent): its balances are the PoC's FX position
//   float:hodle         the payout float (USDH on the Hodle sandbox)
//   capital             the owner's side: opening balances and top-ups (T-015)
//   expenses:fees       network fees the treasury paid (T-015)
//   bridge:cctp         USDC burned on Stellar, not yet minted on Base (T-016)
//   base:wallet         USDC on Base Sepolia (the CCTP mint recipient), asset BASE_USDC in 6 decimals (T-016)
//   sandbox:standin     where the sandbox's USDH credit comes from: Hodle mints it for the refill; the bridged USDC itself
//                       stays on Base (§3.7)
// A clearing account is per aggregate: a payment, or a deposit no payment owns (`clearing:<deposit id>`).
import type { EventDraft } from "./events.ts";

export const TREASURY_ACCOUNT = "treasury";
export const CONVERSION_ACCOUNT = "conversion";
export const FLOAT_ACCOUNT = "float:hodle";
export const USDH = "USDH";
export const CAPITAL_ACCOUNT = "capital";
export const FEES_ACCOUNT = "expenses:fees";
export const BRIDGE_ACCOUNT = "bridge:cctp";
export const BASE_WALLET_ACCOUNT = "base:wallet";
export const SANDBOX_STANDIN_ACCOUNT = "sandbox:standin";
/** USDC on Base Sepolia (6 decimals): a different asset from Stellar USDC (7 decimals, keyed by its SAC id). */
export const BASE_USDC = "USDC@base-sepolia";

export interface Posting {
  account: string;
  asset: string;
  amount: bigint;
}

const clearing = (paymentId: string) => `clearing:${paymentId}`;

/** The postings an event implies. Events with no money movement return none. */
export function postingsFor(event: EventDraft): Posting[] {
  const p = event.payload as Record<string, string>;
  const pay = event.aggregate.id;
  switch (event.type) {
    case "LedgerOpened": {
      // The books start from the live balances: each against capital.
      const rows = (event.payload as { balances: { account: string; asset: string; amount: string }[] }).balances;
      return rows.flatMap((b) => [
        { account: b.account, asset: b.asset, amount: BigInt(b.amount) },
        { account: CAPITAL_ACCOUNT, asset: b.asset, amount: -BigInt(b.amount) },
      ]);
    }
    case "UnattributedDeposit": {
      // Money for no payment: held in the deposit's own clearing account until it is refunded.
      const amount = BigInt(p.amount7 ?? "0");
      return [
        { account: TREASURY_ACCOUNT, asset: p.asset ?? "", amount },
        { account: clearing(pay), asset: p.asset ?? "", amount: -amount },
      ];
    }
    case "TreasuryCredited": {
      const amount = BigInt(p.amount7 ?? "0");
      return [
        { account: TREASURY_ACCOUNT, asset: p.asset ?? "", amount },
        { account: CAPITAL_ACCOUNT, asset: p.asset ?? "", amount: -amount },
      ];
    }
    case "CctpBurned": {
      const burned = BigInt(p.burned7 ?? "0");
      return [
        { account: TREASURY_ACCOUNT, asset: p.asset ?? "", amount: -burned },
        { account: BRIDGE_ACCOUNT, asset: p.asset ?? "", amount: burned },
      ];
    }
    case "CctpMinted": {
      // Out of the bridge in Stellar units, into the Base wallet in Base units; the difference (CCTP fee) stays in conversion.
      const burned = BigInt(p.burned7 ?? "0");
      const minted = BigInt(p.minted6 ?? "0");
      return [
        { account: BRIDGE_ACCOUNT, asset: p.asset ?? "", amount: -burned },
        { account: CONVERSION_ACCOUNT, asset: p.asset ?? "", amount: burned },
        { account: CONVERSION_ACCOUNT, asset: BASE_USDC, amount: -minted },
        { account: BASE_WALLET_ACCOUNT, asset: BASE_USDC, amount: minted },
      ];
    }
    case "FloatCredited": {
      const credit = BigInt(p.credit6 ?? "0");
      return [
        { account: FLOAT_ACCOUNT, asset: USDH, amount: credit },
        { account: SANDBOX_STANDIN_ACCOUNT, asset: USDH, amount: -credit },
      ];
    }
    case "TreasuryFeePaid": {
      const amount = BigInt(p.amount7 ?? "0");
      return [
        { account: TREASURY_ACCOUNT, asset: p.asset ?? "", amount: -amount },
        { account: FEES_ACCOUNT, asset: p.asset ?? "", amount },
      ];
    }
    case "DepositMatched": {
      // Every deposit lands in the treasury, used or not; a refund later takes back what isn't used.
      const amount = BigInt(p.amount7 ?? "0");
      return [
        { account: TREASURY_ACCOUNT, asset: p.asset ?? "", amount },
        { account: clearing(pay), asset: p.asset ?? "", amount: -amount },
      ];
    }
    case "PayoutCompleted": {
      const used = BigInt(p.assetAmount7 ?? "0");
      const debit = BigInt(p.debit6 ?? "0");
      return [
        { account: clearing(pay), asset: p.asset ?? "", amount: used },
        { account: CONVERSION_ACCOUNT, asset: p.asset ?? "", amount: -used },
        { account: CONVERSION_ACCOUNT, asset: USDH, amount: debit },
        { account: FLOAT_ACCOUNT, asset: USDH, amount: -debit },
      ];
    }
    case "PayoutReversed": {
      // The Pix came back: the reversed share of the payment is owed to the user again (refunded from the treasury).
      const amount = BigInt(p.amount7 ?? "0");
      return [
        { account: clearing(pay), asset: p.asset ?? "", amount: -amount },
        { account: CONVERSION_ACCOUNT, asset: p.asset ?? "", amount },
      ];
    }
    case "RefundSent": {
      const amount = BigInt(p.amount7 ?? "0");
      return [
        { account: clearing(pay), asset: p.asset ?? "", amount },
        { account: TREASURY_ACCOUNT, asset: p.asset ?? "", amount: -amount },
      ];
    }
    default:
      return [];
  }
}

export function sumByAsset(postings: readonly Posting[]): Map<string, bigint> {
  const sums = new Map<string, bigint>();
  for (const p of postings) sums.set(p.asset, (sums.get(p.asset) ?? 0n) + p.amount);
  return sums;
}

/** Balances keyed by `account|asset`. */
export function balances(postings: readonly Posting[]): Map<string, bigint> {
  const out = new Map<string, bigint>();
  for (const p of postings) {
    const key = `${p.account}|${p.asset}`;
    out.set(key, (out.get(key) ?? 0n) + p.amount);
  }
  return out;
}
