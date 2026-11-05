// Landing a treasury transaction at most once (DEC-023, INV-10): the rule every treasury envelope follows, whether it is a
// refund or a refill's approve and burn (T-016). The envelope is committed before it is submitted; on any retry it is
// looked up, then resubmitted unchanged until its deadline has passed, and only then rebuilt, because past its deadline the
// old envelope can never land. Two envelopes racing for one sequence number can delay each other, never both land.
import { classicAsset, refundRetryDecision, sacIdOf } from "@vants/adapter-stellar";
import type { LedgerPort } from "./ports.ts";

export interface Envelope {
  xdr: string;
  hash: string;
  maxTime: number;
}

/** XLM's asset contract id: network fees are booked against it. */
export const NATIVE_SAC = sacIdOf(classicAsset("native"));

/** The lock every treasury signer holds while it builds, submits and waits for an envelope (refunds, refill). */
export const TREASURY_SIGNER = "treasury-signer";

/** The envelope isn't on the ledger yet: retry later, and send nothing else from the treasury meanwhile. */
export class EnvelopePending extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvelopePending";
  }
}

export async function landOnce(input: {
  stored: Envelope | null;
  build: () => Promise<Envelope>;
  /** Commit the new envelope; it is submitted only after this resolves. */
  persist: (envelope: Envelope) => Promise<void>;
  ledger: LedgerPort;
  nowSeconds: number;
}): Promise<{ landed: "success" | "failed"; hash: string }> {
  const { stored, ledger } = input;
  if (stored) {
    const seen = await ledger.lookup(stored.hash);
    if (seen === "SUCCESS") return { landed: "success", hash: stored.hash };
    if (seen === "FAILED") return { landed: "failed", hash: stored.hash };
    if (
      refundRetryDecision({ onLedger: false, nowSeconds: input.nowSeconds, maxTime: stored.maxTime }) === "resubmit"
    ) {
      return submit(stored, ledger);
    }
  }
  const built = await input.build();
  await input.persist(built);
  return submit(built, ledger);
}

async function submit(e: Envelope, ledger: LedgerPort): Promise<{ landed: "success" | "failed"; hash: string }> {
  const result = await ledger.submit(e.xdr);
  if (result === "SUCCESS") return { landed: "success", hash: e.hash };
  // FAILED from submit can mean "rejected before the ledger" (e.g. a stale sequence): only the ledger says it failed.
  if (result === "FAILED" && (await ledger.lookup(e.hash)) === "FAILED") return { landed: "failed", hash: e.hash };
  throw new EnvelopePending(`${e.hash} is not on the ledger yet`);
}
