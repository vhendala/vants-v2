// Etherfuse's ramp API, sandbox only (T-026, INV-07): a person pays reais by Pix and receives a Stellar asset (USDC, or the
// TESOURO stablebond) in their own account. Shapes follow the run that completed end to end in
// an Etherfuse demo (EXAMPLE_RUN.md) and earlier prototype `lib/anchors/etherfuse`:
//   onboarding-url (needs userInfo since 2026-08-25) → kyc identity → kyc documents → 3 agreements → bank-account (the
//   person's own Pix key; without it an order fails "Proxy account not found") → quote (2 minutes) → order → Pix paid
//   (in the sandbox: order/fiat_received) → order status created → funded → completed.
// Auth is the raw key in `Authorization` (no "Bearer"). The API refuses browsers (CORS): only the server calls it.

export const ETHERFUSE_SANDBOX = "https://api.sand.etherfuse.com";

/** What the mini app sells for reais on testnet (checked against /ramp/assets on 2026-10-23). */
export const RAMP_TARGETS = {
  /** Circle's testnet USDC: the asset Vants pays Pix with, so it's spendable as soon as it arrives. */
  USDC: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  /** Etherfuse's TESOURO stablebond: Brazilian government debt, earning in reais. */
  TESOURO: "TESOURO:GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4",
} as const;

export class EtherfuseError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "EtherfuseError";
    this.status = status;
  }
}

export interface Profile {
  /** Given and family names, as on the CPF. */
  givenName: string;
  familyName: string;
  /** 11 digits. */
  cpf: string;
  /** YYYY-MM-DD. */
  birthDate: string;
  email: string;
  /** +55 and digits. */
  phone: string;
  occupation: string;
  address: { street: string; city: string; region: string; postalCode: string };
}

export interface Quote {
  quoteId: string;
  sourceAmount: string;
  destinationAmount: string;
  exchangeRate: string;
  feeBps: string;
  feeAmount: string;
  expiresAt: string;
}

export interface Order {
  orderId: string;
  status: "created" | "funded" | "completed" | "failed" | "refunded" | "canceled" | string;
  amountInFiat?: string;
  amountInTokens?: string;
  /** The Stellar transaction that delivered the tokens. */
  confirmedTxSignature?: string;
  depositPixCode?: string;
  depositPixKey?: string;
  depositAmount?: string;
  /** Etherfuse's own page for the order (the sandbox gives one even when it has no Pix code: 2026-10-23). */
  statusPage?: string;
}

/** A sandbox-only stand-in for document photos (a 1×1 JPEG), as earlier prototype `mock-identity.ts` sends. */
const PLACEHOLDER_JPEG =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

export class EtherfuseClient {
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;

  constructor(opts: { baseUrl: string; apiKey: string; fetch?: typeof fetch }) {
    const host = new URL(opts.baseUrl).host;
    if (host !== new URL(ETHERFUSE_SANDBOX).host)
      throw new Error(`Etherfuse ${host}: the PoC talks to the sandbox only`);
    this.#baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.#apiKey = opts.apiKey;
    this.#fetch = opts.fetch ?? fetch;
  }

  async #call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await this.#fetch(`${this.#baseUrl}${path}`, {
      method,
      headers: { authorization: this.#apiKey, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok) {
      let message = text.slice(0, 300);
      try {
        const j = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
        message = (typeof j.error === "string" ? j.error : j.error?.message) ?? j.message ?? message;
      } catch {
        // not JSON: the text is the detail
      }
      throw new EtherfuseError(`Etherfuse ${res.status} on ${path}: ${message}`, res.status);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  /**
   * Creates the customer for `publicKey` and takes them through KYC, agreements and their own Pix key, as the sandbox
   * auto-approves. A public key already registered answers 409 "see org: <id>": that customer is reused, with the bank
   * account it already has.
   */
  async onboard(publicKey: string, p: Profile): Promise<{ customerId: string; bankAccountId: string }> {
    let customerId: string = crypto.randomUUID();
    let bankAccountId: string = crypto.randomUUID();
    let presignedUrl: string;
    try {
      ({ presigned_url: presignedUrl } = await this.#onboardingUrl(customerId, bankAccountId, publicKey, p));
    } catch (err) {
      const existing =
        err instanceof EtherfuseError && err.status === 409 ? /see org:\s*([0-9a-f-]{36})/i.exec(err.message) : null;
      if (!existing?.[1]) throw err;
      customerId = existing[1];
      const accounts = await this.bankAccounts(customerId);
      const brl = accounts.find((a) => a.currency === "brl" && a.status === "active");
      if (brl) return { customerId, bankAccountId: brl.id };
      ({ presigned_url: presignedUrl } = await this.#onboardingUrl(customerId, bankAccountId, publicKey, p));
    }
    await this.#call("POST", `/ramp/customer/${customerId}/kyc`, {
      pubkey: publicKey,
      identity: {
        id: publicKey,
        email: p.email,
        phoneNumber: p.phone,
        occupation: p.occupation,
        name: { givenName: p.givenName, familyName: p.familyName },
        dateOfBirth: p.birthDate,
        // The sandbox now refuses idNumbers outside Mexico (2026-10-23: "idNumbers may only be provided when address.country
        // is MX"); the CPF reaches Etherfuse with the person's Pix account below.
        address: { ...p.address, country: "BR" },
      },
    });
    for (const doc of [
      { documentType: "document", images: [{ label: "id_front" }, { label: "id_back" }] },
      { documentType: "selfie", images: [{ label: "selfie" }] },
    ])
      await this.#call("POST", `/ramp/customer/${customerId}/kyc/documents`, {
        pubkey: publicKey,
        documentType: doc.documentType,
        images: doc.images.map((i) => ({ ...i, image: PLACEHOLDER_JPEG })),
      });
    for (const a of ["electronic-signature", "terms-and-conditions", "customer-agreement"]) {
      try {
        await this.#call("POST", `/ramp/agreements/${a}`, { presignedUrl });
      } catch (err) {
        // The sandbox retired these (2026-10-23: 410 "endpoint_removed"): nothing left to accept.
        if (!(err instanceof EtherfuseError && err.status === 410)) throw err;
      }
    }
    const bank = await this.#call<{ accountId: string }>("POST", "/ramp/bank-account", {
      presignedUrl,
      account: {
        transactionId: crypto.randomUUID(),
        firstName: p.givenName,
        lastName: p.familyName,
        pixKey: p.cpf,
        pixKeyType: "cpf",
        cpf: p.cpf,
      },
    });
    bankAccountId = bank.accountId || bankAccountId;
    return { customerId, bankAccountId };
  }

  #onboardingUrl(customerId: string, bankAccountId: string, publicKey: string, p: Profile) {
    return this.#call<{ presigned_url: string }>("POST", "/ramp/onboarding-url", {
      customerId,
      bankAccountId,
      publicKey,
      blockchain: "stellar",
      userInfo: { email: p.email, displayName: `${p.givenName} ${p.familyName}` },
    });
  }

  async kycStatus(customerId: string, publicKey: string): Promise<string> {
    return (await this.#call<{ status: string }>("GET", `/ramp/customer/${customerId}/kyc/${publicKey}`)).status;
  }

  async bankAccounts(customerId: string): Promise<{ id: string; currency?: string; status?: string }[]> {
    const r = await this.#call<{
      items?: { bankAccountId?: string; id?: string; currency?: string; status?: string }[];
    }>("POST", `/ramp/customer/${customerId}/bank-accounts`, { pageSize: 20, pageNumber: 0 });
    return (r.items ?? []).map((a) => ({
      id: a.bankAccountId ?? a.id ?? "",
      ...(a.currency ? { currency: a.currency } : {}),
      ...(a.status ? { status: a.status } : {}),
    }));
  }

  /** What `amountBrl` buys of `targetAsset` (CODE:ISSUER), valid for about two minutes. */
  async quote(customerId: string, targetAsset: string, amountBrl: string): Promise<Quote> {
    const q = await this.#call<Quote>("POST", "/ramp/quote", {
      quoteId: crypto.randomUUID(),
      customerId,
      blockchain: "stellar",
      quoteAssets: { type: "onramp", sourceAsset: "BRL", targetAsset },
      sourceAmount: amountBrl,
    });
    return q;
  }

  async order(input: { bankAccountId: string; publicKey: string; quoteId: string }): Promise<Order> {
    const orderId = crypto.randomUUID();
    const r = await this.#call<{ onramp?: Order }>("POST", "/ramp/order", { orderId, ...input });
    return { status: "created", ...(r.onramp ?? {}), orderId: r.onramp?.orderId ?? orderId };
  }

  async getOrder(orderId: string): Promise<Order> {
    return this.#call<Order>("GET", `/ramp/order/${orderId}`);
  }

  /** Sandbox only: marks the order's Pix as received, which starts the delivery. */
  async simulatePaid(orderId: string): Promise<void> {
    await this.#call("POST", "/ramp/order/fiat_received", { orderId });
  }
}
