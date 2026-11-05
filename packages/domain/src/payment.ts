// §3.4 the payment state machine (T-005). `decide` is pure: given the payment and one input it returns the next payment
// and the event drafts to publish. Every deposit either funds the payment or is refunded (INV-01, INV-03, INV-10, INV-11).
import type { EventDraft } from "./events.ts";

export type PaymentStatus =
  | "awaiting_deposit"
  | "funded"
  | "paying"
  | "completed"
  | "refunding"
  | "refunded"
  | "expired";

export interface PaymentQuote {
  /** SAC contract id of the funding asset. */
  asset: string;
  assetAmount7: bigint;
  valueCents: number;
  feeCents: number;
  rateMicros: bigint;
  /** ISO time; a deposit whose ledger closed after it is late. */
  expiresAt: string;
}

export type DepositKind = "exact" | "over" | "under" | "late" | "wrong_asset" | "unexpected";

export interface Deposit {
  id: string;
  asset: string;
  amount7: bigint;
  from: string;
  txHash: string;
  ledgerClosedAt: string;
  kind: DepositKind;
}

export type RefundReason = "over" | "under" | "late" | "wrong_asset" | "unexpected" | "payout_failed" | "reversed";

export interface Refund {
  id: string;
  asset: string;
  amount7: bigint;
  to: string;
  reason: RefundReason;
  status: "requested" | "sent";
  txHash?: string;
}

export interface Payment {
  id: string;
  /** u64 as a decimal string: the treasury muxed-address id deposits are matched by (DEC-004). */
  muxId: string;
  status: PaymentStatus;
  version: number;
  quote: PaymentQuote;
  refundTo?: string;
  deposits: Deposit[];
  payout?: { transactionId: string; endToEndId: string; txHash: string; debit6: bigint };
  refunds: Refund[];
  reversals: string[];
}

export type PaymentInput =
  | {
      type: "deposit.observed";
      depositId: string;
      asset: string;
      amount7: bigint;
      from: string;
      ledgerClosedAt: string;
      txHash: string;
    }
  | { type: "payout.started" }
  | { type: "payout.succeeded"; transactionId: string; endToEndId: string; txHash: string; debit6: bigint }
  | { type: "payout.failed"; reason: string }
  | { type: "payout.reversed"; reversalId: string; returnedCents: number }
  | { type: "deposit.timeout" }
  | { type: "refund.sent"; refundId: string; txHash: string };

export interface Decision {
  payment: Payment;
  events: EventDraft[];
}

export class InvalidTransition extends Error {
  readonly status: PaymentStatus;
  readonly input: PaymentInput["type"];

  constructor(status: PaymentStatus, input: PaymentInput["type"], detail = "") {
    super(`payment in ${status} cannot take ${input}${detail ? `: ${detail}` : ""}`);
    this.name = "InvalidTransition";
    this.status = status;
    this.input = input;
  }
}

export function newPayment(init: { id: string; muxId: string; quote: PaymentQuote; refundTo?: string }): Payment {
  return {
    id: init.id,
    muxId: init.muxId,
    status: "awaiting_deposit",
    version: 0,
    quote: init.quote,
    ...(init.refundTo ? { refundTo: init.refundTo } : {}),
    deposits: [],
    refunds: [],
    reversals: [],
  };
}

const TERMINAL: ReadonlySet<PaymentStatus> = new Set(["completed", "refunded", "expired"]);

/** Terminal status and no refund left to send: nothing more will move for this payment (INV-03). */
export function isSettled(p: Payment): boolean {
  return TERMINAL.has(p.status) && p.refunds.every((r) => r.status === "sent");
}

const str = (v: bigint) => v.toString();

export function decide(p: Payment, input: PaymentInput, causationId: string | null = null): Decision {
  const events: EventDraft[] = [];
  const emit = (type: string, payload: object) =>
    events.push({
      type,
      version: 1,
      aggregate: { type: "payment", id: p.id },
      correlationId: p.id,
      causationId,
      payload,
    });
  const unchanged: Decision = { payment: p, events: [] };
  const changed = (next: Omit<Payment, "version">): Decision => ({
    payment: { ...next, version: p.version + 1 },
    events,
  });

  const requestRefund = (refunds: Refund[], asset: string, amount7: bigint, to: string, reason: RefundReason) => {
    const refund: Refund = { id: `${p.id}:rf${refunds.length + 1}`, asset, amount7, to, reason, status: "requested" };
    emit("RefundRequested", { refundId: refund.id, asset, amount7: str(amount7), to, reason });
    return [...refunds, refund];
  };

  switch (input.type) {
    case "deposit.observed": {
      if (p.deposits.some((d) => d.id === input.depositId)) return unchanged; // INV-04
      const q = p.quote;
      const to = p.refundTo ?? input.from;
      let kind: DepositKind;
      if (p.status !== "awaiting_deposit") kind = "unexpected";
      else if (input.asset !== q.asset) kind = "wrong_asset";
      else if (Date.parse(input.ledgerClosedAt) > Date.parse(q.expiresAt)) kind = "late";
      else if (input.amount7 < q.assetAmount7) kind = "under";
      else kind = input.amount7 === q.assetAmount7 ? "exact" : "over";

      const deposit: Deposit = {
        id: input.depositId,
        asset: input.asset,
        amount7: input.amount7,
        from: input.from,
        txHash: input.txHash,
        ledgerClosedAt: input.ledgerClosedAt,
        kind,
      };
      emit("DepositMatched", {
        kind,
        depositId: deposit.id,
        asset: deposit.asset,
        amount7: str(deposit.amount7),
        from: deposit.from,
        txHash: deposit.txHash,
        ledgerClosedAt: deposit.ledgerClosedAt,
      });
      const deposits = [...p.deposits, deposit];

      if (kind === "exact" || kind === "over") {
        emit("PayoutRequested", {
          valueCents: q.valueCents,
          feeCents: q.feeCents,
          asset: q.asset,
          assetAmount7: str(q.assetAmount7),
        });
        const refunds =
          kind === "over"
            ? requestRefund(p.refunds, input.asset, input.amount7 - q.assetAmount7, to, "over")
            : p.refunds;
        return changed({ ...p, status: "funded", deposits, refunds });
      }
      const refunds = requestRefund(p.refunds, input.asset, input.amount7, to, kind);
      const status = p.status === "awaiting_deposit" ? "refunding" : p.status;
      return changed({ ...p, status, deposits, refunds });
    }

    case "payout.started": {
      if (p.status === "paying") return unchanged;
      if (p.status !== "funded") throw new InvalidTransition(p.status, input.type);
      return changed({ ...p, status: "paying" });
    }

    case "payout.succeeded": {
      if (p.status === "completed") return unchanged;
      if (p.status !== "funded" && p.status !== "paying") throw new InvalidTransition(p.status, input.type);
      const payout = {
        transactionId: input.transactionId,
        endToEndId: input.endToEndId,
        txHash: input.txHash,
        debit6: input.debit6,
      };
      emit("PayoutCompleted", {
        transactionId: payout.transactionId,
        endToEndId: payout.endToEndId,
        txHash: payout.txHash,
        asset: p.quote.asset,
        assetAmount7: str(p.quote.assetAmount7),
        debit6: str(payout.debit6),
      });
      emit("PaymentCompleted", {});
      return changed({ ...p, status: "completed", payout });
    }

    case "payout.failed": {
      if (p.status !== "funded" && p.status !== "paying") throw new InvalidTransition(p.status, input.type);
      emit("PayoutFailed", { reason: input.reason });
      const funding = p.deposits.find((d) => d.kind === "exact" || d.kind === "over");
      if (!funding) throw new InvalidTransition(p.status, input.type, "no funding deposit recorded");
      const refunds = requestRefund(
        p.refunds,
        p.quote.asset,
        p.quote.assetAmount7,
        p.refundTo ?? funding.from,
        "payout_failed",
      );
      return changed({ ...p, status: "refunding", refunds });
    }

    case "payout.reversed": {
      if (p.reversals.includes(input.reversalId)) return unchanged;
      if (p.status !== "completed") throw new InvalidTransition(p.status, input.type);
      const funding = p.deposits.find((d) => d.kind === "exact" || d.kind === "over");
      if (!funding) throw new InvalidTransition(p.status, input.type, "no funding deposit recorded");
      const q = p.quote.assetAmount7;
      // A full (or over-reported) return refunds the whole quote; a partial MED refunds its share, rounded down.
      const amount7 =
        input.returnedCents >= p.quote.valueCents
          ? q
          : (q * BigInt(Math.max(0, input.returnedCents))) / BigInt(p.quote.valueCents);
      emit("PayoutReversed", {
        reversalId: input.reversalId,
        returnedCents: input.returnedCents,
        asset: p.quote.asset,
        amount7: str(amount7),
      });
      // Nothing came back: record the reversal, refund nothing (a 0 refund can't be sent and would hold the queue, T-034).
      if (amount7 <= 0n) return changed({ ...p, reversals: [...p.reversals, input.reversalId] });
      const refunds = requestRefund(p.refunds, p.quote.asset, amount7, p.refundTo ?? funding.from, "reversed");
      return changed({ ...p, status: "refunding", refunds, reversals: [...p.reversals, input.reversalId] });
    }

    case "deposit.timeout": {
      if (p.status !== "awaiting_deposit") return unchanged;
      emit("PaymentExpired", {});
      return changed({ ...p, status: "expired" });
    }

    case "refund.sent": {
      const refund = p.refunds.find((r) => r.id === input.refundId);
      if (!refund) throw new InvalidTransition(p.status, input.type, `unknown refund ${input.refundId}`);
      if (refund.status === "sent") return unchanged;
      const refunds = p.refunds.map((r) =>
        r.id === refund.id ? { ...r, status: "sent" as const, txHash: input.txHash } : r,
      );
      emit("RefundSent", {
        refundId: refund.id,
        asset: refund.asset,
        amount7: str(refund.amount7),
        txHash: input.txHash,
      });
      const allSent = refunds.every((r) => r.status === "sent");
      if (p.status === "refunding" && allSent) {
        emit("PaymentRefunded", {});
        return changed({ ...p, status: "refunded", refunds });
      }
      return changed({ ...p, refunds });
    }
  }
}
