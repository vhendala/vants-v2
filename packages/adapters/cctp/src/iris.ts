// Circle Iris attestation API, CCTP V2 (ported from the spike, `src/cctp/iris.ts`):
//   GET /v2/messages/{sourceDomain}?transactionHash=…   GET /v2/burn/USDC/fees/{sourceDomain}/{destDomain}
import { DOMAIN, FINALITY_STANDARD } from "./addresses.ts";
import { computeMaxFee6 } from "./units.ts";

export interface Attested {
  message: `0x${string}`;
  attestation: `0x${string}`;
  /** The message amount (6 decimals) and the fee Circle took. */
  amount6: bigint;
  feeExecuted6: bigint;
}

interface IrisMessage {
  message: string;
  attestation: string;
  status: string;
  decodedMessage?: { decodedMessageBody?: { amount?: string; feeExecuted?: string } } | null;
}

/** Iris is case-sensitive about hex hashes. */
const normalize = (hash: string) => (/^(0x)?[0-9a-fA-F]+$/.test(hash) ? hash.toLowerCase() : hash);

export class Iris {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(opts: { baseUrl: string; fetch?: typeof fetch }) {
    if (!/sandbox/.test(new URL(opts.baseUrl).hostname))
      throw new Error("Iris: the sandbox (testnet) API only (INV-07)");
    this.#baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.#fetch = opts.fetch ?? fetch;
  }

  /** The burn's attested message, or null while Iris hasn't indexed or attested it yet. */
  async attestation(burnTxHash: string): Promise<Attested | null> {
    const res = await this.#fetch(
      `${this.#baseUrl}/v2/messages/${DOMAIN.stellar}?transactionHash=${normalize(burnTxHash)}`,
    );
    if (res.status === 404 || res.status === 429) return null;
    if (!res.ok) throw new Error(`Iris ${res.status} for burn ${burnTxHash}`);
    const m = ((await res.json()) as { messages?: IrisMessage[] }).messages?.[0];
    if (m?.status !== "complete" || !m.attestation || m.attestation === "PENDING") return null;
    const body = m.decodedMessage?.decodedMessageBody;
    return {
      message: m.message as `0x${string}`,
      attestation: m.attestation as `0x${string}`,
      amount6: BigInt(body?.amount ?? "0"),
      feeExecuted6: BigInt(body?.feeExecuted ?? "0"),
    };
  }

  /** The max fee to allow for a Standard transfer of `amount6`, from Circle's fee schedule (0 when it lists none). */
  async maxFee6(amount6: bigint): Promise<bigint> {
    const res = await this.#fetch(`${this.#baseUrl}/v2/burn/USDC/fees/${DOMAIN.stellar}/${DOMAIN.base}`);
    if (!res.ok) throw new Error(`Iris fees ${res.status}`);
    const body = (await res.json()) as unknown;
    const list = (Array.isArray(body) ? body : ((body as { data?: unknown }).data ?? [])) as {
      finalityThreshold: number;
      minimumFee: number;
    }[];
    const tier = list.find((f) => Number(f.finalityThreshold) === FINALITY_STANDARD);
    return computeMaxFee6(amount6, tier ? Number(tier.minimumFee) : undefined);
  }
}
