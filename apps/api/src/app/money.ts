// Investing and adding money (T-026, DEC-038), behind the same SEP-10 session as payments (registered inside appRoutes, after
// its auth hook). Every move of money is still ONE transaction the person's wallet signs; the server builds it, keeps its
// hash, and submits only that transaction, signed (INV-09).
//   GET  /app/invest                 the vaults on offer: yield, what the account has in each, what it could put in
//   POST /app/invest                 { vault, amount } → an action (deposit) to sign
//   POST /app/redeem                 { vault, amount } → an action (withdraw) to sign
//   POST /app/tesouro                { side, amountBrl | all } → an action (an order-book trade) to sign (T-029)
//   POST /app/actions/:id/submit     { signedXdr } → submitted
//   GET  /app/actions/:id            its status, read from the network
//   GET  /app/ramp                   adding money by Pix: available? the person's profile, recent orders
//   POST /app/ramp/profile           the identity Etherfuse needs (once); sandbox auto-approves
//   POST /app/ramp/quote             { target, amountBrl } → what it buys (2 minutes), and whether a trustline is needed
//   POST /app/ramp/trustline         { target } → an action (trustline) to sign
//   POST /app/ramp/orders            { quoteId } → the order and how to pay it
//   POST /app/ramp/orders/:id/simulate-payment   sandbox: mark the Pix as paid
//   GET  /app/ramp/orders/:id        the order, refreshed from Etherfuse
import { INVEST_VAULTS, sharesForUnderlying, type VaultState } from "@vants/adapter-defindex";
import { type EtherfuseClient, RAMP_TARGETS } from "@vants/adapter-etherfuse";
import {
  type ActionRecord,
  type Backbone,
  getAction,
  getRampCustomer,
  getRampOrder,
  insertAction,
  insertRampOrder,
  listRampOrders,
  type RampOrder,
  saveRampCustomer,
  setActionStatus,
  updateRampOrder,
} from "@vants/db";
import { formatAmount7, rateToMicros } from "@vants/domain";
import { normalizePixKey } from "@vants/pix";
import { Networks, type Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError, errorBody } from "../payments-service.ts";
import type { ExitTransaction } from "./exit-tx.ts";
import { NoMarketError, type TradeTxInput } from "./money-tx.ts";
import type { Portfolio } from "./portfolio.ts";
import { parseAmount7 } from "./sources.ts";

/** The network and partners behind investing and adding money (fakes in tests). */
export interface MoneyPorts {
  portfolio(account: string): Promise<Portfolio>;
  vaultState(vault: string): Promise<Pick<VaultState, "totalSupply" | "totalAmount">>;
  shares(vault: string, owner: string): Promise<bigint>;
  /** Annual yield in percent, or null when unknown. */
  vaultApy(vault: string): Promise<number | null>;
  buildVaultTx(input: {
    kind: "invest" | "redeem";
    account: string;
    vault: string;
    vaultName: string;
    unit: string;
    amount7: bigint;
    shares7?: bigint;
  }): Promise<ExitTransaction>;
  buildTrustlineTx(input: { account: string; asset: string; label: string }): Promise<ExitTransaction>;
  /** Buying or selling TESOURO on the order book (T-029); absent where there's no market to reach. */
  buildTradeTx?(input: TradeTxInput): Promise<ExitTransaction>;
  hasTrustline(account: string, asset: string): Promise<boolean>;
  submit(signedXdr: string): Promise<{ status: string; error?: string }>;
  txStatus(hash: string): Promise<"pending" | "success" | "failed">;
  /** Etherfuse (sandbox); absent when not configured. */
  ramp?: Pick<EtherfuseClient, "onboard" | "quote" | "order" | "getOrder" | "simulatePaid">;
}

export interface MoneyOptions {
  backbone: Pick<Backbone, "withTransaction">;
  ports: MoneyPorts;
  /** BRL per USD, to show amounts in reais. */
  rateBrlPerUsd: string;
  /** The dollar Vants pays with (Circle USDC): what TESOURO is bought with and sold for, and what values it. */
  dollar?: string;
}

const Amount = z.string().regex(/^\d{1,12}(\.\d{1,7})?$/, { message: "amount: up to 7 decimals" });
const VaultBody = z.strictObject({ vault: z.string().regex(/^C[A-Z2-7]{55}$/), amount: Amount });
const SubmitBody = z.strictObject({ signedXdr: z.string().min(1).max(20_000) });
const Target = z.enum(["USDC", "TESOURO"]);
const ProfileBody = z.strictObject({
  givenName: z.string().trim().min(1).max(60),
  familyName: z.string().trim().min(1).max(80),
  cpf: z.string().min(11).max(14),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  email: z.string().email().max(120),
  phone: z.string().min(10).max(20),
  occupation: z.string().trim().min(2).max(60),
  address: z.strictObject({
    street: z.string().trim().min(3).max(120),
    city: z.string().trim().min(2).max(60),
    region: z.string().trim().length(2),
    postalCode: z.string().regex(/^\d{5}-?\d{3}$/),
  }),
});
const QuoteBody = z.strictObject({ target: Target, amountBrl: z.string().regex(/^\d{1,7}(\.\d{1,2})?$/) });
const OrderBody = z.strictObject({ quoteId: z.uuid() });
const TradeBody = z.union([
  z.strictObject({ side: z.enum(["buy", "sell"]), amountBrl: z.string().regex(/^\d{1,7}(\.\d{1,2})?$/) }),
  z.strictObject({ side: z.literal("sell"), all: z.literal(true) }),
]);

/**
 * "12.34" reais at a rate (BRL per USD) → dollars in 7-decimal units, rounded down, in integers only: cents × 10¹¹ ÷ rate
 * in micros, as `priceQuote` (T-034: the float version came out one stroop short, e.g. R$ 3,51 at 5.4 → 6499999).
 */
export function brlToUsd7(amountBrl: string, rate: string): bigint {
  const [whole = "0", frac = ""] = amountBrl.split(".");
  const cents = BigInt(whole) * 100n + BigInt(frac.padEnd(2, "0").slice(0, 2));
  return (cents * 10n ** 11n) / rateToMicros(rate);
}

/** 7-decimal units → "12.5"; zero is "0" (formatAmount7 takes positive amounts only). */
const fmt = (amount7: bigint) => (amount7 > 0n ? formatAmount7(amount7) : "0");

/** What the person sees for each thing reais can buy. */
const TARGET_LABEL: Record<z.infer<typeof Target>, string> = {
  USDC: "dólar digital",
  TESOURO: "Tesouro",
};

/** Quotes live two minutes: kept here, by account, so an order is placed at the price the person saw. */
interface HeldQuote {
  account: string;
  target: z.infer<typeof Target>;
  amountBrl: string;
  amountAsset: string;
  feeBrl: string;
  expiresAt: number;
}

/** A Pix deposit as the app shows it (also an Atividade item, T-033). */
export const rampOrderView = (o: RampOrder, statusPage?: string) => ({
  id: o.id,
  target: Object.entries(RAMP_TARGETS).find(([, v]) => v === o.targetAsset)?.[0] ?? o.targetAsset,
  amountBrl: o.amountBrl,
  receive: o.amountAsset,
  feeBrl: o.feeBrl,
  status: o.status,
  pixCode: o.pixCode,
  deliveredTx: o.deliveredTx,
  createdAt: o.createdAt,
  updatedAt: o.updatedAt,
  statusPage: statusPage?.startsWith("https://") ? statusPage : null,
});

/**
 * A signed action as an Atividade item (T-033): what it was (invest, redeem, a Tesouro trade, accepting an asset), its
 * status, the amounts it was built with, and for investing the vault's asset and name, so the app can name it.
 */
export const actionActivityView = (a: ActionRecord) => {
  const v = a.detail.vault ? INVEST_VAULTS.find((x) => x.id === a.detail.vault) : undefined;
  return {
    id: a.id,
    kind: a.kind,
    status: a.status,
    detail: a.detail,
    vault: v ? { id: v.id, asset: v.assetName, name: v.name } : null,
    createdAt: a.createdAt,
    transaction: { hash: a.txHash, summary: a.summary },
  };
};

export const moneyRoutes: FastifyPluginAsync<MoneyOptions> = async (app, opts) => {
  const { backbone, ports } = opts;
  const quotes = new Map<string, HeldQuote>();
  const now = () => Math.floor(Date.now() / 1000);

  const parse = <S extends z.ZodType>(schema: S, value: unknown): z.output<S> => {
    const r = schema.safeParse(value);
    if (!r.success) throw new ApiError(400, "INVALID_REQUEST", r.error.issues.map((i) => i.message).join("; "));
    return r.data;
  };
  const handle =
    (fn: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        return await fn(req, reply);
      } catch (err) {
        if (err instanceof ApiError) return reply.code(err.status).send(errorBody(err.code, err.message));
        throw err;
      }
    };
  const account = (req: FastifyRequest) => req.account ?? "";
  const vaultOf = (id: string) => {
    const v = INVEST_VAULTS.find((x) => x.id === id);
    if (!v) throw new ApiError(404, "VAULT_NOT_FOUND", "Vants doesn't offer that vault");
    return v;
  };
  const unitOf = (assetName: string) => (assetName === "native" ? "XLM" : (assetName.split(":")[0] ?? ""));
  /** What the account could put in: its spendable balance of the vault's asset. */
  const available7 = (p: Portfolio, assetName: string) => {
    const pos = p.positions.find((x) => x.kind === "classic" && x.asset === assetName);
    return pos ? parseAmount7(pos.amount) : 0n;
  };
  const actionView = (a: ActionRecord) => ({
    id: a.id,
    kind: a.kind,
    status: a.status,
    detail: a.detail,
    createdAt: a.createdAt,
    transaction: { hash: a.txHash, maxTime: a.maxTime, summary: a.summary },
  });
  const issue = async (
    me: string,
    kind: ActionRecord["kind"],
    detail: Record<string, string>,
    built: ExitTransaction,
  ) => {
    const action = {
      id: `act_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
      account: me,
      kind,
      detail,
      txHash: built.hash,
      txXdr: built.xdr,
      maxTime: built.maxTime,
      summary: built.summary,
    };
    await backbone.withTransaction((tx) => insertAction(tx, action));
    return {
      id: action.id,
      kind,
      transaction: { xdr: built.xdr, hash: built.hash, maxTime: built.maxTime, summary: built.summary },
    };
  };

  // --- investing ------------------------------------------------------------------------------------------------------

  app.get(
    "/app/invest",
    handle(async (req) => {
      const me = account(req);
      // The portfolio and the vaults together (T-039): the vaults' shares and totals join the portfolio's own reads.
      const [portfolio, vaults] = await Promise.all([ports.portfolio(me), vaultViews(me)]);
      return {
        vaults: vaults.map((v) => ({ ...v, canInvest: fmt(available7(portfolio, v.asset)) })),
        rate: opts.rateBrlPerUsd,
        tesouro: await tesouroView(me, portfolio),
      };
    }),
  );

  /** Each vault on offer: its yield and what the account has in it. */
  const vaultViews = (me: string) =>
    Promise.all(
      INVEST_VAULTS.map(async (v) => {
        const [apy, shares, state] = await Promise.all([
          ports.vaultApy(v.id).catch(() => null),
          ports.shares(v.id, me).catch(() => 0n),
          ports.vaultState(v.id),
        ]);
        const invested = state.totalSupply > 0n ? (shares * state.totalAmount) / state.totalSupply : 0n;
        return {
          id: v.id,
          name: v.name,
          asset: v.assetName as string,
          unit: unitOf(v.assetName),
          apyPercent: apy,
          invested: fmt(invested),
        };
      }),
    );

  app.post(
    "/app/invest",
    handle(async (req, reply) => {
      const body = parse(VaultBody, req.body);
      const me = account(req);
      const v = vaultOf(body.vault);
      const amount7 = parseAmount7(body.amount);
      const can = available7(await ports.portfolio(me), v.assetName);
      if (amount7 <= 0n || amount7 > can)
        throw new ApiError(422, "OVER_BALANCE", `you can invest up to ${fmt(can)} ${unitOf(v.assetName)}`);
      const built = await ports.buildVaultTx({
        kind: "invest",
        account: me,
        vault: v.id,
        vaultName: v.name,
        unit: unitOf(v.assetName),
        amount7,
      });
      return reply.code(201).send(await issue(me, "invest", { vault: v.id, amount: body.amount }, built));
    }),
  );

  app.post(
    "/app/redeem",
    handle(async (req, reply) => {
      const body = parse(VaultBody, req.body);
      const me = account(req);
      const v = vaultOf(body.vault);
      const amount7 = parseAmount7(body.amount);
      const [held, state] = await Promise.all([ports.shares(v.id, me), ports.vaultState(v.id)]);
      const shares7 = amount7 > 0n && state.totalAmount > 0n ? sharesForUnderlying(amount7, state) : 0n;
      if (shares7 <= 0n || shares7 > held) {
        const max = state.totalSupply > 0n ? (held * state.totalAmount) / state.totalSupply : 0n;
        throw new ApiError(422, "OVER_BALANCE", `you can take out up to ${fmt(max)} ${unitOf(v.assetName)}`);
      }
      const built = await ports.buildVaultTx({
        kind: "redeem",
        account: me,
        vault: v.id,
        vaultName: v.name,
        unit: unitOf(v.assetName),
        amount7,
        shares7,
      });
      return reply.code(201).send(await issue(me, "redeem", { vault: v.id, amount: body.amount }, built));
    }),
  );

  // --- Tesouro on the order book (T-029) --------------------------------------------------------------------------------
  // Etherfuse's sandbox completes Pix orders without delivering TESOURO on testnet, but its market maker quotes TESOURO
  // against Circle USDC on the order book: buying it there with lumens or dollars (and selling it back) is real.

  const TESOURO = RAMP_TARGETS.TESOURO;
  const usd7 = (s: string | null | undefined) => parseAmount7(s ?? "0");
  /** What pays for Tesouro: the dollar when it covers the amount, else lumens (worth their estimate). */
  const payers = (p: Portfolio) =>
    p.positions.filter(
      (x) => x.kind === "classic" && (x.asset === opts.dollar || x.asset === "native") && x.payable && x.valueUsd,
    );
  /** The most Tesouro the wallet can buy now, in dollars: whichever payer is worth more. */
  const canBuy7 = (p: Portfolio) =>
    payers(p)
      .map((x) => usd7(x.valueUsd))
      .reduce(greater, 0n);
  const tesouroView = async (me: string, p: Portfolio) => {
    if (!ports.buildTradeTx || !opts.dollar) return null;
    const held = p.positions.find((x) => x.kind === "classic" && x.asset === TESOURO);
    return {
      asset: TESOURO,
      held: held?.amount ?? "0",
      valueUsd: held?.valueUsd ?? (held ? null : "0"),
      trusted: held ? true : await ports.hasTrustline(me, TESOURO).catch(() => false),
      canBuyUsd: fmt(canBuy7(p)),
    };
  };

  app.post(
    "/app/tesouro",
    handle(async (req, reply) => {
      const body = parse(TradeBody, req.body);
      const me = account(req);
      const build = ports.buildTradeTx;
      const dollar = opts.dollar;
      if (!build || !dollar) throw new ApiError(503, "TRADE_UNAVAILABLE", "Tesouro can't be traded here");
      const value7 = "amountBrl" in body ? brlToUsd7(body.amountBrl, opts.rateBrlPerUsd) : 0n;
      if ("amountBrl" in body && value7 <= 0n) throw new ApiError(422, "OVER_BALANCE", "choose an amount");
      const p = await ports.portfolio(me);
      let input: TradeTxInput;
      if (body.side === "buy") {
        if (!(await ports.hasTrustline(me, TESOURO)))
          throw new ApiError(409, "TRUSTLINE_REQUIRED", "the wallet must accept Tesouro first (once)");
        // The dollar if it covers the amount on its own, else lumens: one asset pays, so it's one path payment.
        const pay = payers(p)
          .filter((x) => usd7(x.valueUsd) >= value7)
          .sort((a, b) => (a.asset === dollar ? -1 : b.asset === dollar ? 1 : 0))[0];
        if (!pay) throw new ApiError(422, "OVER_BALANCE", `you can buy up to ${fmt(canBuy7(p))} dollars of Tesouro`);
        input = { side: "buy", account: me, asset: TESOURO, other: pay.asset, dollar, value7, slippageBps: 100 };
      } else {
        const held = p.positions.find((x) => x.kind === "classic" && x.asset === TESOURO);
        const held7 = parseAmount7(held?.amount ?? "0");
        if (held7 <= 0n || ("amountBrl" in body && value7 > usd7(held?.valueUsd)))
          throw new ApiError(422, "OVER_BALANCE", `you can sell up to ${held?.valueUsd ?? "0"} dollars of Tesouro`);
        // Sold for the dollar where the wallet accepts it; otherwise for lumens, which every account can receive.
        const other = (await ports.hasTrustline(me, dollar)) ? dollar : "native";
        input = {
          side: "sell",
          account: me,
          asset: TESOURO,
          other,
          dollar,
          value7,
          held7,
          ...("all" in body ? { all: true } : {}),
          slippageBps: 100,
        };
      }
      let built: ExitTransaction;
      try {
        built = await build(input);
      } catch (err) {
        if (err instanceof NoMarketError) throw new ApiError(422, "NO_MARKET", err.message);
        throw err;
      }
      const detail = { asset: TESOURO, side: body.side, ...("amountBrl" in body ? { amountBrl: body.amountBrl } : {}) };
      return reply.code(201).send(await issue(me, "trade", detail, built));
    }),
  );

  app.post<{ Params: { id: string } }>(
    "/app/actions/:id/submit",
    handle(async (req, reply) => {
      const body = parse(SubmitBody, req.body);
      const a = await backbone.withTransaction((tx) => getAction(tx, (req.params as { id: string }).id, account(req)));
      if (!a) return reply.code(404).send(errorBody("ACTION_NOT_FOUND", "no such action"));
      if (a.status !== "built") return reply.code(200).send({ status: a.status, txHash: a.txHash });
      let tx: Transaction;
      try {
        const parsed = TransactionBuilder.fromXDR(body.signedXdr, Networks.TESTNET);
        if (!("operations" in parsed) || "innerTransaction" in parsed) throw new Error("fee bumps aren't accepted");
        tx = parsed as Transaction;
      } catch {
        throw new ApiError(400, "INVALID_REQUEST", "signedXdr is not a testnet transaction envelope");
      }
      if (Buffer.from(tx.hash()).toString("hex") !== a.txHash)
        throw new ApiError(409, "PLAN_MISMATCH", "this is not the transaction Vants planned for this action");
      if (tx.signatures.length === 0) throw new ApiError(400, "INVALID_REQUEST", "the transaction is not signed");
      if (now() > a.maxTime) throw new ApiError(409, "ACTION_EXPIRED", "the deadline passed; start again");
      const sent = await ports.submit(body.signedXdr);
      if (sent.status === "ERROR") throw new ApiError(422, "SUBMIT_FAILED", sent.error ?? "the network refused it");
      await backbone.withTransaction((t) => setActionStatus(t, a.id, "submitted"));
      return reply.code(202).send({ status: "submitted", txHash: a.txHash });
    }),
  );

  app.get<{ Params: { id: string } }>(
    "/app/actions/:id",
    handle(async (req, reply) => {
      const me = account(req);
      let a = await backbone.withTransaction((tx) => getAction(tx, (req.params as { id: string }).id, me));
      if (!a) return reply.code(404).send(errorBody("ACTION_NOT_FOUND", "no such action"));
      if (a.status === "submitted") {
        const s = await ports.txStatus(a.txHash).catch(() => "pending" as const);
        if (s !== "pending") {
          const id = a.id;
          await backbone.withTransaction((tx) => setActionStatus(tx, id, s === "success" ? "done" : "failed"));
          a = { ...a, status: s === "success" ? "done" : "failed" };
        }
      }
      return actionView(a);
    }),
  );

  // --- adding money by Pix (Etherfuse) ---------------------------------------------------------------------------------

  const ramp = () => {
    if (!ports.ramp) throw new ApiError(503, "RAMP_UNAVAILABLE", "adding money by Pix isn't available here");
    return ports.ramp;
  };
  const customerOf = async (me: string) => {
    const c = await backbone.withTransaction((tx) => getRampCustomer(tx, me));
    if (!c) throw new ApiError(409, "PROFILE_REQUIRED", "tell us who you are first (once)");
    return c;
  };
  const orderView = rampOrderView;

  app.get(
    "/app/ramp",
    handle(async (req) => {
      const me = account(req);
      const c = await backbone.withTransaction((tx) => getRampCustomer(tx, me));
      const orders = await backbone.withTransaction((tx) => listRampOrders(tx, me, 10));
      return {
        available: Boolean(ports.ramp),
        sandbox: true,
        profile: c ? { displayName: c.displayName, email: c.email } : null,
        targets: Object.keys(RAMP_TARGETS),
        orders: orders.map((o) => orderView(o)),
      };
    }),
  );

  app.post(
    "/app/ramp/profile",
    handle(async (req) => {
      const body = parse(ProfileBody, req.body);
      const me = account(req);
      const cpf = normalizePixKey("CPF", body.cpf);
      if (!cpf.ok) throw new ApiError(400, "INVALID_CPF", cpf.message);
      const phone = normalizePixKey("PHONE", body.phone);
      if (!phone.ok) throw new ApiError(400, "INVALID_PHONE", phone.message);
      const ids = await ramp().onboard(me, {
        givenName: body.givenName,
        familyName: body.familyName,
        cpf: cpf.key,
        birthDate: body.birthDate,
        email: body.email.toLowerCase(),
        phone: phone.key,
        occupation: body.occupation,
        address: body.address,
      });
      const displayName = `${body.givenName} ${body.familyName}`;
      await backbone.withTransaction((tx) =>
        saveRampCustomer(tx, { account: me, ...ids, displayName, email: body.email.toLowerCase() }),
      );
      return { displayName, email: body.email.toLowerCase() };
    }),
  );

  app.post(
    "/app/ramp/quote",
    handle(async (req) => {
      const body = parse(QuoteBody, req.body);
      const me = account(req);
      const c = await customerOf(me);
      const asset = RAMP_TARGETS[body.target];
      const [q, trusted] = await Promise.all([
        ramp().quote(c.customerId, asset, body.amountBrl),
        ports.hasTrustline(me, asset),
      ]);
      // Etherfuse's amount, cut (never rounded up) to the 7 decimals a Stellar amount has, in the same padded form as
      // before (T-034: `Number(x).toFixed(7)` rounded "0.12345678" up and turned "9.99999995" into "9.9999999").
      const r7 = parseAmount7(q.destinationAmount);
      const receive = `${r7 / 10_000_000n}.${String(r7 % 10_000_000n).padStart(7, "0")}`;
      quotes.set(q.quoteId, {
        account: me,
        target: body.target,
        amountBrl: body.amountBrl,
        amountAsset: receive,
        feeBrl: q.feeAmount,
        expiresAt: Math.floor(Date.parse(q.expiresAt) / 1000),
      });
      return {
        quoteId: q.quoteId,
        target: body.target,
        amountBrl: body.amountBrl,
        receive,
        feeBrl: q.feeAmount,
        expiresAt: q.expiresAt,
        needsTrustline: !trusted,
      };
    }),
  );

  app.post(
    "/app/ramp/trustline",
    handle(async (req, reply) => {
      const body = parse(z.strictObject({ target: Target }), req.body);
      const me = account(req);
      const asset = RAMP_TARGETS[body.target];
      if (await ports.hasTrustline(me, asset)) return reply.code(200).send({ needed: false });
      const built = await ports.buildTrustlineTx({ account: me, asset, label: TARGET_LABEL[body.target] });
      return reply.code(201).send(await issue(me, "trustline", { asset }, built));
    }),
  );

  app.post(
    "/app/ramp/orders",
    handle(async (req, reply) => {
      const body = parse(OrderBody, req.body);
      const me = account(req);
      const q = quotes.get(body.quoteId);
      if (!q || q.account !== me) throw new ApiError(404, "QUOTE_NOT_FOUND", "no such quote; ask for a new one");
      if (now() > q.expiresAt) throw new ApiError(409, "QUOTE_EXPIRED", "the price expired; ask for a new one");
      const asset = RAMP_TARGETS[q.target];
      if (!(await ports.hasTrustline(me, asset)))
        throw new ApiError(409, "TRUSTLINE_REQUIRED", "the wallet must accept the asset first");
      const c = await customerOf(me);
      const o = await ramp().order({ bankAccountId: c.bankAccountId, publicKey: me, quoteId: body.quoteId });
      quotes.delete(body.quoteId);
      const record = {
        id: o.orderId,
        account: me,
        targetAsset: asset,
        amountBrl: q.amountBrl,
        amountAsset: q.amountAsset,
        feeBrl: q.feeBrl,
        status: o.status || "created",
        pixCode: o.depositPixCode || null,
      };
      await backbone.withTransaction((tx) => insertRampOrder(tx, record));
      return reply
        .code(201)
        .send(
          orderView(
            { ...record, deliveredTx: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
            o.statusPage,
          ),
        );
    }),
  );

  app.post<{ Params: { id: string } }>(
    "/app/ramp/orders/:id/simulate-payment",
    handle(async (req, reply) => {
      const me = account(req);
      const o = await backbone.withTransaction((tx) => getRampOrder(tx, (req.params as { id: string }).id, me));
      if (!o) return reply.code(404).send(errorBody("ORDER_NOT_FOUND", "no such order"));
      if (o.status === "created") await ramp().simulatePaid(o.id);
      return reply.code(202).send({ status: "paid" });
    }),
  );

  app.get<{ Params: { id: string } }>(
    "/app/ramp/orders/:id",
    handle(async (req, reply) => {
      const me = account(req);
      const o = await backbone.withTransaction((tx) => getRampOrder(tx, (req.params as { id: string }).id, me));
      if (!o) return reply.code(404).send(errorBody("ORDER_NOT_FOUND", "no such order"));
      if (!["completed", "failed", "refunded", "canceled"].includes(o.status)) {
        const live = await ramp()
          .getOrder(o.id)
          .catch(() => null);
        if (live && (live.status !== o.status || live.confirmedTxSignature)) {
          await backbone.withTransaction((tx) =>
            updateRampOrder(tx, o.id, live.status, live.confirmedTxSignature ?? null),
          );
          return orderView(
            { ...o, status: live.status, deliveredTx: live.confirmedTxSignature ?? o.deliveredTx },
            live.statusPage,
          );
        }
        return orderView(o, live?.statusPage);
      }
      return orderView(o);
    }),
  );
};

/** The larger of two bigints (Math.max takes numbers only). */
const greater = (a: bigint, b: bigint) => (a > b ? a : b);
