// T-010: Vants Pay REST v0 on a real Postgres. Every response is also checked against its documented schema.
import type { ApiConfig } from "@vants/config";
import { type Backbone, createBackbone, createIntegrator, migrate } from "@vants/db";
import { buildStaticBrCode } from "@vants/pix";
import { Keypair, MuxedAccount } from "@stellar/stellar-sdk";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPostgres, type TestPostgres } from "../../../../packages/db/test/postgres.ts";
import { buildApp } from "../app.ts";
import {
  CreatePaymentResponse,
  ErrorResponse,
  PaymentResponse,
  QuoteResponse,
  WebhookEndpointCreated,
  WebhookEndpointList,
} from "./schemas.ts";

const CIRCLE_USDC = "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const PEPPER = "p".repeat(32);
const treasury = Keypair.random().publicKey();
const merchant = { key: "pix-spike@vants.example.com", merchantName: "VANTS TESTE", merchantCity: "SAO PAULO" };

let pgc: TestPostgres;
let bb: Backbone;
let app: FastifyInstance;
let clock = new Date("2026-10-22T12:00:00.000Z");
let keyA = "";
let keyB = "";

const config: ApiConfig = {
  databaseUrl: "",
  port: 0,
  treasuryAccount: treasury,
  fundingAssets: [CIRCLE_USDC],
  pricing: { rateBrlPerUsd: "5.4", feeModel: "sandbox", quoteTtlSeconds: 120 },
  stellar: { rpcUrl: "", horizonUrl: "", networkPassphrase: "" },
  hodle: { webhookSecrets: {} },
  pier: { network: "testnet" },
  integratorKeyPepper: PEPPER,
};

let seq = 0;
const post = (url: string, payload: unknown, key = keyA, idem: string | null = `idem-${++seq}`) =>
  app.inject({
    method: "POST",
    url,
    headers: { "x-api-key": key, ...(idem ? { "idempotency-key": idem } : {}) },
    payload: payload as object,
  });
const get = (url: string, key = keyA) => app.inject({ method: "GET", url, headers: { "x-api-key": key } });
const errorCode = (res: { json: () => unknown }) => ErrorResponse.parse(res.json()).error.code;

beforeAll(async () => {
  pgc = await startPostgres();
  await migrate(pgc.url);
  bb = createBackbone({ databaseUrl: pgc.url });
  await bb.start();
  ({ apiKey: keyA } = await bb.withTransaction((tx) => createIntegrator(tx, "Wallet A", PEPPER)));
  ({ apiKey: keyB } = await bb.withTransaction((tx) => createIntegrator(tx, "Wallet B", PEPPER)));
  // The books are open with a large float, so quotes are coverable (T-015).
  await bb.withTransaction((tx) =>
    bb.publish(tx, [
      {
        type: "LedgerOpened",
        version: 1,
        aggregate: { type: "ledger", id: "books" },
        correlationId: "ledger",
        causationId: null,
        payload: { balances: [{ account: "float:hodle", asset: "USDH", amount: "1000000000000" }] },
      },
    ]),
  );
  app = await buildApp({ backbone: bb, config, now: () => clock });
}, 120_000);

afterAll(async () => {
  await app?.close();
  await bb?.stop();
  await pgc?.stop();
});

describe("auth", () => {
  it("refuses a missing or unknown key", async () => {
    expect((await get("/v0/payments/x", "")).statusCode).toBe(401);
    const res = await get("/v0/payments/x", "vk_test_nope");
    expect(res.statusCode).toBe(401);
    expect(errorCode(res)).toBe("UNAUTHORIZED");
  });
});

describe("POST /v0/quotes", () => {
  it("prices a BR Code with an amount at the sandbox rate (R$ 12.34 → 2.2851852 USDC)", async () => {
    const res = await post("/v0/quotes", {
      destination: { type: "br_code", brCode: buildStaticBrCode({ ...merchant, amountCents: 1234 }) },
      asset: CIRCLE_USDC,
    });
    expect(res.statusCode).toBe(201);
    const q = QuoteResponse.parse(res.json());
    expect(q).toMatchObject({
      amountBrl: "12.34",
      feeBrl: "0.00",
      assetAmount: "2.2851852",
      rate: "5.4",
      asset: CIRCLE_USDC,
      destination: {
        type: "br_code",
        payee: { name: "VANTS TESTE", city: "SAO PAULO", key: merchant.key },
        isDynamic: false,
      },
      expiresAt: "2026-10-22T12:02:00.000Z",
    });
  });

  it("prices an amount-less BR Code and a Pix key from amountBrl", async () => {
    const a = await post("/v0/quotes", {
      destination: { type: "br_code", brCode: buildStaticBrCode(merchant), amountBrl: "7" },
      asset: CIRCLE_USDC,
    });
    expect(QuoteResponse.parse(a.json()).amountBrl).toBe("7.00");
    const b = await post("/v0/quotes", {
      destination: { type: "pix_key", key: "a@b.co", keyType: "EMAIL", amountBrl: "54" },
      asset: CIRCLE_USDC,
    });
    expect(QuoteResponse.parse(b.json()).assetAmount).toBe("10");
  });

  it.each([
    [
      "bad CRC",
      { type: "br_code", brCode: `${buildStaticBrCode({ ...merchant, amountCents: 100 }).slice(0, -4)}0000` },
      "INVALID_BR_CODE",
    ],
    ["amount-less code without amountBrl", { type: "br_code", brCode: buildStaticBrCode(merchant) }, "AMOUNT_REQUIRED"],
    [
      "amountBrl that disagrees with the code",
      { type: "br_code", brCode: buildStaticBrCode({ ...merchant, amountCents: 1234 }), amountBrl: "1" },
      "AMOUNT_MISMATCH",
    ],
  ])("rejects a %s", async (_, destination, code) => {
    const res = await post("/v0/quotes", { destination, asset: CIRCLE_USDC });
    expect(res.statusCode).toBe(400);
    expect(errorCode(res)).toBe(code);
  });

  it("rejects assets outside the allowlist and malformed bodies", async () => {
    const other = "USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56";
    const res = await post("/v0/quotes", {
      destination: { type: "pix_key", key: "a@b.co", keyType: "EMAIL", amountBrl: "1" },
      asset: other,
    });
    expect(errorCode(res)).toBe("ASSET_NOT_SUPPORTED");
    expect(errorCode(await post("/v0/quotes", { destination: { type: "nope" } }))).toBe("INVALID_REQUEST");
  });

  it("requires an Idempotency-Key", async () => {
    const res = await post(
      "/v0/quotes",
      { destination: { type: "pix_key", key: "a@b.co", keyType: "EMAIL", amountBrl: "1" }, asset: CIRCLE_USDC },
      keyA,
      null,
    );
    expect(res.statusCode).toBe(400);
    expect(errorCode(res)).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });
});

describe("POST /v0/payments", () => {
  const quote = async (amountCents = 1234, key = keyA) =>
    QuoteResponse.parse(
      (
        await post(
          "/v0/quotes",
          {
            destination: { type: "br_code", brCode: buildStaticBrCode({ ...merchant, amountCents }) },
            asset: CIRCLE_USDC,
          },
          key,
        )
      ).json(),
    );

  it("returns deposit instructions: a muxed address of the treasury, the memo fallback, and the exact amount", async () => {
    const q = await quote();
    const res = await post("/v0/payments", { quoteId: q.id });
    expect(res.statusCode).toBe(201);
    const p = CreatePaymentResponse.parse(res.json());
    expect(p.status).toBe("awaiting_deposit");
    expect(p.deposit).toMatchObject({
      account: treasury,
      asset: CIRCLE_USDC,
      amount: "2.2851852",
      expiresAt: q.expiresAt,
    });
    const m = MuxedAccount.fromAddress(p.deposit.address, "0");
    expect([m.baseAccount().accountId(), m.id()]).toEqual([treasury, p.deposit.memoId]);

    const outbox = await bb.pool.query("SELECT type, correlation_id FROM outbox WHERE correlation_id = $1", [p.id]);
    expect(outbox.rows).toEqual([{ type: "PaymentAccepted", correlation_id: p.id }]);
  });

  it("replays the first response for the same Idempotency-Key, and refuses the key for another body", async () => {
    const q = await quote();
    const first = await post("/v0/payments", { quoteId: q.id }, keyA, "pay-once");
    const again = await post("/v0/payments", { quoteId: q.id }, keyA, "pay-once");
    expect(again.statusCode).toBe(201);
    expect(again.json()).toEqual(first.json());
    const other = await post(
      "/v0/payments",
      { quoteId: q.id, refundTo: Keypair.random().publicKey() },
      keyA,
      "pay-once",
    );
    expect(other.statusCode).toBe(422);
    expect(errorCode(other)).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("accepts a quote once, refuses expired quotes and other integrators' quotes", async () => {
    const q = await quote();
    expect((await post("/v0/payments", { quoteId: q.id })).statusCode).toBe(201);
    const twice = await post("/v0/payments", { quoteId: q.id });
    expect([twice.statusCode, errorCode(twice)]).toEqual([409, "QUOTE_ALREADY_USED"]);

    const foreign = await quote(1234, keyB);
    const res = await post("/v0/payments", { quoteId: foreign.id });
    expect([res.statusCode, errorCode(res)]).toEqual([404, "QUOTE_NOT_FOUND"]);

    const old = await quote();
    clock = new Date(clock.getTime() + 121_000);
    const late = await post("/v0/payments", { quoteId: old.id });
    expect([late.statusCode, errorCode(late)]).toEqual([409, "QUOTE_EXPIRED"]);
  });
});

describe("GET /v0/payments/:id", () => {
  it("shows the payment, its quote, deposit and timeline; other integrators get 404", async () => {
    const q = QuoteResponse.parse(
      (
        await post("/v0/quotes", {
          destination: { type: "pix_key", key: "a@b.co", keyType: "EMAIL", amountBrl: "5.40" },
          asset: CIRCLE_USDC,
        })
      ).json(),
    );
    const created = CreatePaymentResponse.parse((await post("/v0/payments", { quoteId: q.id })).json());
    const res = await get(`/v0/payments/${created.id}`);
    expect(res.statusCode).toBe(200);
    const p = PaymentResponse.parse(res.json());
    expect(p).toMatchObject({
      id: created.id,
      status: "awaiting_deposit",
      quote: { id: q.id, amountBrl: "5.40", assetAmount: "1" },
      deposit: created.deposit,
      funding: null,
      payout: null,
      refunds: [],
    });
    expect(p.timeline.map((t) => t.status)).toEqual(["awaiting_deposit"]);
    expect((await get(`/v0/payments/${created.id}`, keyB)).statusCode).toBe(404);
  });
});

describe("GET /v0/openapi.json", () => {
  it("documents every operation", async () => {
    const res = await app.inject({ method: "GET", url: "/v0/openapi.json" });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json().paths)).toEqual([
      "/v0/quotes",
      "/v0/payments",
      "/v0/payments/{id}",
      "/v0/webhook-endpoints",
      "/v0/webhook-endpoints/{id}",
    ]);
  });
});

describe("webhook endpoints (T-012, §5.2)", () => {
  it("registers an endpoint and returns its whsec_ secret once; lists without secrets; scoped per integrator", async () => {
    const res = await post("/v0/webhook-endpoints", { url: "https://hooks.example.com/vants" });
    expect(res.statusCode).toBe(201);
    const created = WebhookEndpointCreated.parse(res.json());
    expect(created.url).toBe("https://hooks.example.com/vants");
    expect(created.secret).toMatch(/^whsec_[A-Za-z0-9+/]{32,}={0,2}$/);

    const list = WebhookEndpointList.parse((await get("/v0/webhook-endpoints")).json());
    expect(list.endpoints.map((e) => e.id)).toContain(created.id);
    expect(JSON.stringify(list)).not.toContain(created.secret);
    expect(WebhookEndpointList.parse((await get("/v0/webhook-endpoints", keyB)).json()).endpoints).toEqual([]);
  });

  it("removes an endpoint; another integrator's id is 404", async () => {
    const created = WebhookEndpointCreated.parse(
      (await post("/v0/webhook-endpoints", { url: "http://127.0.0.1:9/hook" })).json(),
    );
    const foreign = await app.inject({
      method: "DELETE",
      url: `/v0/webhook-endpoints/${created.id}`,
      headers: { "x-api-key": keyB },
    });
    expect([foreign.statusCode, errorCode(foreign)]).toEqual([404, "WEBHOOK_ENDPOINT_NOT_FOUND"]);
    const del = await app.inject({
      method: "DELETE",
      url: `/v0/webhook-endpoints/${created.id}`,
      headers: { "x-api-key": keyA },
    });
    expect(del.statusCode).toBe(204);
    const list = WebhookEndpointList.parse((await get("/v0/webhook-endpoints")).json());
    expect(list.endpoints.map((e) => e.id)).not.toContain(created.id);
  });

  it.each([["ftp://example.com/x"], ["not a url"], [`https://example.com/${"x".repeat(2100)}`]])(
    "refuses the URL %s",
    async (url) => {
      expect(errorCode(await post("/v0/webhook-endpoints", { url }))).toBe("INVALID_REQUEST");
    },
  );
});

describe("float check (T-015, §3.7)", () => {
  it("refuses quotes and payments the float can't cover with 409 FLOAT_UNAVAILABLE", async () => {
    const body = {
      destination: { type: "pix_key", key: "a@b.co", keyType: "EMAIL", amountBrl: "5.40" },
      asset: CIRCLE_USDC,
    };
    const ok = QuoteResponse.parse((await post("/v0/quotes", body)).json());
    const holder = CreatePaymentResponse.parse((await post("/v0/payments", { quoteId: ok.id })).json());
    const pending = QuoteResponse.parse((await post("/v0/quotes", body)).json());
    // Reserve everything that is left: nothing more can be paid out.
    await bb.pool.query(
      `INSERT INTO float_reservations (payment_id, amount6)
       SELECT $1, (SELECT sum(amount) FROM ledger_entries WHERE account = 'float:hodle' AND asset = 'USDH')`,
      [holder.id],
    );
    const quote = await post("/v0/quotes", body);
    expect([quote.statusCode, errorCode(quote)]).toEqual([409, "FLOAT_UNAVAILABLE"]);
    const pay = await post("/v0/payments", { quoteId: pending.id });
    expect([pay.statusCode, errorCode(pay)]).toEqual([409, "FLOAT_UNAVAILABLE"]);

    await bb.pool.query("DELETE FROM float_reservations WHERE payment_id = $1", [holder.id]);
    expect((await post("/v0/payments", { quoteId: pending.id })).statusCode).toBe(201);
  });
});
