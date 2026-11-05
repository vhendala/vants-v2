// The mini app's backend (SPEC §5.3): SEP-10 login and the /app endpoints, on the same origin.

export interface Position {
  id: string;
  kind: "classic" | "defindex";
  asset: string;
  vault?: string;
  shares?: string;
  amount: string;
  valueUsd: string | null;
  /** What it can pay now, when that differs from its worth (lumens invested, at the AMM's price; T-026). */
  payableUsd?: string;
  /** Lumens invested that come out of the vault before paying (2 confirmations; T-026). */
  unyield?: true;
  pricing: "par" | "estimated" | "unpriced";
  payable: boolean;
  exit: { steps: number; slippageBps: number; estimated: boolean };
}

export interface Portfolio {
  account: string;
  funded: boolean;
  positions: Position[];
  totalUsd: string;
  /** BRL per USD, for showing balances in reais (estimates until a quote fixes the price). */
  rate?: string;
}

/** Where a Pix goes: a QR code (its amount, when the code has none) or a Pix key with its type and the amount. */
export type Destination =
  | { type: "br_code"; brCode: string; amountBrl?: string }
  | { type: "pix_key"; key: string; keyType: PixKeyType; amountBrl: string };

export type PixKeyType = "CPF" | "CNPJ" | "EMAIL" | "PHONE" | "RANDOM";

export interface Priced {
  amountBrl: string;
  feeBrl: string;
  rate: string;
  payee?: { name: string; city: string; key?: string };
  pixKey?: string;
  pixKeyType?: PixKeyType;
  assets: { asset: string; assetAmount: string }[];
  portfolio: Portfolio;
}

export interface Exit {
  id: string;
  paymentId: string;
  route: "classic" | "router";
  amountBrl: string;
  asset: string;
  assetAmount: string;
  transaction: { xdr: string; hash: string; maxTime: number; summary: string[] };
}

export type PaymentStatus =
  | "awaiting_deposit"
  | "funded"
  | "paying"
  | "completed"
  | "refunding"
  | "refunded"
  | "expired";

export interface PaymentView {
  id: string;
  status: PaymentStatus;
  quote: {
    destination:
      | { type: "br_code"; payee: { name: string; city: string; key?: string } }
      | { type: "pix_key"; key: string; keyType: PixKeyType };
    amountBrl: string;
    feeBrl: string;
    asset: string;
    assetAmount: string;
    rate: string;
  };
  funding: { txHash: string; ledgerClosedAt: string; amount: string } | null;
  payout: { endToEndId: string; txHash: string } | null;
  refunds: { amount: string; reason: string; status: string; txHash: string | null }[];
  timeline: { status: string; at: string }[];
}

export interface ExitView {
  id: string;
  route: string;
  status: "built" | "submitted";
  createdAt: string;
  /** The positions it was paid from, with the amount (quote asset) chosen from each when the user set one. */
  picks: (string | { id: string; amount?: string })[];
  transaction: { hash: string; maxTime: number; summary: string[] };
  payment: PaymentView;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly reason?: string;

  constructor(status: number, code: string, message: string, reason?: string) {
    super(message);
    this.status = status;
    this.code = code;
    if (reason) this.reason = reason;
  }
}

let token: string | null = null;
let onUnauthorized: () => void = () => undefined;
export const setToken = (t: string | null) => {
  token = t;
};
/** Called when the API says the session is no longer valid (expired or revoked). */
export const whenUnauthorized = (fn: () => void) => {
  onUnauthorized = fn;
};

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, "OFFLINE", "Sem conexão. Confira a internet e tente de novo.");
  }
  const json = (await res.json().catch(() => ({}))) as T & {
    error?: { code?: string; message?: string } | string;
    reason?: string;
  };
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized();
    const e = json.error;
    throw typeof e === "string"
      ? new ApiError(res.status, "AUTH", e)
      : new ApiError(res.status, e?.code ?? "ERROR", e?.message ?? `HTTP ${res.status}`, json.reason);
  }
  return json;
}

export type Pick = { id: string; amount: string };

/** A DeFindex vault on offer (T-026): its yield as DeFindex reports it, what the account has in it and could put in. */
export interface Vault {
  id: string;
  name: string;
  asset: string;
  unit: "USDC" | "XLM" | string;
  apyPercent: number | null;
  invested: string;
  canInvest: string;
}

/** Tesouro, bought and sold on the order book (T-029); null where it can't be traded. */
export interface Tesouro {
  asset: string;
  /** Units held. */
  held: string;
  /** What selling all of it gives now, in dollars; null when the book can't say. */
  valueUsd: string | null;
  /** The wallet accepts Tesouro (a trustline). */
  trusted: boolean;
  /** The most it can buy now, in dollars (from dollars or lumens, whichever has more). */
  canBuyUsd: string;
}

/** One transaction the wallet signs that isn't a Pix: investing, taking out, accepting an asset, or trading Tesouro. */
export interface Action {
  id: string;
  kind: "invest" | "redeem" | "trustline" | "trade";
  transaction: { xdr: string; hash: string; maxTime: number; summary: string[] };
}
export interface ActionView extends Omit<Action, "transaction"> {
  status: "built" | "submitted" | "done" | "failed";
  transaction: { hash: string; maxTime: number; summary: string[] };
}

/** A signed action as Atividade shows it (T-033). Amounts are as built: `amount` in the vault's asset, `amountBrl` for a
 * Tesouro trade (absent when everything was sold). */
export interface ActionActivity {
  id: string;
  kind: "invest" | "redeem" | "trustline" | "trade";
  status: "submitted" | "done" | "failed";
  detail: { vault?: string; amount?: string; side?: "buy" | "sell"; amountBrl?: string; asset?: string };
  vault: { id: string; asset: string; name: string } | null;
  createdAt: string;
  transaction: { hash: string; summary: string[] };
}

/** One line of Atividade: a Pix paid, something done with investments or Tesouro, or money added by Pix (T-033). */
export type ActivityItem = { id: string; createdAt: string } & (
  | { type: "payment"; exit: ExitView }
  | { type: "action"; action: ActionActivity }
  | { type: "deposit"; order: RampOrder }
);

export type RampTarget = "USDC" | "TESOURO";
export interface RampProfile {
  givenName: string;
  familyName: string;
  cpf: string;
  birthDate: string;
  email: string;
  phone: string;
  occupation: string;
  address: { street: string; city: string; region: string; postalCode: string };
}
export interface RampQuote {
  quoteId: string;
  target: RampTarget;
  amountBrl: string;
  receive: string;
  feeBrl: string;
  expiresAt: string;
  needsTrustline: boolean;
}
export interface RampOrder {
  id: string;
  target: RampTarget | string;
  amountBrl: string;
  receive: string;
  feeBrl: string;
  status: "created" | "funded" | "completed" | "failed" | "refunded" | "canceled" | string;
  pixCode: string | null;
  deliveredTx: string | null;
  createdAt: string;
  updatedAt: string;
  /** Etherfuse's page for the order, when it sent one. */
  statusPage?: string | null;
}
export interface RampState {
  available: boolean;
  sandbox: boolean;
  profile: { displayName: string; email: string } | null;
  targets: RampTarget[];
  orders: RampOrder[];
}

export const api = {
  challenge: (account: string) =>
    call<{ transaction: string; network_passphrase: string }>("GET", `/auth?account=${account}`),
  token: (transaction: string) => call<{ token: string }>("POST", "/auth", { transaction }),
  portfolio: () => call<Portfolio>("GET", "/app/portfolio"),
  price: (destination: Destination) => call<Priced>("POST", "/app/exits/quote", { destination }),
  createExit: (destination: Destination, picks: Pick[]) => call<Exit>("POST", "/app/exits", { destination, picks }),
  limits: () => call<{ maxBrl: string }>("GET", "/app/limits"),
  exits: (opts: { limit?: number; before?: string } = {}) => {
    const q = new URLSearchParams();
    if (opts.limit) q.set("limit", String(opts.limit));
    if (opts.before) q.set("before", opts.before);
    return call<{ items: ExitView[]; next: string | null; month: { paidBrl: string; count: number } }>(
      "GET",
      `/app/exits${q.size ? `?${q}` : ""}`,
    );
  },
  activity: (opts: { limit?: number; before?: string } = {}) => {
    const q = new URLSearchParams();
    if (opts.limit) q.set("limit", String(opts.limit));
    if (opts.before) q.set("before", opts.before);
    return call<{ items: ActivityItem[]; next: string | null; month: { paidBrl: string; count: number } }>(
      "GET",
      `/app/activity${q.size ? `?${q}` : ""}`,
    );
  },
  exit: (id: string) => call<ExitView>("GET", `/app/exits/${id}`),
  submit: (id: string, signedXdr: string) =>
    call<{ status: string; txHash: string }>("POST", `/app/exits/${id}/submit`, { signedXdr }),

  invest: () => call<{ vaults: Vault[]; rate: string; tesouro?: Tesouro | null }>("GET", "/app/invest"),
  tesouro: (side: "buy" | "sell", amount: { amountBrl: string } | { all: true }) =>
    call<Action>("POST", "/app/tesouro", { side, ...amount }),
  deposit: (vault: string, amount: string) => call<Action>("POST", "/app/invest", { vault, amount }),
  redeem: (vault: string, amount: string) => call<Action>("POST", "/app/redeem", { vault, amount }),
  action: (id: string) => call<ActionView>("GET", `/app/actions/${id}`),
  submitAction: (id: string, signedXdr: string) =>
    call<{ status: string; txHash: string }>("POST", `/app/actions/${id}/submit`, { signedXdr }),

  ramp: () => call<RampState>("GET", "/app/ramp"),
  rampProfile: (p: RampProfile) => call<{ displayName: string; email: string }>("POST", "/app/ramp/profile", p),
  rampQuote: (target: RampTarget, amountBrl: string) =>
    call<RampQuote>("POST", "/app/ramp/quote", { target, amountBrl }),
  rampTrustline: (target: RampTarget) => call<Action | { needed: false }>("POST", "/app/ramp/trustline", { target }),
  rampOrder: (quoteId: string) => call<RampOrder>("POST", "/app/ramp/orders", { quoteId }),
  rampSimulatePaid: (id: string) => call<{ status: string }>("POST", `/app/ramp/orders/${id}/simulate-payment`),
  rampOrderStatus: (id: string) => call<RampOrder>("GET", `/app/ramp/orders/${id}`),
};
