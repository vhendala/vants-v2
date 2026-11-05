// T-026: the Etherfuse adapter against a recorded-shape fake. It must talk to the sandbox only, send the raw key, and take a
// person from nothing to a customer with their own Pix key in the order the sandbox accepts.
import { describe, expect, it } from "vitest";
import { EtherfuseClient, EtherfuseError, type Profile } from "./client.ts";

const profile: Profile = {
  givenName: "Maria",
  familyName: "Souza",
  cpf: "11157227783",
  birthDate: "1995-04-12",
  email: "maria@exemplo.com.br",
  phone: "+5511987654321",
  occupation: "Designer",
  address: { street: "Rua Augusta 100", city: "São Paulo", region: "SP", postalCode: "01304-000" },
};
const PUB = "GCYGHQHGHVQALH4TFUA4EZKQXZQAJ2PFSOXOVVH7UTT6ZNM4BQMVPLOP";

function fake(handlers: Record<string, (body: unknown) => { status?: number; body?: unknown }>) {
  const calls: { method: string; path: string; body: unknown; auth: string | null }[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const auth = new Headers(init?.headers).get("authorization");
    calls.push({ method: init?.method ?? "GET", path: u.pathname, body, auth });
    const key = Object.keys(handlers).find((k) => new RegExp(`^${k}$`).test(`${init?.method ?? "GET"} ${u.pathname}`));
    const r = key ? handlers[key]?.(body) : { status: 404, body: { error: { message: "nope" } } };
    return new Response(r?.body === undefined ? "" : JSON.stringify(r.body), { status: r?.status ?? 200 });
  }) as typeof fetch;
  return { f, calls };
}

describe("EtherfuseClient", () => {
  it("refuses any host but the sandbox", () => {
    expect(() => new EtherfuseClient({ baseUrl: "https://api.etherfuse.com", apiKey: "k" })).toThrow(/sandbox only/);
  });

  it("onboards in the order the sandbox accepts, with the person's CPF as their Pix key", async () => {
    const { f, calls } = fake({
      "POST /ramp/onboarding-url": () => ({ body: { presigned_url: "https://sign/x" } }),
      "POST /ramp/customer/[^/]+/kyc": () => ({ body: { status: "approved" } }),
      "POST /ramp/customer/[^/]+/kyc/documents": () => ({ body: {} }),
      "POST /ramp/agreements/.+": () => ({ body: {} }),
      "POST /ramp/bank-account": () => ({ body: { accountId: "bank-1", status: "active" } }),
    });
    const c = new EtherfuseClient({ baseUrl: "https://api.sand.etherfuse.com", apiKey: "raw-key", fetch: f });
    const r = await c.onboard(PUB, profile);
    expect(r.bankAccountId).toBe("bank-1");
    expect(calls.map((x) => x.path.replace(/[0-9a-f-]{36}/, "{id}"))).toEqual([
      "/ramp/onboarding-url",
      "/ramp/customer/{id}/kyc",
      "/ramp/customer/{id}/kyc/documents",
      "/ramp/customer/{id}/kyc/documents",
      "/ramp/agreements/electronic-signature",
      "/ramp/agreements/terms-and-conditions",
      "/ramp/agreements/customer-agreement",
      "/ramp/bank-account",
    ]);
    expect(calls.every((x) => x.auth === "raw-key")).toBe(true); // the raw key, no "Bearer"
    expect(calls[0]?.body).toMatchObject({ publicKey: PUB, blockchain: "stellar", userInfo: { email: profile.email } });
    expect(calls[1]?.body).toMatchObject({ identity: { address: { country: "BR" }, phoneNumber: profile.phone } });
    expect((calls[1]?.body as { identity?: object } | undefined)?.identity).not.toHaveProperty("idNumbers"); // refused for BR since 2026-10
    expect(calls[7]?.body).toMatchObject({ account: { pixKey: "11157227783", pixKeyType: "cpf", cpf: "11157227783" } });
  });

  it("reuses a customer the sandbox already knows (409 see org), with its bank account", async () => {
    const existing = "0b5e7a3c-1111-4222-8333-444455556666";
    const { f, calls } = fake({
      "POST /ramp/onboarding-url": () => ({
        status: 409,
        body: { error: { message: `already registered, see org: ${existing}` } },
      }),
      "POST /ramp/customer/[^/]+/bank-accounts": () => ({
        body: { items: [{ bankAccountId: "bank-9", currency: "brl", status: "active" }] },
      }),
    });
    const c = new EtherfuseClient({ baseUrl: "https://api.sand.etherfuse.com", apiKey: "k", fetch: f });
    expect(await c.onboard(PUB, profile)).toEqual({ customerId: existing, bankAccountId: "bank-9" });
    expect(calls).toHaveLength(2);
  });

  it("says what failed, with the API's own message", async () => {
    const { f } = fake({
      "POST /ramp/quote": () => ({ status: 400, body: { error: { message: "Proxy account not found" } } }),
    });
    const c = new EtherfuseClient({ baseUrl: "https://api.sand.etherfuse.com", apiKey: "k", fetch: f });
    const err = await c.quote("c", "USDC:G", "100").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EtherfuseError);
    expect((err as EtherfuseError).message).toContain("Proxy account not found");
  });
});
