// @vants/domain: Pure domain: Payment, Exit and Float state machines, pricing, ledger postings, event types. No I/O (SPEC §3.2, §3.8).
export { formatAmount7, formatBrl, formatRate } from "./amounts.ts";
export type { AggregateRef, DomainEvent, EventDraft } from "./events.ts";
export {
  BASE_USDC,
  BASE_WALLET_ACCOUNT,
  BRIDGE_ACCOUNT,
  balances,
  CAPITAL_ACCOUNT,
  CONVERSION_ACCOUNT,
  FEES_ACCOUNT,
  FLOAT_ACCOUNT,
  type Posting,
  postingsFor,
  SANDBOX_STANDIN_ACCOUNT,
  sumByAsset,
  TREASURY_ACCOUNT,
  USDH,
} from "./ledger.ts";
export {
  type Decision,
  type Deposit,
  type DepositKind,
  decide,
  InvalidTransition,
  isSettled,
  newPayment,
  type Payment,
  type PaymentInput,
  type PaymentQuote,
  type PaymentStatus,
  type Refund,
  type RefundReason,
} from "./payment.ts";
export {
  exactUsdhDeposit,
  type FeeModel,
  type FloatPolicy,
  hodleFeeCents,
  type PricedQuote,
  payoutDebit6,
  priceQuote,
  rateToMicros,
  topUpNeeded,
} from "./pricing.ts";
export { paymentFromJson, paymentToJson } from "./serialize.ts";
