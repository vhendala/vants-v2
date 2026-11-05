// What the sagas need from the outside world (T-011). The worker wires the real Hodle client and Stellar RPC; tests wire
// fakes that enforce the same rules (apps/worker/test/fakes.ts).
import type { PayoutRequest, PayoutResult } from "@vants/adapter-hodle";
import type { TxLookup } from "@vants/adapter-stellar";
import type { Backbone } from "@vants/db";
import type { Account, Keypair } from "@stellar/stellar-sdk";

export interface PayoutPort {
  /** Idempotent on `externalId`: a repeat returns the original payout (measured in the spike, INV-02). */
  payout(req: PayoutRequest): Promise<PayoutResult>;
}

export interface LedgerPort {
  /** The treasury account with its current sequence number. */
  account(): Promise<Account>;
  lookup(hash: string): Promise<TxLookup>;
  /** Submits and waits. FAILED may also mean "rejected before the ledger": callers confirm with `lookup`. */
  submit(xdr: string): Promise<TxLookup>;
  /** Stroops a transaction on the ledger actually paid; failed ones pay too (CAP-0022). */
  feeCharged(hash: string): Promise<bigint>;
}

export interface SagaDeps {
  backbone: Pick<Backbone, "withTransaction" | "publish" | "enqueue" | "withLock">;
  /** The treasury's G… account: deposits come in to it, refunds go out from it. */
  treasury: string;
  now: () => Date;
}

export interface FloatDeps extends SagaDeps {
  /** USD micros (= USDH micros, 1:1 in the sandbox): FloatLow below `minMicros`, refill up to `targetMicros`. */
  float: { minMicros: bigint; targetMicros: bigint };
}

export interface PayoutDeps extends SagaDeps {
  hodle: PayoutPort;
}

export interface RefundDeps extends SagaDeps {
  ledger: LedgerPort;
  signer: Keypair;
}
