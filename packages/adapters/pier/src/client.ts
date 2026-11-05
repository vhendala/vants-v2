// Pier over its REST API (worker only, DEC-003, DEC-012, DEC-063). One payment subscription on the treasury, testnet only.
import type { PierEnvelope } from "./envelope.ts";

export interface PierGatewayOptions {
  apiUrl: string;
  apiKey: string;
}

interface PierSubscription {
  id: string;
  network: string;
  filter: unknown;
  webhook?: { url?: string; secret?: string };
}

export class PierError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "PierError";
    this.status = status;
  }
}

export class PierGateway {
  readonly #apiKey: string;
  readonly #apiUrl: string;

  constructor(opts: PierGatewayOptions) {
    this.#apiKey = opts.apiKey;
    this.#apiUrl = opts.apiUrl;
  }

  async #call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await fetch(new URL(path, this.#apiUrl), {
      method,
      headers: { "x-api-key": this.#apiKey, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new PierError(res.status, json.error ?? `HTTP ${res.status}`);
    return json as T;
  }

  /**
   * The treasury's incoming-payment subscription, created once (DEC-003). Reuses any testnet subscription with the same
   * filter (and the same webhook URL when one is given). A new subscription's webhook secret is returned only here.
   */
  async ensureTreasurySubscription(
    account: string,
    webhookUrl?: string,
  ): Promise<{ id: string; created: boolean; webhookSecret?: string }> {
    const { subscriptions } = await this.#call<{ subscriptions: PierSubscription[] }>("GET", "/v1/subscriptions");
    const existing = subscriptions.find((s) => {
      const f = s.filter as { type?: string; account?: string; direction?: string };
      return (
        s.network === "testnet" &&
        f.type === "payment" &&
        f.account === account &&
        (f.direction ?? "any") === "in" &&
        (webhookUrl === undefined || s.webhook?.url === webhookUrl)
      );
    });
    if (existing) return { id: existing.id, created: false };

    const created = await this.#call<PierSubscription>("POST", "/v1/subscriptions", {
      filter: { type: "payment", account, direction: "in" },
      network: "testnet",
      ...(webhookUrl ? { webhook: { url: webhookUrl } } : {}),
    });
    return {
      id: created.id,
      created: true,
      ...(created.webhook?.secret ? { webhookSecret: created.webhook.secret } : {}),
    };
  }

  /** One page of the subscription's events after `after`, in log order (gap-free within Pier's retention). */
  async page(
    subscriptionId: string,
    after: string | undefined,
    limit: number,
  ): Promise<{ events: PierEnvelope[]; next: string }> {
    const query = new URLSearchParams({ after: after ?? "0", limit: String(limit) });
    return this.#call<{ events: PierEnvelope[]; next: string }>(
      "GET",
      `/v1/subscriptions/${encodeURIComponent(subscriptionId)}/events?${query}`,
    );
  }
}
