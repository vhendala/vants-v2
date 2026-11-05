// Treasury operations on Stellar testnet (T-009, DEC-004, DEC-023): per-payment deposit addresses, refund envelopes that are
// persisted before submission and resubmitted unchanged (idempotent by hash, INV-10), balances, and the testnet check.
import {
  Account,
  Asset,
  type Horizon,
  type Keypair,
  Memo,
  MuxedAccount,
  Networks,
  Operation,
  rpc,
  StrKey,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { formatAmount7 } from "@vants/domain";

const U64_MAX = 2n ** 64n - 1n;
/** SDK 17.3 returns hashes as Uint8Array, whose toString ignores "hex": convert explicitly. */
const toHex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const MAX_MEMO_BYTES = 28;
/** After a refund envelope's deadline, wait this long before treating it as dead (ledger close vs local clock). */
export const REFUND_DEADLINE_GRACE_SECONDS = 30;

function assertU64(id: string): void {
  if (!/^\d{1,20}$/.test(id) || BigInt(id) > U64_MAX) throw new Error(`not a u64 id: "${id}"`);
}

export interface DepositInstructions {
  /** M… muxed address: pay this, by classic payment or SAC transfer (contract calls can't carry a memo). */
  address: string;
  /** Fallback for wallets without M… support: pay `account` with memo id `memoId`. */
  account: string;
  memoId: string;
}

export function depositInstructions(treasury: string, muxId: string): DepositInstructions {
  assertU64(muxId);
  if (!StrKey.isValidEd25519PublicKey(treasury)) throw new Error("treasury must be a G… account");
  const address = new MuxedAccount(new Account(treasury, "0"), muxId).accountId();
  return { address, account: treasury, memoId: muxId };
}

/** "native" or "CODE:ISSUER", as a transfer event names it, → the classic asset. */
export function classicAsset(name: string): Asset {
  if (name === "native") return Asset.native();
  const m = /^([A-Za-z0-9]{1,12}):(G[A-Z2-7]{55})$/.exec(name);
  if (!m?.[1] || !m[2]) throw new Error(`not a classic asset name: "${name}"`);
  return new Asset(m[1], m[2]);
}

export const sacIdOf = (asset: Asset): string => asset.contractId(Networks.TESTNET);

/**
 * Text memo on every refund: "vants:rf:<mux id in base 36>:<tag>", at most 28 bytes for any u64 id and a tag of up to 5
 * characters. The tag is the refund's number for a payment ("1"), or "u<n>" for a deposit no payment owns (T-011).
 */
export function refundMemo(muxId: string, tag: number | string): string {
  assertU64(muxId);
  const t = String(tag);
  if (!/^u?\d{1,4}$/.test(t)) throw new Error(`refund memo tag must be <n> or u<n> (≤ 5 chars): "${t}"`);
  return `vants:rf:${BigInt(muxId).toString(36)}:${t}`;
}

/** 7-decimal integer → decimal string; lives in the domain (T-012), re-exported here for the builders. */
export { formatAmount7 };

export interface BuiltTx {
  xdr: string;
  hash: string;
  /** Unix seconds after which the network refuses this envelope. */
  maxTime: number;
}

/** One classic payment with a text memo and a deadline, signed by the treasury. Persist `xdr` before submitting it. */
export function buildRefundTx(input: {
  source: Account;
  signer: Keypair;
  to: string;
  asset: Asset;
  amount7: bigint;
  memo: string;
  nowSeconds?: number;
  timeoutSeconds?: number;
  fee?: string;
}): BuiltTx {
  if (new TextEncoder().encode(input.memo).length > MAX_MEMO_BYTES)
    throw new Error(`memo exceeds ${MAX_MEMO_BYTES} bytes`);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const maxTime = now + (input.timeoutSeconds ?? 300);
  const tx = new TransactionBuilder(input.source, {
    fee: input.fee ?? "1000",
    networkPassphrase: Networks.TESTNET,
    timebounds: { minTime: 0, maxTime },
  })
    .addOperation(
      Operation.payment({ destination: input.to, asset: input.asset, amount: formatAmount7(input.amount7) }),
    )
    .addMemo(Memo.text(input.memo))
    .build();
  tx.sign(input.signer);
  return { xdr: tx.toXDR(), hash: toHex(tx.hash()), maxTime };
}

/** What to do with a persisted refund envelope on retry: it lands at most once. */
export function refundRetryDecision(input: {
  onLedger: boolean;
  nowSeconds: number;
  maxTime: number;
}): "done" | "resubmit" | "rebuild" {
  if (input.onLedger) return "done";
  return input.nowSeconds <= input.maxTime + REFUND_DEADLINE_GRACE_SECONDS ? "resubmit" : "rebuild";
}

// --- network calls (worker) ---------------------------------------------------------------------------------------

/** INV-07, at startup: the RPC must report the testnet passphrase. */
export async function assertTestnet(server: rpc.Server): Promise<void> {
  const { passphrase } = await server.getNetwork();
  if (passphrase !== Networks.TESTNET) throw new Error("Stellar RPC is not testnet (INV-07)");
}

export type TxLookup = "SUCCESS" | "FAILED" | "NOT_FOUND";

export async function lookupTx(server: rpc.Server, hash: string): Promise<TxLookup> {
  const r = await server.getTransaction(hash);
  if (r.status === rpc.Api.GetTransactionStatus.SUCCESS) return "SUCCESS";
  if (r.status === rpc.Api.GetTransactionStatus.FAILED) return "FAILED";
  return "NOT_FOUND";
}

/** Submits a persisted envelope and waits for it; resubmitting an envelope that already landed is harmless. */
export async function submitAndWait(server: rpc.Server, xdr: string, attempts = 30): Promise<TxLookup> {
  const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
  const hash = toHex(tx.hash());
  if ((await lookupTx(server, hash)) === "SUCCESS") return "SUCCESS";
  const sent = await server.sendTransaction(tx);
  if (sent.status === "ERROR") return (await lookupTx(server, hash)) === "SUCCESS" ? "SUCCESS" : "FAILED";
  for (let i = 0; i < attempts; i++) {
    const status = await lookupTx(server, hash);
    if (status !== "NOT_FOUND") return status;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return "NOT_FOUND";
}

export interface TreasuryBalance {
  assetName: string;
  sacId: string;
  amount7: bigint;
}

/** The treasury's classic balances (D7 reconciliation). */
export async function treasuryBalances(horizon: Horizon.Server, account: string): Promise<TreasuryBalance[]> {
  const a = await horizon.loadAccount(account);
  return a.balances.flatMap((b) => {
    const name =
      b.asset_type === "native"
        ? "native"
        : "asset_code" in b && "asset_issuer" in b
          ? `${b.asset_code}:${b.asset_issuer}`
          : undefined;
    if (!name) return [];
    const [whole = "0", frac = ""] = b.balance.split(".");
    return [
      {
        assetName: name,
        sacId: sacIdOf(classicAsset(name)),
        amount7: BigInt(whole) * 10_000_000n + BigInt(frac.padEnd(7, "0")),
      },
    ];
  });
}
