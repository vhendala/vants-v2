// The books against the outside world (SPEC §3.7, INV-06, D7, T-015). `openLedger` starts the books once from the live
// balances. `reconcile` compares the treasury ledger with Horizon (per asset) and the float ledger with the Hodle sandbox
// balance. A difference is a `mismatch` the first time (money can be in flight: a deposit Pier hasn't delivered, a refund
// that landed but isn't marked yet) and `drift` when the same difference is still there next run, which raises
// ReconciliationDrift.
import {
  accountBalances,
  type Backbone,
  ledgerOpened,
  needsReview,
  previousDiff,
  type ReconciliationRow,
  recordReconciliation,
} from "@vants/db";
import { BASE_USDC, BASE_WALLET_ACCOUNT, FLOAT_ACCOUNT, TREASURY_ACCOUNT, USDH } from "@vants/domain";

export interface BalanceSources {
  /** The treasury's balances on Stellar: SAC id, classic name, 7-decimal amount. */
  treasury(): Promise<{ asset: string; assetName: string; amount7: bigint }[]>;
  /** The float's USDH on the Hodle sandbox (6 decimals). */
  float(): Promise<bigint>;
  /** USDC on Base Sepolia at the CCTP mint recipient (6 decimals), once refills exist (T-016). */
  base?(): Promise<bigint>;
}

export interface BooksDeps {
  backbone: Pick<Backbone, "withTransaction" | "publish">;
  sources: BalanceSources;
}

export const RECONCILE = "reconcile";

/** Opens the books from the live balances, once. Run it while no payment is in flight (at worker startup). */
export async function openLedger(deps: BooksDeps): Promise<"opened" | "already-open"> {
  if (await deps.backbone.withTransaction((tx) => ledgerOpened(tx))) return "already-open";
  const [treasury, float] = await Promise.all([deps.sources.treasury(), deps.sources.float()]);
  return deps.backbone.withTransaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('ledger-open'))"); // two workers starting at once open once
    if (await ledgerOpened(tx)) return "already-open";
    const balances = [
      ...treasury
        .filter((b) => b.amount7 > 0n)
        .map((b) => ({
          account: TREASURY_ACCOUNT,
          asset: b.asset,
          assetName: b.assetName,
          amount: b.amount7.toString(),
        })),
      ...(float > 0n ? [{ account: FLOAT_ACCOUNT, asset: USDH, assetName: USDH, amount: float.toString() }] : []),
    ];
    await deps.backbone.publish(tx, [
      {
        type: "LedgerOpened",
        version: 1,
        aggregate: { type: "ledger", id: "books" },
        correlationId: "ledger",
        causationId: null,
        payload: { balances },
      },
    ]);
    return "opened";
  });
}

export interface ReconcileReport {
  rows: ReconciliationRow[];
  review: Awaited<ReturnType<typeof needsReview>>;
}

export async function reconcile(deps: BooksDeps): Promise<ReconcileReport | null> {
  if (!(await deps.backbone.withTransaction((tx) => ledgerOpened(tx)))) return null;
  const [treasury, float, base] = await Promise.all([
    deps.sources.treasury(),
    deps.sources.float(),
    deps.sources.base?.(),
  ]);
  return deps.backbone.withTransaction(async (tx) => {
    const books = await accountBalances(tx, TREASURY_ACCOUNT);
    const baseBooks = (await accountBalances(tx, BASE_WALLET_ACCOUNT)).get(BASE_USDC) ?? 0n;
    const floatBooks = (await accountBalances(tx, FLOAT_ACCOUNT)).get(USDH) ?? 0n;
    const names = new Map(treasury.map((b) => [b.asset, b.assetName]));
    const assets = [...new Set([...treasury.map((b) => b.asset), ...books.keys()])].sort();
    const compared: Omit<ReconciliationRow, "status">[] = [
      ...assets.map((asset) => {
        const ledger = books.get(asset) ?? 0n;
        const actual = treasury.find((b) => b.asset === asset)?.amount7 ?? 0n;
        return {
          scope: "treasury" as const,
          asset,
          assetName: names.get(asset) ?? asset,
          ledger,
          actual,
          diff: actual - ledger,
        };
      }),
      { scope: "float", asset: USDH, assetName: USDH, ledger: floatBooks, actual: float, diff: float - floatBooks },
      ...(base === undefined
        ? []
        : [
            {
              scope: "base" as const,
              asset: BASE_USDC,
              assetName: BASE_USDC,
              ledger: baseBooks,
              actual: base,
              diff: base - baseBooks,
            },
          ]),
    ];
    const rows: ReconciliationRow[] = [];
    for (const c of compared) {
      const prev = await previousDiff(tx, c.scope, c.asset);
      const status = c.diff === 0n ? "ok" : prev === c.diff ? "drift" : "mismatch";
      const row = { ...c, status } as ReconciliationRow;
      await recordReconciliation(tx, row);
      rows.push(row);
      if (status === "drift") {
        console.error(
          `[books] drift on ${c.scope} ${c.assetName}: ledger ${c.ledger}, actual ${c.actual}, diff ${c.diff}`,
        );
        await deps.backbone.publish(tx, [
          {
            type: "ReconciliationDrift",
            version: 1,
            aggregate: { type: "ledger", id: `${c.scope}:${c.asset}` },
            correlationId: "ledger",
            causationId: null,
            payload: {
              scope: c.scope,
              asset: c.asset,
              assetName: c.assetName,
              ledger: c.ledger.toString(),
              actual: c.actual.toString(),
              diff: c.diff.toString(),
            },
          },
        ]);
      }
    }
    return { rows, review: await needsReview(tx) };
  });
}

/** Reconciles every 5 minutes (stately queue, so runs never overlap). */
export async function registerBooks(deps: BooksDeps & { backbone: Backbone }): Promise<void> {
  await deps.backbone.ensureQueue(RECONCILE, {
    policy: "stately",
    retryLimit: 2,
    retryDelay: 30,
    expireInSeconds: 300,
  });
  await deps.backbone.process(RECONCILE, async () => {
    await reconcile(deps);
  });
  await deps.backbone.schedule(RECONCILE, "*/5 * * * *");
}
