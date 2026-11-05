// The float refill saga (SPEC §3.7, T-016, D6). When the float is below FLOAT_MIN_USD, Circle testnet USDC from the treasury is
// bridged to Base Sepolia with CCTP and the Hodle sandbox float is credited the same amount (a USDH deposit the sandbox mints:
// the stand-in for "the bridged USDC reached the Hodle wallet"; the USDC itself stays on Base). One refill at a time, phase by
// phase, each external effect either recorded before it is made or idempotent where it lands:
//   approve, burn  treasury envelopes, landed at most once (landOnce, under the treasury-signer lock)
//   attest         a read (Iris)
//   mint           guarded by the CCTP nonce: a used nonce means it already minted
//   credit         a deposit credits nothing until settled; settling is idempotent per trackId; the amount is exact at the
//                  sandbox rate, so the balance poll confirms it to the unit
// Payouts never wait for it (D6): the payout pump and the refill pump are separate queues.
import { STELLAR_TESTNET } from "@vants/adapter-cctp";
import {
  type Backbone,
  activeRefill,
  accountBalances,
  clearingTotal,
  floatPosition,
  refillFailedRecently,
  type RefillPatch,
  type RefillRow,
  startRefill,
  type Tx,
  updateRefill,
} from "@vants/db";
import { type EventDraft, exactUsdhDeposit, rateToMicros, TREASURY_ACCOUNT } from "@vants/domain";
import type { FloatDeps, LedgerPort } from "./ports.ts";
import { type Envelope, EnvelopePending, landOnce, NATIVE_SAC, TREASURY_SIGNER } from "./treasury-tx.ts";

export const REFILL_PUMP = "refill-pump";
export const REFILL_SAGA = "refill-saga";
/** After a failed refill, wait this long before starting another (a person should look first). */
export const REFILL_COOL_DOWN_MINUTES = 15;
/** Below this a refill isn't worth two transactions (0.05 USDC: the smallest exact credit at the sandbox rate). */
const MIN_REFILL6 = 50_000n;

export interface CctpPort {
  readonly recipient: string;
  allowance(): Promise<bigint>;
  buildApprove(amount7: bigint, nowSeconds: number): Promise<Envelope>;
  buildBurn(input: { amount7: bigint; maxFee7: bigint; recipient: string; nowSeconds: number }): Promise<Envelope>;
  maxFee6(amount6: bigint): Promise<bigint>;
  attestation(
    burnHash: string,
  ): Promise<{ message: `0x${string}`; attestation: `0x${string}`; amount6: bigint; feeExecuted6: bigint } | null>;
  nonceUsed(message: `0x${string}`): Promise<boolean>;
  mint(message: `0x${string}`, attestation: `0x${string}`): Promise<{ txHash: string; minted6: bigint }>;
}

export interface SandboxFloatPort {
  createDeposit(cents: number): Promise<{ trackId: string; rate: string; fee: string }>;
  settleDeposit(trackId: string): Promise<boolean>;
  /** The float's USDH on the Hodle sandbox (6 decimals). */
  balance(): Promise<bigint>;
}

export interface RefillDeps extends FloatDeps {
  ledger: LedgerPort;
  refill: { cctp: CctpPort; float: SandboxFloatPort };
  /** The most USDC (micros) one refill bridges. */
  capMicros: bigint;
  /** The sandbox rate a deposit must be priced at (BRL per USD, micros). */
  rateMicros: bigint;
}

/** The refill is waiting on something outside (an envelope, Circle, the sandbox): retry later. */
export class RefillPending extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefillPending";
  }
}

const USDC_SAC = STELLAR_TESTNET.usdcSac;
const smallest = (...xs: bigint[]) => {
  let m = xs[0] ?? 0n;
  for (const x of xs) if (x < m) m = x;
  return m;
};
const nowSeconds = (deps: RefillDeps) => Math.floor(deps.now().getTime() / 1000);
const draft = (r: RefillRow, type: string, payload: object): EventDraft => ({
  type,
  version: 1,
  aggregate: { type: "refill", id: r.id },
  correlationId: r.id,
  causationId: null,
  payload: { refillId: r.id, ...payload },
});

/** Advances the refill in flight, or starts one if the float needs it. Returns the refill it ended on, or null if none. */
export async function runRefillPump(deps: RefillDeps): Promise<RefillRow | null> {
  let r = (await deps.backbone.withTransaction((tx) => activeRefill(tx))) ?? (await maybeStart(deps));
  while (r && r.status !== "completed" && r.status !== "failed") r = await step(r, deps);
  return r;
}

async function maybeStart(deps: RefillDeps): Promise<RefillRow | null> {
  const plan = await deps.backbone.withTransaction(async (tx) => {
    const pos = await floatPosition(tx);
    if (!pos.opened || pos.balance6 >= deps.float.minMicros) return null;
    if (await refillFailedRecently(tx, REFILL_COOL_DOWN_MINUTES)) return null;
    // Only USDC the treasury owns: its balance minus what it owes on open payments and refunds (clearing accounts).
    const owned7 =
      ((await accountBalances(tx, TREASURY_ACCOUNT)).get(USDC_SAC) ?? 0n) + (await clearingTotal(tx, USDC_SAC));
    const want6 = smallest(deps.float.targetMicros - pos.balance6, deps.capMicros, owned7 / 10n);
    const amount6 = exactUsdhDeposit(want6, deps.rateMicros).credit6; // the credit will be exact, to the unit
    return amount6 >= MIN_REFILL6 ? amount6 : null;
  });
  if (plan === null) return null;
  const maxFee6 = await deps.refill.cctp.maxFee6(plan);
  return deps.backbone.withTransaction(async (tx) => (await startRefill(tx, plan, maxFee6)) ?? activeRefill(tx));
}

async function save(deps: RefillDeps, r: RefillRow, patch: RefillPatch, events: EventDraft[] = []): Promise<RefillRow> {
  return deps.backbone.withTransaction(async (tx: Tx) => {
    await updateRefill(tx, r.id, patch);
    if (events.length > 0) await deps.backbone.publish(tx, events);
    return (await activeRefill(tx)) ?? { ...r, status: patch.status ?? r.status };
  });
}

/** Lands a treasury envelope under the signer lock; maps "not yet" to RefillPending. */
async function land(
  deps: RefillDeps,
  r: RefillRow,
  stored: Envelope | null,
  build: () => Promise<Envelope>,
  persist: (e: Envelope) => RefillPatch,
) {
  try {
    return await deps.backbone.withLock(TREASURY_SIGNER, () =>
      landOnce({
        stored,
        build,
        persist: (e) => deps.backbone.withTransaction((tx) => updateRefill(tx, r.id, persist(e))),
        ledger: deps.ledger,
        nowSeconds: nowSeconds(deps),
      }),
    );
  } catch (err) {
    if (err instanceof EnvelopePending) throw new RefillPending(`refill ${r.id}: ${err.message}`);
    throw err;
  }
}

async function feeEvent(deps: RefillDeps, r: RefillRow, hash: string): Promise<EventDraft> {
  return draft(r, "TreasuryFeePaid", {
    txHash: hash,
    asset: NATIVE_SAC,
    amount7: (await deps.ledger.feeCharged(hash)).toString(),
  });
}

async function step(r: RefillRow, deps: RefillDeps): Promise<RefillRow> {
  const { cctp, float } = deps.refill;
  const amount7 = r.amount6 * 10n;
  switch (r.status) {
    case "approving": {
      if (!r.approve && (await cctp.allowance()) >= amount7) return save(deps, r, { status: "burning" });
      const { landed, hash } = await land(
        deps,
        r,
        r.approve,
        () => cctp.buildApprove(amount7, nowSeconds(deps)),
        (e) => ({ approve: e }),
      );
      const fee = await feeEvent(deps, r, hash);
      return landed === "success"
        ? save(deps, r, { status: "burning" }, [fee])
        : save(deps, r, { status: "failed", lastError: `approve ${hash} failed on the ledger` }, [fee]);
    }
    case "burning": {
      const { landed, hash } = await land(
        deps,
        r,
        r.burn,
        () =>
          cctp.buildBurn({
            amount7,
            maxFee7: r.maxFee6 * 10n,
            recipient: cctp.recipient,
            nowSeconds: nowSeconds(deps),
          }),
        (e) => ({ burn: e }),
      );
      const fee = await feeEvent(deps, r, hash);
      if (landed === "failed")
        return save(deps, r, { status: "failed", lastError: `burn ${hash} failed on the ledger` }, [fee]);
      return save(deps, r, { status: "attesting" }, [
        fee,
        draft(r, "CctpBurned", { asset: USDC_SAC, burned7: amount7.toString(), burnHash: hash }),
      ]);
    }
    case "attesting": {
      const att = r.burn ? await cctp.attestation(r.burn.hash) : null;
      if (!att) throw new RefillPending(`refill ${r.id}: waiting for Circle's attestation`);
      if (att.amount6 !== r.amount6) {
        return save(deps, r, {
          status: "failed",
          lastError: `attested amount ${att.amount6} ≠ burned ${r.amount6}: review`,
        });
      }
      return save(deps, r, {
        status: "minting",
        attested: { message: att.message, attestation: att.attestation, feeExecuted6: att.feeExecuted6 },
      });
    }
    case "minting": {
      if (!r.message || !r.attestation) throw new Error(`refill ${r.id} has no attested message`);
      const minted = (await cctp.nonceUsed(r.message))
        ? { mintHash: null, minted6: r.amount6 - (r.feeExecuted6 ?? 0n) } // minted already (we crashed after broadcasting)
        : await cctp.mint(r.message, r.attestation).then((m) => ({ mintHash: m.txHash, minted6: m.minted6 }));
      return save(deps, r, { status: "crediting", minted }, [
        draft(r, "CctpMinted", {
          asset: USDC_SAC,
          burned7: amount7.toString(),
          minted6: minted.minted6.toString(),
          mintHash: minted.mintHash,
        }),
      ]);
    }
    case "crediting": {
      if (!r.trackId) {
        const { cents, credit6 } = exactUsdhDeposit(r.minted6 ?? 0n, deps.rateMicros);
        const dep = await float.createDeposit(cents);
        // An unsettled deposit credits nothing, so refusing here is safe.
        if (rateToMicros(dep.rate) !== deps.rateMicros || Number(dep.fee) !== 0) {
          return save(deps, r, {
            status: "failed",
            lastError: `sandbox deposit priced at ${dep.rate} with fee ${dep.fee}; not settled`,
          });
        }
        r = await save(deps, r, { credit: { cents, credit6, trackId: dep.trackId } });
      }
      if (!r.settled) {
        if (!(await float.settleDeposit(r.trackId ?? "")))
          throw new RefillPending(`refill ${r.id}: deposit not settled yet`);
        r = await save(deps, r, { settled: true });
      }
      // Confirm by balance: Hodle minus the books must be exactly the credit we haven't booked yet.
      const actual = await float.balance();
      const books = (await deps.backbone.withTransaction((tx) => floatPosition(tx))).balance6;
      if (actual - books !== r.credit6) {
        await save(deps, r, {
          attempt: true,
          lastError: `float differs from the books by ${actual - books}, expecting ${r.credit6}`,
        });
        throw new RefillPending(`refill ${r.id}: credit not confirmed yet`);
      }
      return save(deps, r, { status: "completed", lastError: null }, [
        draft(r, "FloatCredited", { credit6: (r.credit6 ?? 0n).toString(), cents: r.creditCents, trackId: r.trackId }),
      ]);
    }
    default:
      return r;
  }
}

/** FloatLow wakes the pump; a per-minute cron also wakes it, so a low float is refilled even if an event was missed. */
export async function registerRefill(deps: RefillDeps & { backbone: Backbone }): Promise<void> {
  const { backbone } = deps;
  await backbone.ensureQueue(REFILL_SAGA);
  await backbone.ensureQueue(REFILL_PUMP, {
    policy: "stately",
    retryLimit: 100,
    retryDelay: 5,
    retryDelayMax: 60,
    expireInSeconds: 900,
  });
  await backbone.subscribe("FloatLow", REFILL_SAGA);
  await backbone.consume(REFILL_SAGA, (_event, tx) => backbone.enqueue(tx, REFILL_PUMP));
  await backbone.process(REFILL_PUMP, async () => {
    await runRefillPump(deps);
  });
  await backbone.schedule(REFILL_PUMP, "* * * * *");
}
