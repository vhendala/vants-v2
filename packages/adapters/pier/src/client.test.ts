// PierGateway over the published SDK, with fetch stubbed (T-008).
import { afterEach, describe, expect, it, vi } from "vitest";
import { PierGateway } from "./client.ts";

const TREASURY = "GCOLMOCVEHQU7QQNKF45LVJM4S4XGSGRIWWNNZGZ3VD5XKUIUAXWAJC2";
const API = "https://pier.test";

interface Req {
  method: string;
  url: string;
  body?: unknown;
}
function stubPier(subscriptions: object[]) {
  const reqs: Req[] = [];
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    reqs.push({ method, url: u, body });
    const json = (status: number, b: unknown) =>
      new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    if (u.endsWith("/v1/subscriptions") && method === "GET") return json(200, { subscriptions });
    if (u.endsWith("/v1/subscriptions") && method === "POST") {
      const created = {
        id: "sub_new",
        network: "testnet",
        filter: body.filter,
        webhook: body.webhook ? { url: body.webhook.url, secret: "whsec_new" } : null,
        status: "pending",
        cappedUntil: null,
        createdAt: "now",
      };
      return json(201, created);
    }
    if (u.includes("/events")) return json(200, { events: [{ position: "11" }, { position: "12" }], next: "12" });
    return json(404, { error: "not found" });
  });
  return reqs;
}

afterEach(() => vi.unstubAllGlobals());

const existing = (over: object = {}) => ({
  id: "sub_old",
  network: "testnet",
  filter: { type: "payment", account: TREASURY, direction: "in" },
  webhook: null,
  status: "active",
  cappedUntil: null,
  createdAt: "then",
  ...over,
});

describe("ensureTreasurySubscription", () => {
  it("reuses a matching testnet subscription instead of creating another (idempotent)", async () => {
    const reqs = stubPier([existing()]);
    const r = await new PierGateway({ apiUrl: API, apiKey: "k" }).ensureTreasurySubscription(TREASURY);
    expect(r).toEqual({ id: "sub_old", created: false });
    expect(reqs.filter((q) => q.method === "POST")).toEqual([]);
  });

  it("creates the payment subscription (direction in) when none matches, returning the webhook secret once", async () => {
    const reqs = stubPier([existing({ filter: { type: "payment", account: "GOTHER", direction: "in" } })]);
    const r = await new PierGateway({ apiUrl: API, apiKey: "k" }).ensureTreasurySubscription(
      TREASURY,
      "https://vants.test/ingress/pier",
    );
    expect(r).toEqual({ id: "sub_new", created: true, webhookSecret: "whsec_new" });
    expect(reqs.find((q) => q.method === "POST")?.body).toEqual({
      filter: { type: "payment", account: TREASURY, direction: "in" },
      network: "testnet",
      webhook: { url: "https://vants.test/ingress/pier" },
    });
  });

  it("never matches a mainnet subscription (INV-07)", async () => {
    stubPier([existing({ network: "mainnet" })]);
    const r = await new PierGateway({ apiUrl: API, apiKey: "k" }).ensureTreasurySubscription(TREASURY);
    expect(r.created).toBe(true);
  });
});

describe("page", () => {
  it("reads one page after a cursor", async () => {
    const reqs = stubPier([]);
    const r = await new PierGateway({ apiUrl: API, apiKey: "k" }).page("sub_old", "10", 2);
    expect(r.next).toBe("12");
    expect(r.events.map((e) => e.position)).toEqual(["11", "12"]);
    expect(reqs[0]?.url).toBe(`${API}/v1/subscriptions/sub_old/events?after=10&limit=2`);
  });
});
