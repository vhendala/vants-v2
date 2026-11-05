// T-026: investing (DeFindex vaults) and adding money by Pix (Etherfuse) on a real Postgres. The network and Etherfuse sit
// behind fake ports; the transactions, keys and signatures are real.
import type { Order, Profile, Quote } from "@vants/adapter-etherfuse";
import type { ApiConfig } from "@vants/config";
import { type Backbone, createBackbone, insertAction, insertRampOrder, migrate, setActionStatus } from "@vants/db";
import { Account, Keypair, Networks, Operation, type Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startPostgres, type TestPostgres } from "../../../../packages/db/test/postgres.ts";
import { buildApp } from "../app.ts";
import type { MoneyPorts } from "./money.ts";
import type { Position } from "./portfolio.ts";
import type { AppPorts } from "./routes.ts";

const BLEND = "USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56";
const CIRCLE = "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const USDC_VAULT = "CBMVK2JK6NTOT2O4HNQAIQFJY232BHKGLIMXDVQVHIIZKDACXDFZDWHN";
const XLM_VAULT = "CD72HOSTSKA2KA4RMVOKVARM7SXBJ7IV54NCPJEEY4ZWOXOQPVFC5SIJ";
const HOME = "vants.example.com";
const server = Keypair.random();
const user = Keypair.random();
const other = Keypair.random();

let pgc: TestPostgres;
let bb: Backbone;
let app: FastifyInstance;
let holdings: Position[] = [];
let shares = new Map<string, bigint>();
const trustlines = new Set<string>();
const submitted: string[] = [];
const vaultBuilds: Parameters<MoneyPorts["buildVaultTx"]>[0][] = [];
const trades: Parameters<NonNullable<MoneyPorts["buildTradeTx"]>>[0][] = [];
const onboarded: Profile[] = [];
const etherfuse = { orders: new Map<string, Order>(), paid: [] as string[], expireQuotes: false };
let txStatus: "pending" | "success" | "failed" = "pending";

const classic = (asset: string, amount: string): Position => ({
  id: `classic:${asset}`,
  kind: "classic",
  asset,
  amount,
  valueUsd: amount,
  pricing: "par",
  payable: true,
  exit: { steps: 1, slippageBps: 0, estimated: false },
});

/** A real, unsigned envelope standing in for what the live ports build. */
const envelope = (account: string, summary: string[]) => {
  const maxTime = Math.floor(Date.now() / 1000) + 300;
  const tx = new TransactionBuilder(new Account(account, "100"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
    timebounds: { minTime: 0, maxTime },
  })
    .addOperation(Operation.bumpSequence({ bumpTo: String(Date.now()) }))
    .build();
  return { xdr: tx.toXDR(), hash: Buffer.from(tx.hash()).toString("hex"), maxTime, summary };
};

const money: MoneyPorts = {
  portfolio: async (account) => ({ account, funded: true, positions: holdings, totalUsd: "0" }),
  vaultState: async () => ({ totalSupply: 100_0000000n, totalAmount: 110_0000000n }), // a share is worth 1.1
  shares: async (vault) => shares.get(vault) ?? 0n,
  vaultApy: async (vault) => (vault === USDC_VAULT ? 11.49 : null),
  async buildVaultTx(input) {
    vaultBuilds.push(input);
    return envelope(input.account, [`${input.kind} ${input.amount7} ${input.unit}`]);
  },
  buildTrustlineTx: async (input) => envelope(input.account, [`trust ${input.label}`]),
  async buildTradeTx(input) {
    trades.push(input);
    return envelope(input.account, [`${input.side} ${input.value7} via ${input.other}`]);
  },
  hasTrustline: async (account, asset) => trustlines.has(`${account}|${asset}`),
  async submit(signedXdr) {
    submitted.push(signedXdr);
    return { status: "PENDING" };
  },
  txStatus: async () => txStatus,
  ramp: {
    async onboard(_publicKey, p) {
      onboarded.push(p);
      return { customerId: "cus-1", bankAccountId: "bank-1" };
    },
    async quote(_customer, _asset, amountBrl): Promise<Quote> {
      return {
        quoteId: crypto.randomUUID(),
        sourceAmount: amountBrl,
        destinationAmount: String(Number(amountBrl) * 0.1975),
        exchangeRate: "0.1975",
        feeBps: "20",
        feeAmount: (Number(amountBrl) * 0.002).toFixed(2),
        expiresAt: new Date(Date.now() + (etherfuse.expireQuotes ? -1_000 : 120_000)).toISOString(),
      };
    },
    async order(input) {
      const o: Order = { orderId: crypto.randomUUID(), status: "created", depositPixCode: "00020126...6304ABCD" };
      etherfuse.orders.set(o.orderId, o);
      expect(input.bankAccountId).toBe("bank-1");
      return o;
    },
    getOrder: async (id) => etherfuse.orders.get(id) ?? { orderId: id, status: "created" },
    async simulatePaid(id) {
      etherfuse.paid.push(id);
      const o = etherfuse.orders.get(id);
      if (o) o.status = "funded";
    },
  },
};

const ports: AppPorts = {
  accountSigners: async (account) => ({
    thresholds: { low: 0, med: 0, high: 0 },
    signers: [{ key: account, weight: 1, type: "ed25519_public_key" }],
  }),
  clientSigningKey: async () => {
    throw new Error("no stellar.toml");
  },
  portfolio: money.portfolio,
  vaultStates: async () => new Map(),
  buildTx: async () => {
    throw new Error("not in these tests");
  },
  submit: money.submit,
  money,
};

const config: ApiConfig = {
  databaseUrl: "",
  port: 0,
  treasuryAccount: Keypair.random().publicKey(),
  fundingAssets: [CIRCLE, BLEND],
  pricing: { rateBrlPerUsd: "5.4", feeModel: "sandbox", quoteTtlSeconds: 120 },
  stellar: { rpcUrl: "", horizonUrl: "", networkPassphrase: Networks.TESTNET },
  hodle: { webhookSecrets: {} },
  pier: { network: "testnet" },
  integratorKeyPepper: "p".repeat(32),
  webAuth: { homeDomain: HOME, signingSecret: server.secret(), jwtSecret: "cd".repeat(32) },
};

beforeAll(async () => {
  pgc = await startPostgres();
  await migrate(pgc.url);
  bb = createBackbone({ databaseUrl: pgc.url });
  await bb.start();
  app = await buildApp({ backbone: bb, config, appPorts: ports });
}, 120_000);

afterAll(async () => {
  await app?.close();
  await bb?.stop();
  await pgc?.stop();
});

beforeEach(() => {
  holdings = [classic(BLEND, "40"), classic("native", "25")];
  shares = new Map();
  txStatus = "pending";
  etherfuse.expireQuotes = false;
});

const sign = (xdr: string, ...keys: Keypair[]) => {
  const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET) as Transaction;
  for (const k of keys) tx.sign(k);
  return tx.toXDR();
};
const login = async (kp: Keypair) => {
  const c = await app.inject({ method: "GET", url: `/auth?account=${kp.publicKey()}` });
  const r = await app.inject({
    method: "POST",
    url: "/auth",
    payload: { transaction: sign(c.json().transaction, kp) },
  });
  return { authorization: `Bearer ${r.json().token as string}` };
};

describe("investing (DeFindex)", () => {
  it("shows each vault's yield, what the account has in it, and what it could put in", async () => {
    shares.set(USDC_VAULT, 10_0000000n);
    const res = await app.inject({ method: "GET", url: "/app/invest", headers: await login(user) });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().vaults).toEqual([
      expect.objectContaining({
        id: USDC_VAULT,
        name: "Dólar que rende",
        unit: "USDC",
        apyPercent: 11.49,
        invested: "11",
        canInvest: "40",
      }),
      expect.objectContaining({
        id: XLM_VAULT,
        name: "Lumens que rendem",
        unit: "XLM",
        apyPercent: null,
        canInvest: "25",
      }),
    ]);
  });

  it("builds one deposit to sign, accepts only that transaction signed, and follows it to done", async () => {
    const h = await login(user);
    const res = await app.inject({
      method: "POST",
      url: "/app/invest",
      headers: h,
      payload: { vault: USDC_VAULT, amount: "12.5" },
    });
    expect(res.statusCode).toBe(201);
    const action = res.json();
    expect(action).toMatchObject({ kind: "invest", transaction: { summary: ["invest 125000000 USDC"] } });
    expect(vaultBuilds.at(-1)).toMatchObject({ kind: "invest", vault: USDC_VAULT, amount7: 125_000_000n });

    const submit = (signedXdr: string) =>
      app.inject({ method: "POST", url: `/app/actions/${action.id}/submit`, headers: h, payload: { signedXdr } });
    expect((await submit(action.transaction.xdr)).statusCode).toBe(400); // unsigned
    const stranger = envelope(user.publicKey(), []);
    expect((await submit(sign(stranger.xdr, user))).json().error.code).toBe("PLAN_MISMATCH");
    const before = submitted.length;
    expect((await submit(sign(action.transaction.xdr, user))).statusCode).toBe(202);
    expect((await submit(sign(action.transaction.xdr, user))).statusCode).toBe(200); // nothing sent twice
    expect(submitted).toHaveLength(before + 1);

    const view = () => app.inject({ method: "GET", url: `/app/actions/${action.id}`, headers: h });
    expect((await view()).json().status).toBe("submitted");
    txStatus = "success";
    expect((await view()).json().status).toBe("done");
    const theirs = await app.inject({ method: "GET", url: `/app/actions/${action.id}`, headers: await login(other) });
    expect(theirs.statusCode).toBe(404);
  });

  it("refuses to invest more than the account holds, or in a vault Vants doesn't offer", async () => {
    const h = await login(user);
    const over = await app.inject({
      method: "POST",
      url: "/app/invest",
      headers: h,
      payload: { vault: XLM_VAULT, amount: "25.0000001" },
    });
    expect(over.json().error.code).toBe("OVER_BALANCE");
    const unknown = await app.inject({
      method: "POST",
      url: "/app/invest",
      headers: h,
      payload: { vault: "CAAQ3E4AQK7P53T6QSUTPDS3UIBS267CT53BPFHTNQKEZNUGTO5RADPB", amount: "1" },
    });
    expect(unknown.statusCode).toBe(404);
  });

  it("takes money out by burning the shares that cover it, never more than the account has", async () => {
    shares.set(USDC_VAULT, 10_0000000n); // worth 11
    const h = await login(user);
    const ok = await app.inject({
      method: "POST",
      url: "/app/redeem",
      headers: h,
      payload: { vault: USDC_VAULT, amount: "11" },
    });
    expect(ok.statusCode).toBe(201);
    expect(vaultBuilds.at(-1)).toMatchObject({ kind: "redeem", amount7: 110_000_000n, shares7: 100_000_000n });
    const over = await app.inject({
      method: "POST",
      url: "/app/redeem",
      headers: h,
      payload: { vault: USDC_VAULT, amount: "11.01" },
    });
    expect(over.json().error).toMatchObject({ code: "OVER_BALANCE" });
  });
});

describe("adding money by Pix (Etherfuse sandbox)", () => {
  const profile = {
    givenName: "Ana",
    familyName: "Souza",
    cpf: "529.982.247-25",
    birthDate: "1990-04-12",
    email: "Ana@Example.com",
    phone: "(11) 98765-4321",
    occupation: "Designer",
    address: { street: "Av. Paulista, 1000", city: "São Paulo", region: "SP", postalCode: "01310-100" },
  };

  it("asks who the person is once, then quotes, needs the wallet to accept the asset, and places the order", async () => {
    const h = await login(user);
    expect((await app.inject({ method: "GET", url: "/app/ramp", headers: h })).json()).toMatchObject({
      available: true,
      profile: null,
      targets: ["USDC", "TESOURO"],
    });
    const early = await app.inject({
      method: "POST",
      url: "/app/ramp/quote",
      headers: h,
      payload: { target: "USDC", amountBrl: "100" },
    });
    expect(early.json().error.code).toBe("PROFILE_REQUIRED");

    const badCpf = await app.inject({
      method: "POST",
      url: "/app/ramp/profile",
      headers: h,
      payload: { ...profile, cpf: "111.111.111-11" },
    });
    expect(badCpf.json().error.code).toBe("INVALID_CPF");
    const saved = await app.inject({ method: "POST", url: "/app/ramp/profile", headers: h, payload: profile });
    expect(saved.json()).toEqual({ displayName: "Ana Souza", email: "ana@example.com" });
    expect(onboarded.at(-1)).toMatchObject({ cpf: "52998224725", phone: "+5511987654321" });

    const quote = await app.inject({
      method: "POST",
      url: "/app/ramp/quote",
      headers: h,
      payload: { target: "USDC", amountBrl: "100" },
    });
    expect(quote.json()).toMatchObject({
      target: "USDC",
      amountBrl: "100",
      receive: "19.7500000",
      needsTrustline: true,
    });
    const { quoteId } = quote.json();

    const blocked = await app.inject({ method: "POST", url: "/app/ramp/orders", headers: h, payload: { quoteId } });
    expect(blocked.json().error.code).toBe("TRUSTLINE_REQUIRED");
    const trust = await app.inject({
      method: "POST",
      url: "/app/ramp/trustline",
      headers: h,
      payload: { target: "USDC" },
    });
    expect(trust.json()).toMatchObject({ kind: "trustline", transaction: { summary: ["trust dólar digital"] } });
    trustlines.add(`${user.publicKey()}|${CIRCLE}`);
    const again = await app.inject({
      method: "POST",
      url: "/app/ramp/trustline",
      headers: h,
      payload: { target: "USDC" },
    });
    expect(again.json()).toEqual({ needed: false });

    const theirs = await app.inject({
      method: "POST",
      url: "/app/ramp/orders",
      headers: await login(other),
      payload: { quoteId },
    });
    expect(theirs.statusCode).toBe(404); // a quote is the account's own
    const placed = await app.inject({ method: "POST", url: "/app/ramp/orders", headers: h, payload: { quoteId } });
    expect(placed.statusCode).toBe(201);
    const order = placed.json();
    expect(order).toMatchObject({
      target: "USDC",
      status: "created",
      receive: "19.7500000",
      pixCode: "00020126...6304ABCD",
    });
    const reuse = await app.inject({ method: "POST", url: "/app/ramp/orders", headers: h, payload: { quoteId } });
    expect(reuse.json().error.code).toBe("QUOTE_NOT_FOUND"); // one order per quote

    const paid = await app.inject({ method: "POST", url: `/app/ramp/orders/${order.id}/simulate-payment`, headers: h });
    expect(paid.statusCode).toBe(202);
    expect(etherfuse.paid).toContain(order.id);
    const status = await app.inject({ method: "GET", url: `/app/ramp/orders/${order.id}`, headers: h });
    expect(status.json().status).toBe("funded");
    const listed = (await app.inject({ method: "GET", url: "/app/ramp", headers: h })).json();
    expect(listed.profile).toEqual({ displayName: "Ana Souza", email: "ana@example.com" });
    expect(listed.orders.map((o: { id: string }) => o.id)).toEqual([order.id]);
  });

  it("refuses an order on a price that expired", async () => {
    const h = await login(user);
    etherfuse.expireQuotes = true;
    const quote = await app.inject({
      method: "POST",
      url: "/app/ramp/quote",
      headers: h,
      payload: { target: "USDC", amountBrl: "50" },
    });
    const late = await app.inject({
      method: "POST",
      url: "/app/ramp/orders",
      headers: h,
      payload: { quoteId: quote.json().quoteId },
    });
    expect(late.json().error.code).toBe("QUOTE_EXPIRED");
  });
});

describe("Tesouro on the order book (T-029)", () => {
  const TESOURO = "TESOURO:GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4";
  const trade = async (h: { authorization: string }, payload: object) =>
    app.inject({ method: "POST", url: "/app/tesouro", headers: h, payload });

  it("shows what is held and what could buy it; buying asks the wallet to accept Tesouro first", async () => {
    const buyer = Keypair.random();
    const h = await login(buyer);
    const view = await app.inject({ method: "GET", url: "/app/invest", headers: h });
    expect(view.json().tesouro).toEqual({ asset: TESOURO, held: "0", valueUsd: "0", trusted: false, canBuyUsd: "25" });
    const first = await trade(h, { side: "buy", amountBrl: "54" });
    expect(first.statusCode).toBe(409);
    expect(first.json().error.code).toBe("TRUSTLINE_REQUIRED");
  });

  it("buys with the dollar when it covers the amount, else with lumens, and refuses more than either", async () => {
    const buyer = Keypair.random();
    trustlines.add(`${buyer.publicKey()}|${TESOURO}`);
    const h = await login(buyer);
    const byLumens = await trade(h, { side: "buy", amountBrl: "54" }); // US$ 10 at 5.4: lumens (25) pay it
    expect(byLumens.statusCode, byLumens.body).toBe(201);
    expect(byLumens.json()).toMatchObject({ kind: "trade" });
    expect(trades.at(-1)).toMatchObject({
      side: "buy",
      asset: TESOURO,
      other: "native",
      dollar: CIRCLE,
      value7: 10_0000000n,
    });

    holdings = [classic(CIRCLE, "30"), classic("native", "25")];
    await trade(h, { side: "buy", amountBrl: "54" });
    expect(trades.at(-1)).toMatchObject({ other: CIRCLE });
    const over = await trade(h, { side: "buy", amountBrl: "540" }); // US$ 100
    expect(over.json().error.code).toBe("OVER_BALANCE");
  });

  it("sells for the dollar where the wallet accepts it, else for lumens; all of it when asked", async () => {
    const seller = Keypair.random();
    const h = await login(seller);
    holdings = [{ ...classic(TESOURO, "256.98"), valueUsd: "59.31", pricing: "estimated" }];
    expect((await trade(h, { side: "sell", amount_brl: "1" })).statusCode).toBe(400);
    expect((await trade(h, { side: "sell", amountBrl: "400" })).json().error.code).toBe("OVER_BALANCE");
    expect((await trade(h, { side: "sell", all: true })).statusCode).toBe(201);
    expect(trades.at(-1)).toMatchObject({ side: "sell", other: "native", all: true, held7: 256_9800000n });
    trustlines.add(`${seller.publicKey()}|${CIRCLE}`);
    await trade(h, { side: "sell", amountBrl: "108" });
    expect(trades.at(-1)).toMatchObject({ other: CIRCLE, value7: 20_0000000n });
    expect(trades.at(-1)?.all).toBeUndefined();
  });
});

describe("Atividade (T-033)", () => {
  it("lists payments, investing, Tesouro trades, accepting an asset and Pix deposits on one page, newest first", async () => {
    const me = Keypair.random();
    const h = await login(me);
    const hash = () => Buffer.from(Keypair.random().rawPublicKey()).toString("hex");
    const act = async (id: string, kind: "invest" | "redeem" | "trade" | "trustline", detail: Record<string, string>) =>
      bb.withTransaction((tx) =>
        insertAction(tx, {
          id,
          account: me.publicKey(),
          kind,
          detail,
          txHash: hash(),
          txXdr: "AAAA",
          maxTime: 0,
          summary: [`${kind} line`],
        }),
      );
    const status = (id: string, s: "submitted" | "done") => bb.withTransaction((tx) => setActionStatus(tx, id, s));

    await act("act_invest00000000000001", "invest", { vault: USDC_VAULT, amount: "12.5" });
    await status("act_invest00000000000001", "submitted");
    await bb.withTransaction((tx) =>
      insertRampOrder(tx, {
        id: "11111111-1111-4111-8111-111111111111",
        account: me.publicKey(),
        targetAsset: CIRCLE,
        amountBrl: "25.55",
        amountAsset: "4.6900000",
        feeBrl: "0.05",
        status: "funded",
        pixCode: null,
      }),
    );
    await act("act_unsigned000000000001", "trade", { side: "buy", amountBrl: "10.00" }); // never signed: not activity
    await act("act_redeem00000000000001", "redeem", { vault: XLM_VAULT, amount: "30" });
    await status("act_redeem00000000000001", "done");
    await act("act_trust000000000000001", "trustline", { asset: "TESOURO:GABC" });
    await status("act_trust000000000000001", "submitted");

    txStatus = "success";
    const first = await app.inject({ method: "GET", url: "/app/activity?limit=2", headers: h });
    expect(first.statusCode, first.body).toBe(200);
    const p1 = first.json();
    expect(p1.items.map((i: { id: string }) => i.id)).toEqual(["act_trust000000000000001", "act_redeem00000000000001"]);
    expect(p1.items[0]).toMatchObject({ type: "action", action: { kind: "trustline", status: "done" } }); // settled
    expect(p1.items[1].action).toMatchObject({
      kind: "redeem",
      detail: { amount: "30" },
      vault: { id: XLM_VAULT, asset: "native", name: "Lumens que rendem" },
    });
    expect(p1.next).toMatch(/\|act_redeem00000000000001$/);
    expect(p1.month).toEqual({ paidBrl: "0.00", count: 0 });

    const second = await app.inject({
      method: "GET",
      url: `/app/activity?limit=2&before=${encodeURIComponent(p1.next)}`,
      headers: h,
    });
    const p2 = second.json();
    expect(p2.items.map((i: { type: string }) => i.type)).toEqual(["deposit", "action"]);
    expect(p2.items[0].order).toMatchObject({
      target: "USDC",
      amountBrl: "25.55",
      receive: "4.6900000",
      status: "funded",
    });
    expect(p2.items[1].action).toMatchObject({ kind: "invest", status: "done", vault: { name: "Dólar que rende" } });
    expect(p2.next).toBeNull();

    const theirs = await app.inject({ method: "GET", url: "/app/activity", headers: await login(other) });
    expect(
      theirs.json().items.filter((i: { id: string }) => i.id.startsWith("act_") && i.id.includes("0000000000000")),
    ).toEqual([]);
    expect((await app.inject({ method: "GET", url: "/app/activity?before=nope", headers: h })).statusCode).toBe(400);
  });
});
