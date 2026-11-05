// Test doubles for the sagas' two outside worlds (T-011). The ledger reads real signed envelopes and enforces what the
// network enforces (sequence number, deadline, a hash lands once); the Hodle fake deduplicates on externalId, as the
// sandbox was measured to (INV-02).
import { HodleError, type PayoutRequest, type PayoutResult } from "@vants/adapter-hodle";
import type { PierEnvelope } from "@vants/adapter-pier";
import type { TxLookup } from "@vants/adapter-stellar";
import {
  Account,
  type Keypair,
  Memo,
  Networks,
  Operation,
  type Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import type { LedgerPort, PayoutPort } from "../src/sagas/ports.ts";

export interface LandedPayment {
  hash: string;
  to: string;
  asset: string;
  amount: string;
  memo: string;
}

export class FakeLedger implements LedgerPort {
  readonly treasury: string;
  readonly #nowSeconds: () => number;
  seq = 1000n;
  readonly payments: LandedPayment[] = [];
  readonly results = new Map<string, TxLookup>();
  readonly submitted: string[] = [];
  /** Next submissions are accepted by RPC but never land (lost in flight). */
  dropNext = 0;
  /** Next submissions throw before reaching the network. */
  throwBeforeSubmit = 0;
  /** Next submissions land, then the caller crashes before seeing the result. */
  throwAfterLand = 0;
  /** Next submissions land as FAILED (e.g. the destination has no trustline). */
  failOnLedger = 0;
  /**
   * Next submissions are accepted but land only at the ledger's next write (a later `account()` or `submit()`), not
   * before a `lookup`: the race where an envelope lands just after we looked for it.
   */
  landLate = 0;
  readonly #pending: Transaction[] = [];
  /** Called when an envelope lands successfully: lets other fakes apply its effect (e.g. a CCTP burn). */
  onLand?: (tx: Transaction, hash: string) => void;

  constructor(treasury: string, nowSeconds: () => number) {
    this.treasury = treasury;
    this.#nowSeconds = nowSeconds;
  }

  async account(): Promise<Account> {
    this.#flush();
    return new Account(this.treasury, this.seq.toString());
  }

  /** Every landed envelope pays 100 stroops, as a base-fee classic transaction does. */
  async feeCharged(hash: string): Promise<bigint> {
    if (!this.results.has(hash)) throw new Error(`transaction ${hash} is not on the ledger`);
    return 100n;
  }

  async lookup(hash: string): Promise<TxLookup> {
    return this.results.get(hash) ?? "NOT_FOUND";
  }

  async submit(xdr: string): Promise<TxLookup> {
    if (this.throwBeforeSubmit > 0) {
      this.throwBeforeSubmit -= 1;
      throw new Error("network error before submit");
    }
    this.#flush();
    const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET) as Transaction;
    const hash = Buffer.from(tx.hash()).toString("hex");
    this.submitted.push(hash);
    const known = this.results.get(hash);
    if (known) return known;
    // Rejected before the ledger: nothing lands, nothing is recorded under the hash.
    if (BigInt(tx.sequence) !== this.seq + 1n) return "FAILED"; // tx_bad_seq
    if (Number(tx.timeBounds?.maxTime ?? 0) < this.#nowSeconds()) return "FAILED"; // tx_too_late
    if (this.dropNext > 0) {
      this.dropNext -= 1;
      return "NOT_FOUND";
    }
    if (this.landLate > 0) {
      this.landLate -= 1;
      this.#pending.push(tx);
      return "NOT_FOUND";
    }
    return this.#land(tx, hash);
  }

  #flush(): void {
    for (const tx of this.#pending.splice(0)) {
      if (BigInt(tx.sequence) === this.seq + 1n) this.#land(tx, Buffer.from(tx.hash()).toString("hex"));
    }
  }

  #land(tx: Transaction, hash: string): TxLookup {
    this.seq += 1n;
    if (this.failOnLedger > 0) {
      this.failOnLedger -= 1;
      this.results.set(hash, "FAILED");
      return "FAILED";
    }
    const op = tx.operations[0];
    if (op?.type === "payment") {
      const memo = tx.memo.type === Memo.text("x").type ? Buffer.from(tx.memo.value as Uint8Array).toString() : "";
      this.payments.push({
        hash,
        to: op.destination,
        asset: op.asset.isNative() ? "native" : `${op.asset.getCode()}:${op.asset.getIssuer()}`,
        amount: op.amount,
        memo,
      });
    }
    this.results.set(hash, "SUCCESS");
    this.onLand?.(tx, hash);
    if (this.throwAfterLand > 0) {
      this.throwAfterLand -= 1;
      throw new Error("crashed after the envelope landed");
    }
    return "SUCCESS";
  }
}

type HodleMode = "insufficient_float" | "settlement_failed" | "unavailable" | "throw_after_paying" | "processing";

export class FakeHodle implements PayoutPort {
  readonly calls: PayoutRequest[] = [];
  readonly paid = new Map<string, PayoutResult>();
  /** Behaviour of the next calls, in order; a call with nothing queued pays. */
  readonly next: HodleMode[] = [];

  async payout(req: PayoutRequest): Promise<PayoutResult> {
    this.calls.push(req);
    const mode = this.next.shift();
    const path = "POST /api/wallet/payout";
    if (mode === "insufficient_float")
      throw new HodleError({
        status: 400,
        errorCode: "SANDBOX_INSUFFICIENT_BALANCE",
        kind: "insufficient_float",
        reason: "saldo insuficiente",
        path,
      });
    if (mode === "settlement_failed")
      throw new HodleError({
        status: 400,
        errorCode: "SANDBOX_SETTLEMENT_FAILED",
        kind: "settlement_failed",
        reason: "settlement failed",
        path,
      });
    if (mode === "unavailable")
      throw new HodleError({ status: 503, kind: "unavailable", reason: "down", path, outcomeUnknown: true });
    if (mode === "processing") {
      return { ...this.#result(req), status: "PROCESSING" };
    }
    const result = this.paid.get(req.externalId) ?? this.#result(req);
    this.paid.set(req.externalId, result);
    if (mode === "throw_after_paying")
      throw new HodleError({ status: 0, kind: "unavailable", reason: "socket hang up", path, outcomeUnknown: true });
    return result;
  }

  #result(req: PayoutRequest): PayoutResult {
    const n = this.paid.size + 1;
    return {
      transactionId: `hodle-tx-${n}`,
      externalId: req.externalId,
      status: "COMPLETED",
      debit6: (BigInt(req.valueCents) * 10n ** 10n) / 5_400_000n,
      valueInBrl: (req.valueCents / 100).toFixed(2),
      fee: "0.00",
      endToEndId: `SANDBOXE2E${n}`,
      txHash: `0x${n.toString(16).padStart(64, "0")}`,
      sandbox: true,
    };
  }
}

let position = 0;

/** A Pier transfer envelope as `parseTransfer` reads it (shape recorded on testnet, T-008). */
export function transferEnvelope(t: {
  from: string;
  to: string;
  assetName: string;
  sac: string;
  amount7: bigint;
  muxId?: string;
  ledgerClosedAt: string;
}): PierEnvelope {
  position += 1;
  return {
    position: String(position),
    id: `${String(position).padStart(19, "0")}-0000000000`,
    type: "contract",
    ledger: 5_000_000 + position,
    ledgerClosedAt: t.ledgerClosedAt,
    txHash: position.toString(16).padStart(64, "a"),
    transactionIndex: 0,
    operationIndex: 0,
    contractId: t.sac,
    topic: [],
    value: "",
    decoded: {
      topic: ["transfer", t.from, t.to, t.assetName],
      value: t.muxId ? { amount: t.amount7.toString(), to_muxed_id: t.muxId } : t.amount7.toString(),
    },
  };
}

/**
 * CCTP for the refill saga (T-016). Approve and burn envelopes are real signed transactions on the fake ledger (a manageData
 * operation stands in for the contract call), and take effect only when the ledger lands them.
 */
export class FakeCctp {
  readonly recipient = `0x${"11".repeat(20)}`;
  allowance7 = 0n;
  readonly burns = new Map<string, bigint>();
  readonly mints: string[] = [];
  readonly usedNonces = new Set<string>();
  /** Circle hasn't attested yet. */
  holdAttestation = false;
  feeExecuted6 = 0n;
  /** The next mint is broadcast and lands, then the caller crashes before hearing back. */
  throwAfterMint = 0;
  readonly #ledger: FakeLedger;
  readonly #signer: Keypair;

  constructor(ledger: FakeLedger, signer: Keypair) {
    this.#ledger = ledger;
    this.#signer = signer;
    ledger.onLand = (tx, hash) => {
      const op = tx.operations[0];
      if (op?.type !== "manageData") return;
      const amount = BigInt(Buffer.from(op.value ?? Buffer.alloc(0)).toString());
      if (op.name === "fake:approve") this.allowance7 = amount;
      if (op.name === "fake:burn") {
        if (this.allowance7 < amount) throw new Error("fake burn without allowance");
        this.allowance7 -= amount;
        this.burns.set(hash, amount);
      }
    };
  }

  async allowance() {
    return this.allowance7;
  }
  buildApprove(amount7: bigint, nowSeconds: number) {
    return this.#envelope("fake:approve", amount7, nowSeconds);
  }
  buildBurn(input: { amount7: bigint; nowSeconds: number }) {
    return this.#envelope("fake:burn", input.amount7, input.nowSeconds);
  }
  async maxFee6(_amount6: bigint) {
    return 0n;
  }
  async attestation(burnHash: string) {
    const burned = this.burns.get(burnHash);
    if (burned === undefined || this.holdAttestation) return null;
    const amount6 = burned / 10n;
    // A V2 header with the burn hash as nonce: version | source 27 | destination 6 | nonce.
    const message = `0x00000001${"0000001b"}${"00000006"}${burnHash}${"00".repeat(8)}` as `0x${string}`;
    return { message, attestation: "0xa77e57" as `0x${string}`, amount6, feeExecuted6: this.feeExecuted6 };
  }
  async nonceUsed(message: `0x${string}`) {
    return this.usedNonces.has(message);
  }
  async mint(message: `0x${string}`, _attestation: `0x${string}`) {
    if (this.usedNonces.has(message)) throw new Error("nonce already used");
    this.usedNonces.add(message);
    this.mints.push(message);
    const burned = [...this.burns.entries()].find(([hash]) => message.includes(hash))?.[1] ?? 0n;
    if (this.throwAfterMint > 0) {
      this.throwAfterMint -= 1;
      throw new Error("crashed after broadcasting the mint");
    }
    return { txHash: `0xmint${this.mints.length}`, minted6: burned / 10n - this.feeExecuted6 };
  }

  async #envelope(name: string, amount7: bigint, nowSeconds: number) {
    const maxTime = nowSeconds + 300;
    const tx = new TransactionBuilder(await this.#ledger.account(), {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
      timebounds: { minTime: 0, maxTime },
    })
      .addOperation(Operation.manageData({ name, value: amount7.toString() }))
      .build();
    tx.sign(this.#signer);
    return { xdr: tx.toXDR(), hash: Buffer.from(tx.hash()).toString("hex"), maxTime };
  }
}

/** The Hodle sandbox float (T-016): our payouts debit it; a settled sandbox deposit credits it, once per trackId. */
export class FakeFloat {
  balance6: bigint;
  readonly deposits = new Map<string, { cents: number; settled: boolean }>();
  rate = "5.4";
  /** The next balance read fails (e.g. a crash right after settling). */
  throwOnBalance = 0;
  readonly #hodle: FakeHodle;

  constructor(start6: bigint, hodle: FakeHodle) {
    this.balance6 = start6;
    this.#hodle = hodle;
  }

  async createDeposit(cents: number) {
    const trackId = `track-${this.deposits.size + 1}`;
    this.deposits.set(trackId, { cents, settled: false });
    return { trackId, rate: this.rate, fee: "0" };
  }
  async settleDeposit(trackId: string) {
    const d = this.deposits.get(trackId);
    if (!d) return false;
    if (!d.settled) {
      d.settled = true;
      this.balance6 += (BigInt(d.cents) * 10n ** 10n) / 5_400_000n;
    }
    return true;
  }
  async balance() {
    if (this.throwOnBalance > 0) {
      this.throwOnBalance -= 1;
      throw new Error("balance read failed");
    }
    const debited = [...this.#hodle.paid.values()].reduce((a, p) => a + p.debit6, 0n);
    return this.balance6 - debited;
  }
}
