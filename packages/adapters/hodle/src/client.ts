// Hodle sandbox client (worker only, DEC-005, DEC-008). Payouts use the USDH test-wallet path, which needs neither the
// WALLET_PAYOUT_API flag nor a PIN (measured in the spike). A payout is retried only with the same externalId, which Hodle
// deduplicates (measured: a replay returns the original payout), so a retry can never pay twice (INV-02).
import type { PaymentInput } from "@vants/domain";

const SANDBOX_HOST = /^sandbox-api(-stg)?\.hodle\.com\.br$/;

export type HodleErrorKind =
  | "insufficient_float"
  | "settlement_failed"
  | "invalid_request"
  | "unauthorized"
  | "busy"
  | "unavailable";

export class HodleError extends Error {
  readonly status: number;
  readonly errorCode: string | undefined;
  readonly kind: HodleErrorKind;
  /** The request may have been processed (network error or 5xx after retries): reconcile before acting. */
  readonly outcomeUnknown: boolean;

  constructor(init: {
    status: number;
    errorCode?: string;
    kind: HodleErrorKind;
    reason: string;
    path: string;
    outcomeUnknown?: boolean;
  }) {
    super(
      `Hodle ${init.status || "network error"}${init.errorCode ? ` ${init.errorCode}` : ""} on ${init.path}: ${init.reason}`,
    );
    this.name = "HodleError";
    this.status = init.status;
    this.errorCode = init.errorCode;
    this.kind = init.kind;
    this.outcomeUnknown = init.outcomeUnknown ?? false;
  }
}

export type PixKeyType = "PHONE" | "CPF" | "EMAIL" | "RANDOM" | "CNPJ";

export interface PayoutRequest {
  /** BRL cents the recipient receives. */
  valueCents: number;
  /** Idempotency key: "vants:<paymentId>". */
  externalId: string;
  qrCode?: string;
  pixKey?: { key: string; type: PixKeyType };
}

export type PayoutStatus = "COMPLETED" | "FAILED" | "PENDING" | "PROCESSING" | "REFUNDED";

export interface PayoutResult {
  transactionId: string;
  externalId: string;
  status: PayoutStatus;
  /** USDH debited (6 decimals). */
  debit6: bigint;
  valueInBrl: string;
  fee: string;
  endToEndId?: string;
  txHash?: string;
  sandbox: boolean;
}

export interface HodleClientOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
  /** Base delay between retries; doubles each attempt. */
  retryDelayMs?: number;
  timeoutMs?: number;
  maxAttempts?: number;
}

/** "2.285185" → 2285185n at 6 decimals. */
export function parseUnits(value: string, decimals: number): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!m) throw new Error(`invalid decimal "${value}"`);
  const frac = (m[2] ?? "").padEnd(decimals, "0");
  if (frac.length > decimals) throw new Error(`"${value}" has more than ${decimals} decimals`);
  return BigInt(m[1] ?? "0") * 10n ** BigInt(decimals) + BigInt(frac || "0");
}

function classify(status: number, errorCode: string | undefined): HodleErrorKind {
  if (errorCode === "SANDBOX_INSUFFICIENT_BALANCE" || errorCode === "INSUFFICIENT_BALANCE") return "insufficient_float";
  if (errorCode === "SANDBOX_SETTLEMENT_FAILED") return "settlement_failed";
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 409) return "busy";
  if (status === 429 || status >= 500 || status === 0) return "unavailable";
  return "invalid_request";
}

export class HodleClient {
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  readonly #retryDelayMs: number;
  readonly #timeoutMs: number;
  readonly #maxAttempts: number;

  constructor(opts: HodleClientOptions) {
    const host = (() => {
      try {
        return new URL(opts.baseUrl).hostname;
      } catch {
        return "";
      }
    })();
    if (!SANDBOX_HOST.test(host)) throw new Error("HodleClient accepts the sandbox host only (INV-07)");
    this.#baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.#apiKey = opts.apiKey;
    this.#fetch = opts.fetch ?? fetch;
    this.#retryDelayMs = opts.retryDelayMs ?? 500;
    this.#timeoutMs = opts.timeoutMs ?? 30_000;
    this.#maxAttempts = opts.maxAttempts ?? 3;
  }

  async #request<T>(method: "GET" | "POST", path: string, body: unknown, retry: boolean): Promise<T> {
    const attempts = retry ? this.#maxAttempts : 1;
    let last: HodleError | undefined;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      let res: Response;
      try {
        res = await this.#fetch(`${this.#baseUrl}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${this.#apiKey}`,
            accept: "application/json",
            ...(body === undefined ? {} : { "content-type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(this.#timeoutMs),
        });
      } catch (err) {
        last = new HodleError({
          status: 0,
          kind: "unavailable",
          reason: err instanceof Error ? err.message : "request failed",
          path: `${method} ${path}`,
          outcomeUnknown: method === "POST",
        });
        if (attempt < attempts) await new Promise((r) => setTimeout(r, this.#retryDelayMs * 2 ** (attempt - 1)));
        continue;
      }
      const parsed = (await res.json().catch(() => undefined)) as Record<string, unknown> | undefined;
      if (res.ok) return parsed as T;
      const errorCode = typeof parsed?.errorCode === "string" ? parsed.errorCode : undefined;
      const message =
        (typeof parsed?.error === "string" && parsed.error) ||
        (typeof parsed?.message === "string" && parsed.message) ||
        "";
      const kind = classify(res.status, errorCode);
      last = new HodleError({
        status: res.status,
        ...(errorCode ? { errorCode } : {}),
        kind,
        reason: (message.split("\n")[0] ?? "").slice(0, 200) || `HTTP ${res.status}`,
        path: `${method} ${path}`,
        outcomeUnknown: kind === "unavailable" && method === "POST",
      });
      if (kind !== "unavailable") throw last;
      if (attempt < attempts) await new Promise((r) => setTimeout(r, this.#retryDelayMs * 2 ** (attempt - 1)));
    }
    throw (
      last ?? new HodleError({ status: 0, kind: "unavailable", reason: "no attempt made", path: `${method} ${path}` })
    );
  }

  async payout(req: PayoutRequest): Promise<PayoutResult> {
    if (Boolean(req.qrCode) === Boolean(req.pixKey)) throw new Error("payout needs exactly one of qrCode or pixKey");
    const body = {
      value: req.valueCents,
      asset: "USDH",
      network: "base",
      ...(req.qrCode ? { qrCode: req.qrCode } : { pixKey: req.pixKey?.key, pixKeyType: req.pixKey?.type }),
      externalId: req.externalId,
    };
    const r = await this.#request<Record<string, unknown>>("POST", "/api/wallet/payout", body, true);
    return {
      transactionId: String(r.transactionId),
      externalId: String(r.externalId),
      status: String(r.status) as PayoutStatus,
      debit6: parseUnits(String(r.stableAmount ?? "0"), 6),
      valueInBrl: String(r.valueInBrl),
      fee: String(r.fee),
      ...(typeof r.endToEndId === "string" ? { endToEndId: r.endToEndId } : {}),
      ...(typeof r.txHash === "string" ? { txHash: r.txHash } : {}),
      sandbox: r.sandbox === true,
    };
  }

  /** The USDH test wallet that stands in for the float (DEC-005). */
  async sandboxBalance(): Promise<{ usdh6: bigint; address: string | undefined }> {
    const r = await this.#request<{
      data: { addresses: Record<string, string>; balances: { network: string; asset: string; amount: string }[] };
    }>("GET", "/api/wallet?sync=true", undefined, true);
    const row = r.data.balances.find((b) => b.network === "base-sepolia" && b.asset === "USDH");
    return { usdh6: parseUnits(row?.amount ?? "0", 6), address: r.data.addresses["base-sepolia"] };
  }

  /** Sandbox on-ramp: a PENDING USDH charge with an unpayable BR Code (settle it with `settleSandboxDeposit`). */
  async createSandboxDeposit(
    valueCents: number,
  ): Promise<{ trackId: string; walletCharge: string; externalId: string; rate: string; fee: string }> {
    const r = await this.#request<Record<string, unknown>>(
      "POST",
      "/api/deposit/asset",
      { value: valueCents, asset: "USDH" },
      false,
    );
    return {
      trackId: String(r.trackId),
      walletCharge: String(r.walletCharge),
      externalId: String(r.externalId),
      /** BRL per USDH the deposit was priced at (`fxRateAtTx`, 5.4 in the sandbox). */
      rate: String(r.fxRateAtTx),
      /** As Hodle sends it (unit undocumented; "0" in the sandbox). */
      fee: String(r.fee ?? ""),
    };
  }

  /** Posts the PSP's DEPOSIT-SUCCESS ticket as the sandbox expects (idempotent per trackId). */
  async settleSandboxDeposit(trackId: string): Promise<boolean> {
    const r = await this.#request<{ settled?: boolean }>(
      "POST",
      "/avenia/webhook",
      { event: { subscription: "TICKET", data: { type: "DEPOSIT-SUCCESS", ticket: { id: trackId } } } },
      true,
    );
    return r.settled === true;
  }
}

/** A payout's final status as the domain input it implies; `null` while Hodle is still processing. */
export function toPayoutInput(r: PayoutResult): PaymentInput | null {
  if (r.status === "COMPLETED") {
    return {
      type: "payout.succeeded",
      transactionId: r.transactionId,
      endToEndId: r.endToEndId ?? "",
      txHash: r.txHash ?? "",
      debit6: r.debit6,
    };
  }
  if (r.status === "FAILED" || r.status === "REFUNDED")
    return { type: "payout.failed", reason: `Hodle status ${r.status}` };
  return null;
}
