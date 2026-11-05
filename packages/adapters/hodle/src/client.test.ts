// Hodle sandbox client against recorded exchanges from the spike (T-006).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HodleClient, HodleError, toPayoutInput } from "./client.ts";

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../test/fixtures/${name}.json`, import.meta.url), "utf8")) as {
    request: { method: string; url: string; body: unknown };
    response: { status: number; headers: Record<string, string>; body: unknown };
  };

const KEY = `hodle_test_${"ab".repeat(32)}`;
const BASE = "https://sandbox-api.hodle.com.br";

interface Call {
  url: string;
  init: RequestInit;
}
/** A fetch that replays responses in order and records each call. */
function replay(...responses: Array<{ status: number; body: unknown } | Error>) {
  const calls: Call[] = [];
  const fetchFn = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("no more recorded responses");
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, fetchFn: fetchFn as typeof fetch };
}

const client = (fetchFn: typeof fetch) =>
  new HodleClient({ baseUrl: BASE, apiKey: KEY, fetch: fetchFn, retryDelayMs: 1 });

describe("payout", () => {
  const ok = fixture("payout-completed");
  const req = ok.request.body as { value: number; qrCode: string; externalId: string };

  it("POSTs the USDH payout with Bearer auth and parses the 202", async () => {
    const { calls, fetchFn } = replay(ok.response);
    const r = await client(fetchFn).payout({ valueCents: req.value, qrCode: req.qrCode, externalId: req.externalId });
    expect(calls[0]?.url).toBe(`${BASE}/api/wallet/payout`);
    expect(calls[0]?.init.method).toBe("POST");
    expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      value: req.value,
      asset: "USDH",
      network: "base",
      qrCode: req.qrCode,
      externalId: req.externalId,
    });
    expect(r).toMatchObject({
      transactionId: "6ada6a513d373872025e1cdf",
      status: "COMPLETED",
      debit6: 2_285_185n,
      sandbox: true,
    });
  });

  it("maps a COMPLETED payout to the domain's payout.succeeded", async () => {
    const { fetchFn } = replay(ok.response);
    const r = await client(fetchFn).payout({ valueCents: req.value, qrCode: req.qrCode, externalId: req.externalId });
    expect(toPayoutInput(r)).toEqual({
      type: "payout.succeeded",
      transactionId: "6ada6a513d373872025e1cdf",
      endToEndId: "SANDBOX5BAA9F4CCA844630AB7EC7300",
      txHash: "0xccc48d16078d8d95bf1761d57c2047d41f2da463490ab22252f60af0aa44dbed",
      debit6: 2_285_185n,
    });
  });

  it.each([
    ["payout-insufficient-balance", "insufficient_float", 400, "SANDBOX_INSUFFICIENT_BALANCE"],
    ["payout-settlement-failed", "settlement_failed", 422, "SANDBOX_SETTLEMENT_FAILED"],
    ["payout-missing-value", "invalid_request", 400, undefined],
  ])("classifies %s as %s (no retry)", async (name, kind, status, errorCode) => {
    const { calls, fetchFn } = replay(fixture(name).response);
    const err = await client(fetchFn)
      .payout({ valueCents: 100, qrCode: req.qrCode, externalId: "x" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HodleError);
    expect(err).toMatchObject({ kind, status, ...(errorCode ? { errorCode } : {}) });
    expect(calls).toHaveLength(1);
  });

  it("retries network errors and 5xx with the same externalId, then reports an unknown outcome", async () => {
    const { calls, fetchFn } = replay(
      new TypeError("fetch failed"),
      { status: 503, body: {} },
      { status: 502, body: {} },
    );
    const err = await client(fetchFn)
      .payout({ valueCents: 100, qrCode: req.qrCode, externalId: "vants:pay_9" })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: "unavailable", outcomeUnknown: true });
    expect(calls).toHaveLength(3);
    for (const c of calls) expect(JSON.parse(String(c.init.body)).externalId).toBe("vants:pay_9");
  });

  it("succeeds on a retry after a transient failure", async () => {
    const { calls, fetchFn } = replay({ status: 503, body: {} }, ok.response);
    const r = await client(fetchFn).payout({ valueCents: req.value, qrCode: req.qrCode, externalId: req.externalId });
    expect(r.status).toBe("COMPLETED");
    expect(calls).toHaveLength(2);
  });

  it("requires exactly one of qrCode or pixKey", async () => {
    const { fetchFn } = replay();
    await expect(client(fetchFn).payout({ valueCents: 100, externalId: "x" })).rejects.toThrow(/qrCode or pixKey/);
    await expect(
      client(fetchFn).payout({
        valueCents: 100,
        externalId: "x",
        qrCode: "q",
        pixKey: { key: "a@b.c", type: "EMAIL" },
      }),
    ).rejects.toThrow(/qrCode or pixKey/);
  });
});

describe("float and funding (sandbox)", () => {
  it("reads the USDH test-wallet balance in micros", async () => {
    const { fetchFn } = replay(fixture("wallet").response);
    const w = await client(fetchFn).sandboxBalance();
    expect(typeof w.usdh6).toBe("bigint");
    expect(w.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("creates a USDH deposit and settles it by trackId", async () => {
    const dep = fixture("deposit-usdh");
    const settle = fixture("settle-deposit");
    const { calls, fetchFn } = replay(dep.response, settle.response);
    const c = client(fetchFn);
    const d = await c.createSandboxDeposit(5400);
    expect(d.trackId).toMatch(/^[0-9a-f-]{36}$/);
    expect([d.rate, d.fee]).toEqual(["5.4", "0"]);
    expect(await c.settleSandboxDeposit(d.trackId)).toBe(true);
    expect(calls[1]?.url).toBe(`${BASE}/avenia/webhook`);
  });
});

describe("safety", () => {
  it("refuses a non-sandbox host (INV-07, defence in depth)", () => {
    const prod = `https://${["api", "hodle", "com", "br"].join(".")}`;
    expect(() => new HodleClient({ baseUrl: prod, apiKey: KEY })).toThrow(/sandbox/);
  });

  it("never puts the API key in an error", async () => {
    const { fetchFn } = replay({ status: 401, body: { message: "Unauthorized" } });
    const err = await client(fetchFn)
      .sandboxBalance()
      .catch((e: unknown) => e);
    expect(String((err as Error).message)).not.toContain(KEY);
    expect(JSON.stringify(err)).not.toContain(KEY);
  });
});
