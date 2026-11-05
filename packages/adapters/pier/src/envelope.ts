// Pier envelope v1 (Pier SPEC §5) → a transfer observation. Shape confirmed on testnet (T-008 probe, SOURCES.md): a classic
// payment with a memo id and a SAC `transfer` to the treasury's muxed address both arrive as topic
// ["transfer", from, to (base G…), asset] with value { amount, to_muxed_id } (DEC-004).

export interface PierEnvelope {
  position: string;
  id: string;
  type: string;
  ledger: number;
  ledgerClosedAt: string;
  txHash: string;
  transactionIndex: number;
  operationIndex: number;
  contractId: string | null;
  topic: string[];
  value: string;
  decoded: { topic: unknown[]; value: unknown };
}

export interface TransferObservation {
  /** Pier envelope id (the RPC event id): the inbox dedupe key on both the webhook and pull paths. */
  eventId: string;
  position: string;
  txHash: string;
  ledger: number;
  ledgerClosedAt: string;
  /** SAC contract id of the asset moved. */
  asset: string;
  /** The classic asset as the event names it: "native" or "CODE:ISSUER" (used to refund with a memo, DEC-023). */
  assetName: string;
  from: string;
  /** Base G… account (a muxed destination's id is in `muxedId`). */
  to: string;
  amount7: bigint;
  /** u64 decimal string, from a memo id or a muxed destination. Absent for plain or text-memo transfers. */
  muxedId?: string;
}

const U64_MAX = 2n ** 64n - 1n;
const isU64 = (s: string) => /^\d{1,20}$/.test(s) && BigInt(s) <= U64_MAX;

export function parseTransfer(e: PierEnvelope): TransferObservation | null {
  const [name, from, to, assetName] = e.decoded?.topic ?? [];
  if (name !== "transfer" || typeof from !== "string" || typeof to !== "string" || !e.contractId) return null;
  if (typeof assetName !== "string") return null;

  const v = e.decoded.value;
  let amount: string | undefined;
  let muxed: string | undefined;
  if (typeof v === "string") amount = v;
  else if (v && typeof v === "object") {
    const o = v as { amount?: unknown; to_muxed_id?: unknown };
    if (typeof o.amount === "string") amount = o.amount;
    // A text memo arrives as base64 bytes, not digits: only a u64 counts as our payment id.
    if (typeof o.to_muxed_id === "string" && isU64(o.to_muxed_id)) muxed = o.to_muxed_id;
  }
  if (!amount || !/^\d+$/.test(amount)) return null;

  return {
    eventId: e.id,
    position: e.position,
    txHash: e.txHash,
    ledger: e.ledger,
    ledgerClosedAt: e.ledgerClosedAt,
    asset: e.contractId,
    assetName,
    from,
    to,
    amount7: BigInt(amount),
    ...(muxed ? { muxedId: muxed } : {}),
  };
}
