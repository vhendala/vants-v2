// T-020: the mini app's backend on a real Postgres: SEP-10 login (DEC-011) and the one-transaction exit (DEC-031). The network
// sits behind fake ports; the transactions, keys and signatures are real.
import type { ApiConfig } from "@vants/config";
import { type Backbone, createBackbone, migrate } from "@vants/db";
import { buildStaticBrCode } from "@vants/pix";
import {
  Account,
  Keypair,
  Networks,
  Operation,
  Asset,
  type Transaction,
  TransactionBuilder,
  WebAuth,
} from "@stellar/stellar-sdk";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startPostgres, type TestPostgres } from "../../../../packages/db/test/postgres.ts";
import { buildApp } from "../app.ts";
import type { AppPorts } from "./routes.ts";
import type { ExitPlan } from "./exit-plan.ts";
import { ExitBlockedError } from "./exit-tx.ts";
import type { Position } from "./portfolio.ts";

const CIRCLE = "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const BLEND = "USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56";
const VAULT = "CBMVK2JK6NTOT2O4HNQAIQFJY232BHKGLIMXDVQVHIIZKDACXDFZDWHN";
const XLM_VAULT = "CD72HOSTSKA2KA4RMVOKVARM7SXBJ7IV54NCPJEEY4ZWOXOQPVFC5SIJ";
const HOME = "vants.example.com";
const server = Keypair.random();
const user = Keypair.random(); // funded, master key only (medium threshold 0)
const multisig = Keypair.random(); // funded, medium threshold 2: master (1) + cosigner (1)
const cosigner = Keypair.random();
const fresh = Keypair.random(); // not on the network yet
const multisigFree = Keypair.random(); // another funded single-key account, for the payments list
const wallet = Keypair.random(); // a host wallet's SIGNING_KEY (client_domain)
const merchant = { key: "pix-spike@vants.example.com", merchantName: "VANTS TESTE", merchantCity: "SAO PAULO" };

let pgc: TestPostgres;
let bb: Backbone;
let app: FastifyInstance;
const submitted: string[] = [];
let holdings: Position[] = [];
const built: { plan: ExitPlan; asset: string }[] = [];
let refuseBuild = false;

const usdc = (amount: string): Position => ({
  id: `classic:${CIRCLE}`,
  kind: "classic",
  asset: CIRCLE,
  amount,
  valueUsd: amount,
  pricing: "par",
  payable: true,
  exit: { steps: 1, slippageBps: 0, estimated: false },
});

const ports: AppPorts = {
  async accountSigners(account) {
    if (account === user.publicKey() || account === multisigFree.publicKey())
      return {
        thresholds: { low: 0, med: 0, high: 0 },
        signers: [{ key: account, weight: 1, type: "ed25519_public_key" }],
      };
    if (account === multisig.publicKey()) {
      return {
        thresholds: { low: 1, med: 2, high: 2 },
        signers: [
          { key: account, weight: 1, type: "ed25519_public_key" },
          { key: cosigner.publicKey(), weight: 1, type: "ed25519_public_key" },
        ],
      };
    }
    return null;
  },
  async clientSigningKey(domain) {
    if (domain === "wallet.example.com") return wallet.publicKey();
    throw new Error("no stellar.toml");
  },
  async portfolio(account) {
    return { account, funded: true, positions: holdings, totalUsd: "0" };
  },
  async vaultStates() {
    return new Map([
      [VAULT, { totalSupply: 100_0000000n, totalAmount: 100_0000000n }],
      [XLM_VAULT, { totalSupply: 100_0000000n, totalAmount: 110_0000000n }],
    ]);
  },
  async buildTx(plan, ctx, maxTime) {
    if (refuseBuild) throw new ExitBlockedError("shortfall", "the AMM leg costs more XLM than the account can spend");
    built.push({ plan, asset: ctx.asset });
    const tx = new TransactionBuilder(new Account(ctx.account, "100"), {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
      timebounds: { minTime: 0, maxTime },
    })
      .addOperation(
        Operation.payment({
          destination: ctx.deposit,
          asset: new Asset("USDC", CIRCLE.split(":")[1] ?? ""),
          amount: "1",
        }),
      )
      .build();
    return {
      xdr: tx.toXDR(),
      hash: Buffer.from(tx.hash()).toString("hex"),
      maxTime,
      summary: [`${plan.route} payment`],
    };
  },
  async submit(signedXdr) {
    submitted.push(signedXdr);
    return { status: "PENDING" };
  },
};

const config: ApiConfig = {
  databaseUrl: "",
  port: 0,
  treasuryAccount: Keypair.random().publicKey(),
  fundingAssets: [CIRCLE, BLEND],
  exitRouterId: "CAAQ3E4AQK7P53T6QSUTPDS3UIBS267CT53BPFHTNQKEZNUGTO5RADPB",
  pricing: { rateBrlPerUsd: "5.4", feeModel: "sandbox", quoteTtlSeconds: 120 },
  stellar: { rpcUrl: "", horizonUrl: "", networkPassphrase: Networks.TESTNET },
  hodle: { webhookSecrets: {} },
  pier: { network: "testnet" },
  integratorKeyPepper: "p".repeat(32),
  webAuth: { homeDomain: HOME, signingSecret: server.secret(), jwtSecret: "ab".repeat(32) },
};

beforeAll(async () => {
  pgc = await startPostgres();
  await migrate(pgc.url);
  bb = createBackbone({ databaseUrl: pgc.url });
  await bb.start();
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
  app = await buildApp({ backbone: bb, config, appPorts: ports });
}, 120_000);

afterAll(async () => {
  vi.useRealTimers();
  await app?.close();
  await bb?.stop();
  await pgc?.stop();
});

const challenge = async (account: string, clientDomain?: string) => {
  const q = new URLSearchParams({ account, ...(clientDomain ? { client_domain: clientDomain } : {}) });
  const res = await app.inject({ method: "GET", url: `/auth?${q}` });
  return { res, xdr: res.json().transaction as string };
};
const sign = (xdr: string, ...keys: Keypair[]) => {
  const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET) as Transaction;
  for (const k of keys) tx.sign(k);
  return tx.toXDR();
};
const token = (transaction: string) => app.inject({ method: "POST", url: "/auth", payload: { transaction } });
const login = async (kp: Keypair) =>
  (await token(sign((await challenge(kp.publicKey())).xdr, kp))).json().token as string;
const authed = (t: string) => ({ authorization: `Bearer ${t}` });

beforeEach(() => {
  holdings = [usdc("50")];
});

describe("discovery (SEP-1)", () => {
  it("publishes stellar.toml with the auth endpoint and signing key, readable cross-origin", async () => {
    const res = await app.inject({ method: "GET", url: "/.well-known/stellar.toml" });
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["content-type"]).toMatch(/text\/plain/);
    expect(res.body).toContain(`WEB_AUTH_ENDPOINT="https://${HOME}/auth"`);
    expect(res.body).toContain(`SIGNING_KEY="${server.publicKey()}"`);
    expect(res.body).toContain('NETWORK_PASSPHRASE="Test SDF Network ; September 2015"');
  });
});

describe("SEP-10 login", () => {
  it("issues a challenge the SDK accepts, and a 7-day session token for the account once it signs (T-023)", async () => {
    const { res, xdr } = await challenge(user.publicKey());
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.json().network_passphrase).toBe(Networks.TESTNET);
    expect(WebAuth.readChallengeTx(xdr, server.publicKey(), Networks.TESTNET, HOME, HOME).clientAccountID).toBe(
      user.publicKey(),
    );
    const r = await token(sign(xdr, user));
    expect(r.statusCode).toBe(200);
    const claims = JSON.parse(Buffer.from((r.json().token as string).split(".")[1] ?? "", "base64url").toString());
    expect(claims).toMatchObject({ iss: `https://${HOME}/auth`, sub: user.publicKey() });
    expect(claims.exp - claims.iat).toBe(7 * 24 * 3600);
  });

  it("accepts an account not yet on the network only with its master key's single signature", async () => {
    const { xdr } = await challenge(fresh.publicKey());
    expect((await token(sign(xdr, fresh))).statusCode).toBe(200);
    const other = await challenge(fresh.publicKey());
    expect((await token(sign(other.xdr, Keypair.random()))).statusCode).toBe(401);
  });

  it("needs the medium threshold of a multisig account", async () => {
    const one = await challenge(multisig.publicKey());
    expect((await token(sign(one.xdr, multisig))).statusCode).toBe(401);
    const both = await challenge(multisig.publicKey());
    expect((await token(sign(both.xdr, multisig, cosigner))).statusCode).toBe(200);
  });

  it("gives one token per challenge: a replay is refused", async () => {
    const signed = sign((await challenge(user.publicKey())).xdr, user);
    expect((await token(signed)).statusCode).toBe(200);
    const again = await token(signed);
    expect(again.statusCode).toBe(401);
    expect(again.json().error).toMatch(/already used/);
  });

  it("refuses an expired challenge", async () => {
    const signed = sign((await challenge(user.publicKey())).xdr, user);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 16 * 60_000);
    try {
      expect((await token(signed)).statusCode).toBe(401);
    } finally {
      vi.useRealTimers();
    }
  });

  it("records the host wallet with client_domain, and requires that wallet's signature too", async () => {
    const { xdr } = await challenge(user.publicKey(), "wallet.example.com");
    expect((await token(sign(xdr, user))).statusCode).toBe(401);
    const r = await token(sign(xdr, user, wallet));
    expect(r.statusCode).toBe(200);
    const claims = JSON.parse(Buffer.from((r.json().token as string).split(".")[1] ?? "", "base64url").toString());
    expect(claims.client_domain).toBe("wallet.example.com");
    expect((await challenge(user.publicKey(), "unknown.example.com")).res.statusCode).toBe(400);
  });

  it("only serves G… accounts (muxed and contract accounts are out of the PoC)", async () => {
    const m = "MAAAAAAAAAAAAAB7BQ2L7E5NBWMXDUCMZSIPOBKRDSBYVLMXGSSKF6YNPIB7Y77ITLVL6";
    expect((await challenge(m)).res.statusCode).toBe(400);
    expect((await challenge("not-an-account")).res.statusCode).toBe(400);
  });
});

describe("/app (JWT)", () => {
  const brCode = buildStaticBrCode({ ...merchant, amountCents: 540 });

  it("refuses requests without a valid token", async () => {
    expect((await app.inject({ method: "GET", url: "/app/portfolio" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/app/portfolio", headers: authed("x.y.z") })).statusCode).toBe(401);
  });

  it("refuses them on a percent-encoded path too (T-049)", async () => {
    for (const url of ["/%61pp/portfolio", "/app/%70ortfolio", "/%61%70%70/limits"]) {
      expect((await app.inject({ method: "GET", url })).statusCode, url).toBe(401);
    }
  });

  it("shows the account's portfolio and prices a BR Code before anything is picked", async () => {
    const t = await login(user);
    const p = await app.inject({ method: "GET", url: "/app/portfolio", headers: authed(t) });
    expect(p.json()).toMatchObject({
      account: user.publicKey(),
      positions: [{ id: `classic:${CIRCLE}` }],
      rate: "5.4",
    });
    const q = await app.inject({
      method: "POST",
      url: "/app/exits/quote",
      headers: authed(t),
      payload: { destination: { type: "br_code", brCode } },
    });
    expect(q.statusCode).toBe(200);
    expect(q.json()).toMatchObject({
      amountBrl: "5.40",
      rate: "5.4",
      payee: { name: "VANTS TESTE" },
      assets: [
        { asset: CIRCLE, assetAmount: "1" },
        { asset: BLEND, assetAmount: "1" },
      ],
    });
  });

  it("says right after scanning when the float can't cover the code (price first, before any pick)", async () => {
    const t = await login(user);
    const huge = buildStaticBrCode({ ...merchant, amountCents: 1_000_000_000 }); // R$ 10 million: more than the test float
    const q = await app.inject({
      method: "POST",
      url: "/app/exits/quote",
      headers: authed(t),
      payload: { destination: { type: "br_code", brCode: huge } },
    });
    expect([q.statusCode, q.json().error.code]).toEqual([409, "FLOAT_UNAVAILABLE"]);
  });

  it("plans one transaction, accepts only that transaction signed, and submits it once", async () => {
    const t = await login(user);
    const created = await app.inject({
      method: "POST",
      url: "/app/exits",
      headers: authed(t),
      payload: { destination: { type: "br_code", brCode }, picks: [`classic:${CIRCLE}`] },
    });
    expect(created.statusCode).toBe(201);
    const exit = created.json();
    expect(exit).toMatchObject({ route: "classic", transaction: { summary: ["classic payment"] } });
    const payment = await bb.pool.query("SELECT state->>'refundTo' AS refund_to FROM payments WHERE id = $1", [
      exit.paymentId,
    ]);
    expect(payment.rows[0]?.refund_to).toBe(user.publicKey()); // a bad deposit goes back to the user

    const submit = (signedXdr: string) =>
      app.inject({ method: "POST", url: `/app/exits/${exit.id}/submit`, headers: authed(t), payload: { signedXdr } });
    expect((await submit(exit.transaction.xdr)).statusCode).toBe(400); // unsigned
    const otherTx = new TransactionBuilder(new Account(user.publicKey(), "100"), {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.bumpSequence({ bumpTo: "1" }))
      .setTimeout(60)
      .build();
    otherTx.sign(user);
    expect((await submit(otherTx.toXDR())).json().error.code).toBe("PLAN_MISMATCH");

    const ok = await submit(sign(exit.transaction.xdr, user));
    expect(ok.statusCode).toBe(202);
    expect((await submit(sign(exit.transaction.xdr, user))).statusCode).toBe(200); // already submitted: nothing sent again
    expect(submitted).toHaveLength(1);

    const view = await app.inject({ method: "GET", url: `/app/exits/${exit.id}`, headers: authed(t) });
    expect(view.json()).toMatchObject({
      id: exit.id,
      status: "submitted",
      payment: { id: exit.paymentId, status: "awaiting_deposit" },
    });
    const stranger = await login(fresh);
    expect(
      (await app.inject({ method: "GET", url: `/app/exits/${exit.id}`, headers: authed(stranger) })).statusCode,
    ).toBe(404);
  });

  it("pays XLM picked first with a vault in the vault's asset, as one router call with an AMM leg (DEC-034)", async () => {
    holdings = [
      { ...usdc("0"), id: "classic:native", asset: "native", amount: "4", valueUsd: "0.4", pricing: "estimated" },
      { ...usdc("2"), id: `defindex:${VAULT}`, kind: "defindex", asset: BLEND, vault: VAULT, shares: "2" },
    ];
    const t = await login(user);
    const res = await app.inject({
      method: "POST",
      url: "/app/exits",
      headers: authed(t),
      payload: { destination: { type: "br_code", brCode }, picks: ["classic:native", `defindex:${VAULT}`] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ route: "router", asset: BLEND });
    expect(built.at(-1)?.plan).toMatchObject({
      route: "router",
      swap: { from: "native", receive7: 4_000000n, spendable7: 4_0000000n },
      withdraw: { vault: VAULT, minOut7: 6_000000n },
    });
  });

  it("pays from lumens invested: one router call, in a dollar the account already holds (T-026)", async () => {
    holdings = [
      { ...usdc("0.5"), id: `classic:${BLEND}`, asset: BLEND },
      {
        ...usdc("0"),
        id: `defindex:${XLM_VAULT}`,
        kind: "defindex",
        asset: "native",
        vault: XLM_VAULT,
        shares: "100",
        amount: "110",
        valueUsd: "11.00",
        pricing: "estimated",
      },
    ];
    const t = await login(user);
    const res = await app.inject({
      method: "POST",
      url: "/app/exits",
      headers: authed(t),
      payload: { destination: { type: "br_code", brCode }, picks: [`defindex:${XLM_VAULT}`] },
    });
    expect(res.statusCode).toBe(201);
    // Circle comes first among the funding assets, but this account only holds Blend's dollar: the swap pays into that one.
    expect(res.json()).toMatchObject({ route: "router", asset: BLEND });
    expect(built.at(-1)?.plan).toMatchObject({
      route: "router",
      withdraw: { vault: XLM_VAULT, lumensFor7: 1_0000000n, heldShares7: 100_0000000n },
      swap: { from: "native", receive7: 1_0000000n, spendable7: 110_0000000n },
    });
  });

  it("pays XLM picked first in the first funding asset when it covers the amount alone (the vault is left alone)", async () => {
    holdings = [
      { ...usdc("0"), id: "classic:native", asset: "native", amount: "500", valueUsd: "50", pricing: "estimated" },
      { ...usdc("2"), id: `defindex:${VAULT}`, kind: "defindex", asset: BLEND, vault: VAULT, shares: "2" },
    ];
    const t = await login(user);
    const res = await app.inject({
      method: "POST",
      url: "/app/exits",
      headers: authed(t),
      payload: { destination: { type: "br_code", brCode }, picks: ["classic:native", `defindex:${VAULT}`] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ route: "classic", asset: CIRCLE });
  });

  it("says why when the plan can't be built at today's prices (the AMM leg costs too much XLM)", async () => {
    refuseBuild = true;
    try {
      const t = await login(user);
      const res = await app.inject({
        method: "POST",
        url: "/app/exits",
        headers: authed(t),
        payload: { destination: { type: "br_code", brCode }, picks: [`classic:${CIRCLE}`] },
      });
      expect([res.statusCode, res.json().reason]).toEqual([422, "shortfall"]);
    } finally {
      refuseBuild = false;
    }
  });

  it("takes the amount chosen for each position (T-023)", async () => {
    holdings = [usdc("50")];
    const t = await login(user);
    const res = await app.inject({
      method: "POST",
      url: "/app/exits",
      headers: authed(t),
      payload: { destination: { type: "br_code", brCode }, picks: [{ id: `classic:${CIRCLE}`, amount: "1" }] },
    });
    expect(res.statusCode).toBe(201);
    expect(built.at(-1)?.plan).toMatchObject({ route: "classic", fromBalance7: 1_0000000n });
    const over = await app.inject({
      method: "POST",
      url: "/app/exits",
      headers: authed(t),
      payload: { destination: { type: "br_code", brCode }, picks: [{ id: `classic:${CIRCLE}`, amount: "60" }] },
    });
    expect([over.statusCode, over.json().reason]).toEqual([422, "over_position"]);
    const bad = await app.inject({
      method: "POST",
      url: "/app/exits",
      headers: authed(t),
      payload: { destination: { type: "br_code", brCode }, picks: [{ id: `classic:${CIRCLE}`, amount: "1.12345678" }] },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("lists the account's signed payments, newest first, and nobody else's (T-023)", async () => {
    const t = await login(multisigFree);
    const make = async () => {
      const r = await app.inject({
        method: "POST",
        url: "/app/exits",
        headers: authed(t),
        payload: { destination: { type: "br_code", brCode }, picks: [`classic:${CIRCLE}`] },
      });
      return r.json() as { id: string; transaction: { xdr: string } };
    };
    const first = await make();
    const second = await make();
    await make(); // built, never signed: not in the list
    for (const e of [first, second]) {
      await app.inject({
        method: "POST",
        url: `/app/exits/${e.id}/submit`,
        headers: authed(t),
        payload: { signedXdr: sign(e.transaction.xdr, multisigFree) },
      });
    }
    const list = await app.inject({ method: "GET", url: "/app/exits", headers: authed(t) });
    expect(list.statusCode).toBe(200);
    const items = list.json().items as { id: string; payment: { id: string; quote: { amountBrl: string } } }[];
    expect(items.map((i) => i.id)).toEqual([second.id, first.id]);
    expect(items[0]).toMatchObject({ picks: [`classic:${CIRCLE}`] });
    // Nothing paid yet this month: the summary counts completed payments only.
    expect(list.json().month).toEqual({ paidBrl: "0.00", count: 0 });
    await bb.pool.query("UPDATE payments SET status = 'completed' WHERE id = $1", [items[0]?.payment.id ?? ""]);
    const paid = await app.inject({ method: "GET", url: "/app/exits", headers: authed(t) });
    expect(paid.json().month).toEqual({ paidBrl: "5.40", count: 1 });
    expect(items[0]?.payment.quote.amountBrl).toBe("5.40");
    const page = await app.inject({ method: "GET", url: "/app/exits?limit=1", headers: authed(t) });
    expect(page.json()).toMatchObject({ items: [{ id: second.id }], next: expect.any(String) });
    const rest = await app.inject({
      method: "GET",
      url: `/app/exits?limit=1&before=${encodeURIComponent(page.json().next)}`,
      headers: authed(t),
    });
    expect(rest.json().items.map((i: { id: string }) => i.id)).toEqual([first.id]);
    const stranger = await login(fresh);
    expect((await app.inject({ method: "GET", url: "/app/exits", headers: authed(stranger) })).json().items).toEqual(
      [],
    );
  });

  it("prices a payment to a Pix key in its canonical form, and refuses a key that isn't one (T-025)", async () => {
    const t = await login(user);
    const ok = await app.inject({
      method: "POST",
      url: "/app/exits/quote",
      headers: authed(t),
      payload: { destination: { type: "pix_key", key: "111.572.277-83", keyType: "CPF", amountBrl: "150.00" } },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ amountBrl: "150.00", pixKey: "11157227783", pixKeyType: "CPF" });
    const bad = await app.inject({
      method: "POST",
      url: "/app/exits/quote",
      headers: authed(t),
      payload: { destination: { type: "pix_key", key: "111.572.277-84", keyType: "CPF", amountBrl: "150.00" } },
    });
    expect([bad.statusCode, bad.json().error.code]).toEqual([400, "INVALID_PIX_KEY"]);
  });

  it("says how much one Pix can be right now: what the float covers (T-025)", async () => {
    const t = await login(user);
    const res = await app.inject({ method: "GET", url: "/app/limits", headers: authed(t) });
    // The test float holds 1,000,000 USDH at 5.4 BRL per USD.
    expect(res.json()).toEqual({ maxBrl: "5400000.00" });
  });

  it("refuses a plan it can't build in one transaction, creating no payment", async () => {
    const t = await login(user);
    const before = Number((await bb.pool.query("SELECT count(*) AS n FROM payments")).rows[0]?.n);
    const big = buildStaticBrCode({ ...merchant, amountCents: 540_00 }); // R$ 540 = 100 USDC > 50 held
    const res = await app.inject({
      method: "POST",
      url: "/app/exits",
      headers: authed(t),
      payload: { destination: { type: "br_code", brCode: big }, picks: [`classic:${CIRCLE}`] },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: { code: "EXIT_BLOCKED" }, reason: "shortfall" });
    expect(Number((await bb.pool.query("SELECT count(*) AS n FROM payments")).rows[0]?.n)).toBe(before);
  });

  it("never accepts a secret: unknown fields are refused (INV-09)", async () => {
    const t = await login(user);
    const res = await app.inject({
      method: "POST",
      url: "/app/exits",
      headers: authed(t),
      payload: {
        destination: { type: "br_code", brCode },
        picks: [`classic:${CIRCLE}`],
        secret: Keypair.random().secret(),
      },
    });
    expect(res.statusCode).toBe(400);
  });
});
