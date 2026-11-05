// The mini app's backend (SPEC §5.3, T-020): SEP-1 discovery, SEP-10 login (DEC-011) and the one-transaction exit (DEC-031).
// The JWT authorizes reads and planning only; money moves only through the transaction the wallet signs (INV-09), and submit
// accepts nothing but the planned transaction.
import {
  type Backbone,
  type ExitRecord,
  getExit,
  insertExit,
  listActions,
  listExits,
  listExitsBefore,
  listRampOrdersBefore,
  MINI_APP_INTEGRATOR,
  monthSummary,
  markExitSubmitted,
  paymentResource,
  setActionStatus,
  useChallenge,
} from "@vants/db";
import { formatAmount7, formatBrl, formatRate } from "@vants/domain";
import { Keypair, Networks, StrKey, type Transaction, TransactionBuilder, WebAuth } from "@stellar/stellar-sdk";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError, errorBody, type PaymentService } from "../payments-service.ts";
import { parseAmount7 } from "./sources.ts";
import { type ExitPlan, planExit } from "./exit-plan.ts";
import { ExitBlockedError } from "./exit-tx.ts";
import type { ExitTransaction } from "./exit-tx.ts";
import { signJwt, verifyJwt } from "./jwt.ts";
import { actionActivityView, type MoneyPorts, moneyRoutes, rampOrderView } from "./money.ts";
import type { Portfolio } from "./portfolio.ts";

/** The network the mini app needs, behind ports (fakes in tests). */
export interface AppPorts {
  /** An existing account's signers and thresholds; null if the account isn't on the network. */
  accountSigners(account: string): Promise<{
    thresholds: { low: number; med: number; high: number };
    signers: { key: string; weight: number; type: string }[];
  } | null>;
  /** The SIGNING_KEY in a host wallet's stellar.toml (SEP-10 client_domain). Throws when it can't be found. */
  clientSigningKey(domain: string): Promise<string>;
  portfolio(account: string): Promise<Portfolio>;
  vaultStates(): Promise<Map<string, { totalSupply: bigint; totalAmount: bigint }>>;
  buildTx(
    plan: Extract<ExitPlan, { ok: true }>,
    ctx: { account: string; asset: string; deposit: string },
    maxTime: number,
  ): Promise<ExitTransaction>;
  /** Sends a signed envelope to Stellar RPC. */
  submit(signedXdr: string): Promise<{ status: string; error?: string }>;
  /** Investing and adding money (T-026); absent, those routes aren't served. */
  money?: MoneyPorts;
}

export interface AppOptions {
  backbone: Pick<Backbone, "withTransaction" | "publish">;
  webAuth: { homeDomain: string; signingSecret: string; jwtSecret: string };
  fundingAssets: string[];
  exitRouterId: string | undefined;
  rateBrlPerUsd: string;
  payments: PaymentService;
  ports: AppPorts;
}

/** The mini app keeps its session on the device for a week (T-023, DEC-035): the token reads and plans; it never moves money. */
const TOKEN_SECONDS = 7 * 24 * 3600;
const CHALLENGE_SECONDS = 900; // SEP-10's recommendation: 15 minutes to sign
/** Never hand out a transaction with less time than this to sign it. */
const MIN_SIGNING_SECONDS = 30;

const Destination = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("br_code"),
    brCode: z.string().min(1).max(512),
    amountBrl: z
      .string()
      .regex(/^\d{1,9}(\.\d{1,2})?$/)
      .optional(),
  }),
  z.strictObject({
    type: z.literal("pix_key"),
    key: z.string().min(1).max(77),
    keyType: z.enum(["CPF", "CNPJ", "EMAIL", "PHONE", "RANDOM"]),
    amountBrl: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/),
  }),
]);
const QuoteBody = z.strictObject({ destination: Destination });
const ExitBody = z.strictObject({
  destination: Destination,
  // A position id, or the id with how much of the payment to take from it (quote-asset units, up to 7 decimals) (T-023).
  picks: z
    .array(
      z.union([
        z.string().min(1).max(100),
        z.strictObject({
          id: z.string().min(1).max(100),
          amount: z.string().regex(/^\d{1,12}(\.\d{1,7})?$/),
        }),
      ]),
    )
    .min(1)
    .max(10),
});
/** Atividade's cursor names any kind of item: a payment (ext_), an action (act_) or an Etherfuse order id (T-033). */
const ActivityQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  before: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\|[A-Za-z0-9_-]{1,80}$/)
    .optional(),
});
const ListQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  before: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\|ext_[0-9a-f]{20}$/)
    .optional(),
});
const SubmitBody = z.strictObject({ signedXdr: z.string().min(1).max(20_000) });
const AuthBody = z.strictObject({ transaction: z.string().min(1).max(10_000) });

declare module "fastify" {
  interface FastifyRequest {
    account?: string;
  }
}

const cors = (reply: FastifyReply) => reply.header("access-control-allow-origin", "*");

export const appRoutes: FastifyPluginAsync<AppOptions> = async (app, opts) => {
  const { webAuth, ports, payments, backbone } = opts;
  const server = Keypair.fromSecret(webAuth.signingSecret);
  const home = webAuth.homeDomain;
  const issuer = `https://${home}/auth`;
  const now = () => Math.floor(Date.now() / 1000);

  // --- SEP-1 ---------------------------------------------------------------------------------------------------------
  app.get("/.well-known/stellar.toml", async (_req, reply) =>
    cors(reply)
      .type("text/plain; charset=utf-8")
      .send(
        [
          `NETWORK_PASSPHRASE="${Networks.TESTNET}"`,
          `WEB_AUTH_ENDPOINT="https://${home}/auth"`,
          `SIGNING_KEY="${server.publicKey()}"`,
          "",
        ].join("\n"),
      ),
  );

  // --- SEP-10 --------------------------------------------------------------------------------------------------------
  app.options("/auth", async (_req, reply) =>
    cors(reply)
      .header("access-control-allow-methods", "GET, POST, OPTIONS")
      .header("access-control-allow-headers", "content-type")
      .code(204)
      .send(),
  );

  app.get<{ Querystring: { account?: string; client_domain?: string } }>("/auth", async (req, reply) => {
    cors(reply);
    const account = req.query.account ?? "";
    if (!StrKey.isValidEd25519PublicKey(account))
      return reply.code(400).send({ error: "account must be a G… address" });
    let clientSigningKey: string | null = null;
    const clientDomain = req.query.client_domain;
    if (clientDomain) {
      if (!/^[a-z0-9.-]{1,253}$/i.test(clientDomain)) return reply.code(400).send({ error: "invalid client_domain" });
      try {
        clientSigningKey = await ports.clientSigningKey(clientDomain);
      } catch {
        return reply.code(400).send({ error: `no SIGNING_KEY in ${clientDomain}'s stellar.toml` });
      }
    }
    const transaction = WebAuth.buildChallengeTx(
      server,
      account,
      home,
      CHALLENGE_SECONDS,
      Networks.TESTNET,
      home,
      null,
      clientDomain ?? null,
      clientSigningKey,
    );
    return reply.send({ transaction, network_passphrase: Networks.TESTNET });
  });

  app.post("/auth", async (req, reply) => {
    cors(reply);
    const body = AuthBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "send { transaction }" });
    const xdr = body.data.transaction;
    try {
      const { tx, clientAccountID } = WebAuth.readChallengeTx(xdr, server.publicKey(), Networks.TESTNET, home, home);
      if (!StrKey.isValidEd25519PublicKey(clientAccountID)) throw new Error("only G… accounts");
      // The SDK allows 5 minutes past the deadline (clock skew); a login has 15 minutes to sign, so hold it to its own.
      const deadline = Number(tx.timeBounds?.maxTime ?? 0);
      if (!deadline || now() > deadline) throw new Error("the challenge expired: ask for a new one");
      const account = await ports.accountSigners(clientAccountID);
      if (account) {
        // SEP-10: the client's signatures (the server's excluded) must reach the medium threshold.
        WebAuth.verifyChallengeTxThreshold(
          xdr,
          server.publicKey(),
          Networks.TESTNET,
          account.thresholds.med,
          account.signers,
          home,
          home,
        );
      } else {
        // Not on the network yet: exactly the master key's signature.
        const signers = WebAuth.verifyChallengeTxSigners(
          xdr,
          server.publicKey(),
          Networks.TESTNET,
          [clientAccountID],
          home,
          home,
        );
        if (!signers.includes(clientAccountID)) throw new Error("not signed by the account's master key");
      }
      const hash = Buffer.from(tx.hash()).toString("hex");
      if (!(await backbone.withTransaction((t) => useChallenge(t, hash, clientAccountID)))) {
        return reply.code(401).send({ error: "this challenge was already used" });
      }
      const clientDomainOp = (tx as Transaction).operations.find(
        (op) => op.type === "manageData" && op.name === "client_domain",
      );
      const clientDomain =
        clientDomainOp?.type === "manageData" && clientDomainOp.value
          ? Buffer.from(clientDomainOp.value).toString()
          : undefined;
      const iat = now();
      const token = signJwt(
        {
          iss: issuer,
          sub: clientAccountID,
          iat,
          exp: iat + TOKEN_SECONDS,
          jti: hash,
          ...(clientDomain ? { client_domain: clientDomain } : {}),
        },
        webAuth.jwtSecret,
      );
      return reply.send({ token });
    } catch (err) {
      return reply.code(401).send({ error: err instanceof Error ? err.message : "invalid challenge" });
    }
  });

  // --- /app ------------------------------------------------------------------------------------------------------------
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/app/")) return;
    const auth = req.headers.authorization ?? "";
    const claims = auth.startsWith("Bearer ")
      ? verifyJwt(auth.slice(7), webAuth.jwtSecret, { iss: issuer, nowSeconds: now() })
      : null;
    if (!claims) return reply.code(401).send(errorBody("UNAUTHORIZED", "log in with your wallet (SEP-10)"));
    req.account = claims.sub;
  });

  const parse = <S extends z.ZodType>(schema: S, req: FastifyRequest): z.output<S> => {
    const r = schema.safeParse(req.body);
    if (!r.success) {
      throw new ApiError(
        400,
        "INVALID_REQUEST",
        r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "),
      );
    }
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

  app.get(
    "/app/portfolio",
    // With the rate, so the app can show balances in reais (T-023); prices stay estimates until a quote fixes them.
    handle(async (req) => ({ ...(await ports.portfolio(account(req))), rate: opts.rateBrlPerUsd })),
  );

  /** Price first (earlier prototype): what the code charges, in every asset Vants takes, before anything is picked. */
  app.post(
    "/app/exits/quote",
    handle(async (req) => {
      const body = parse(QuoteBody, req);
      const { destination, valueCents } = payments.resolveDestination(body.destination);
      // Price first includes "can Vants pay it now?": say so before the user picks anything.
      await backbone.withTransaction((tx) => payments.ensureFloatFor(tx, valueCents));
      const price = payments.price(valueCents);
      return {
        amountBrl: formatBrl(valueCents),
        feeBrl: formatBrl(price.feeCents),
        rate: formatRate(payments.rateMicros),
        ...(destination.type === "br_code"
          ? { payee: destination.payee }
          : { pixKey: destination.key, pixKeyType: destination.keyType }),
        assets: opts.fundingAssets.map((asset) => ({ asset, assetAmount: formatAmount7(price.assetAmount7) })),
        portfolio: await ports.portfolio(account(req)),
      };
    }),
  );

  app.post(
    "/app/exits",
    handle(async (req, reply) => {
      const body = parse(ExitBody, req);
      const me = account(req);
      const { valueCents } = payments.resolveDestination(body.destination);
      const portfolio = await ports.portfolio(me);
      const picks = body.picks.map((p) =>
        typeof p === "string" ? { id: p } : { id: p.id, amount7: parseAmount7(p.amount) },
      );
      const picked = picks.map((pick) => portfolio.positions.find((p) => p.id === pick.id));
      const first = picked[0];
      // The payment is in the first pick's asset. Something sold first (XLM, or TESOURO since T-029) is swapped into the
      // first funding asset when it covers the amount on its own (later picks untouched); otherwise into the asset of the
      // first pick that is a dollar, which pays the rest.
      const sold = (p: (typeof picked)[number]) => p?.pricing === "estimated";
      const later = picked.find((p) => p && !sold(p))?.asset;
      // Lumens taken out of the vault are swapped on the AMM into the payer's own account, which needs that dollar's
      // trustline (T-026): prefer a dollar the account already holds.
      const held = opts.fundingAssets.filter((a) =>
        portfolio.positions.some((p) => p.kind === "classic" && p.asset === a),
      );
      const fromLumensVault = picked.some((p) => p?.kind === "defindex" && p.asset === "native");
      const candidates =
        first && sold(first)
          ? later
            ? [opts.fundingAssets[0] ?? "", later]
            : fromLumensVault
              ? [...new Set([...held, opts.fundingAssets[0] ?? ""])]
              : [opts.fundingAssets[0] ?? ""]
          : [first?.asset ?? ""];
      const vaultStates = await ports.vaultStates();
      let asset = candidates[0] ?? "";
      let plan: ExitPlan = {
        ok: false,
        reason: first ? "wrong_asset" : "unknown_position",
        detail: first ? `Vants doesn't take ${first.asset}` : `no position ${picks[0]?.id}`,
      };
      for (const candidate of candidates.filter((a) => payments.assets.has(a))) {
        const p = planExit(
          { asset: candidate, amount7: payments.price(valueCents).assetAmount7 },
          picks,
          portfolio.positions,
          vaultStates,
        );
        if (p.ok || candidate === candidates[0]) [asset, plan] = [candidate, p];
        if (p.ok) break;
      }
      if (!plan.ok) return reply.code(422).send({ ...errorBody("EXIT_BLOCKED", plan.detail), reason: plan.reason });
      if (plan.route === "router" && !opts.exitRouterId) {
        return reply
          .code(422)
          .send({ ...errorBody("EXIT_BLOCKED", "vault payments aren't enabled here"), reason: "router_unavailable" });
      }

      // The quote and payment, exactly as for an integrator; a bad deposit is refunded to the user's own account.
      const { payment, quote } = await backbone.withTransaction(async (tx) => {
        const q = await payments.createQuote(tx, MINI_APP_INTEGRATOR, { destination: body.destination, asset });
        return payments.acceptQuote(tx, MINI_APP_INTEGRATOR, q.id, me);
      });
      // The transaction can't outlive the quote: signed too late, it simply can't land.
      const maxTime = Math.min(Math.floor(Date.parse(quote.expiresAt) / 1000), now() + 300);
      if (maxTime - now() < MIN_SIGNING_SECONDS)
        throw new ApiError(409, "QUOTE_EXPIRED", "not enough time left to sign; try again");
      let built: Awaited<ReturnType<AppPorts["buildTx"]>>;
      try {
        built = await ports.buildTx(
          plan,
          { account: me, asset, deposit: payments.deposit(payment.muxId).address },
          maxTime,
        );
      } catch (err) {
        // Priced but not buildable now (the AMM leg costs more XLM than the account can spend): nothing to sign. The payment
        // just created is never funded and expires with its quote.
        if (err instanceof ExitBlockedError)
          return reply.code(422).send({ ...errorBody("EXIT_BLOCKED", err.message), reason: err.reason });
        throw err;
      }
      const exit = {
        id: `ext_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
        account: me,
        paymentId: payment.id,
        route: plan.route,
        picks: body.picks,
        txHash: built.hash,
        txXdr: built.xdr,
        maxTime: built.maxTime,
        summary: built.summary,
      };
      await backbone.withTransaction((tx) => insertExit(tx, exit));
      return reply.code(201).send({
        id: exit.id,
        paymentId: payment.id,
        route: plan.route,
        amountBrl: formatBrl(quote.valueCents),
        asset,
        assetAmount: formatAmount7(quote.assetAmount7),
        transaction: { xdr: built.xdr, hash: built.hash, maxTime: built.maxTime, summary: built.summary },
      });
    }),
  );

  const exitView = async (e: ExitRecord) => ({
    id: e.id,
    route: e.route,
    status: e.status,
    createdAt: e.createdAt,
    picks: e.picks,
    transaction: { hash: e.txHash, maxTime: e.maxTime, summary: e.summary },
    payment: await backbone.withTransaction((tx) => paymentResource(tx, e.paymentId, { deposit: payments.deposit })),
  });

  /** How much one payment can be right now: what the float covers (T-025). The app shows it before the user types. */
  app.get(
    "/app/limits",
    handle(async () => ({
      maxBrl: formatBrl(await backbone.withTransaction((tx) => payments.maxPayableCents(tx))),
    })),
  );

  app.get(
    "/app/exits",
    handle(async (req) => {
      const q = ListQuery.safeParse(req.query);
      if (!q.success) throw new ApiError(400, "INVALID_REQUEST", q.error.issues.map((i) => i.message).join("; "));
      const page = await backbone.withTransaction((tx) =>
        listExits(tx, account(req), { limit: q.data.limit, ...(q.data.before ? { before: q.data.before } : {}) }),
      );
      const month = await backbone.withTransaction((tx) => monthSummary(tx, account(req)));
      return {
        items: await Promise.all(page.items.map(exitView)),
        next: page.next,
        month: { paidBrl: formatBrl(month.cents), count: month.count },
      };
    }),
  );

  /**
   * Atividade (T-033): everything the account did, newest first: Pix payments, investing and redeeming, Tesouro trades,
   * accepting an asset, and money added by Pix. One cursor (`<created_at>|<id>`) pages through all three tables: each is
   * read `limit + 1` past the cursor, so the merged first `limit` are exact and `next` says whether more remain. Actions
   * still `submitted` are settled from the network first, as `GET /app/actions/:id` does. The month line counts paid Pix.
   */
  app.get(
    "/app/activity",
    handle(async (req) => {
      const q = ActivityQuery.safeParse(req.query);
      if (!q.success) throw new ApiError(400, "INVALID_REQUEST", q.error.issues.map((i) => i.message).join("; "));
      const me = account(req);
      const page = { limit: q.data.limit, ...(q.data.before ? { before: q.data.before } : {}) };
      const [exits, actions, orders, month] = await backbone.withTransaction(
        async (tx) =>
          [
            await listExitsBefore(tx, me, page),
            await listActions(tx, me, page),
            await listRampOrdersBefore(tx, me, page),
            await monthSummary(tx, me),
          ] as const,
      );
      type Item = {
        type: "payment" | "action" | "deposit";
        id: string;
        createdAt: string;
        build: () => Promise<object>;
      };
      const merged: Item[] = [
        ...exits.map(
          (e): Item => ({
            type: "payment",
            id: e.id,
            createdAt: e.createdAt,
            build: async () => ({ exit: await exitView(e) }),
          }),
        ),
        ...actions.map(
          (a): Item => ({
            type: "action",
            id: a.id,
            createdAt: a.createdAt,
            build: async () => {
              let status = a.status;
              const txStatus = ports.money?.txStatus;
              if (status === "submitted" && txStatus) {
                const s = await txStatus(a.txHash).catch(() => "pending" as const);
                if (s !== "pending") {
                  status = s === "success" ? "done" : "failed";
                  const settled = status;
                  await backbone.withTransaction((tx) => setActionStatus(tx, a.id, settled));
                }
              }
              return { action: actionActivityView({ ...a, status }) };
            },
          }),
        ),
        ...orders.map(
          (o): Item => ({
            type: "deposit",
            id: o.id,
            createdAt: o.createdAt,
            build: async () => ({ order: rampOrderView(o) }),
          }),
        ),
      ].sort((x, y) => (x.createdAt === y.createdAt ? (x.id < y.id ? 1 : -1) : x.createdAt < y.createdAt ? 1 : -1));
      const shown = merged.slice(0, q.data.limit);
      const last = shown.at(-1);
      return {
        items: await Promise.all(
          shown.map(async (i) => ({ type: i.type, id: i.id, createdAt: i.createdAt, ...(await i.build()) })),
        ),
        next: merged.length > q.data.limit && last ? `${last.createdAt}|${last.id}` : null,
        month: { paidBrl: formatBrl(month.cents), count: month.count },
      };
    }),
  );

  app.get<{ Params: { id: string } }>(
    "/app/exits/:id",
    handle(async (req, reply) => {
      const e = await backbone.withTransaction((tx) => getExit(tx, (req.params as { id: string }).id, account(req)));
      if (!e) return reply.code(404).send(errorBody("EXIT_NOT_FOUND", "no such exit"));
      return exitView(e);
    }),
  );

  app.post<{ Params: { id: string } }>(
    "/app/exits/:id/submit",
    handle(async (req, reply) => {
      const body = parse(SubmitBody, req);
      const e = await backbone.withTransaction((tx) => getExit(tx, (req.params as { id: string }).id, account(req)));
      if (!e) return reply.code(404).send(errorBody("EXIT_NOT_FOUND", "no such exit"));
      if (e.status === "submitted") return reply.code(200).send({ status: "submitted", txHash: e.txHash });
      let tx: Transaction;
      try {
        const parsed = TransactionBuilder.fromXDR(body.signedXdr, Networks.TESTNET);
        if (!("operations" in parsed) || "innerTransaction" in parsed) throw new Error("fee bumps aren't accepted");
        tx = parsed as Transaction;
      } catch {
        throw new ApiError(400, "INVALID_REQUEST", "signedXdr is not a testnet transaction envelope");
      }
      if (Buffer.from(tx.hash()).toString("hex") !== e.txHash) {
        throw new ApiError(409, "PLAN_MISMATCH", "this is not the transaction Vants planned for this exit");
      }
      if (tx.signatures.length === 0) throw new ApiError(400, "INVALID_REQUEST", "the transaction is not signed");
      if (now() > e.maxTime)
        throw new ApiError(409, "EXIT_EXPIRED", "the transaction's deadline passed; start a new payment");
      const sent = await ports.submit(body.signedXdr);
      if (sent.status === "ERROR")
        throw new ApiError(422, "SUBMIT_FAILED", sent.error ?? "the network refused the transaction");
      await backbone.withTransaction((t) => markExitSubmitted(t, e.id));
      return reply.code(202).send({ status: "submitted", txHash: e.txHash });
    }),
  );

  if (ports.money)
    await app.register(moneyRoutes, {
      backbone,
      ports: ports.money,
      rateBrlPerUsd: opts.rateBrlPerUsd,
      ...(opts.fundingAssets[0] ? { dollar: opts.fundingAssets[0] } : {}),
    });
};
