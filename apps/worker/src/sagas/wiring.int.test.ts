// T-011: the sagas wired onto pg-boss end to end. A Pier event recorded in the inbox becomes a paid Pix or a refund
// with no manual step, and a redelivered event changes nothing (INV-04).
import { classicAsset, sacIdOf } from "@vants/adapter-stellar";
import {
  type Backbone,
  createBackbone,
  createIntegrator,
  getPayment,
  insertPayment,
  insertQuote,
  migrate,
  nextMuxId,
} from "@vants/db";
import { newPayment, priceQuote } from "@vants/domain";
import { buildStaticBrCode } from "@vants/pix";
import { Keypair } from "@stellar/stellar-sdk";
import { afterAll, beforeAll, expect, it } from "vitest";
import { startPostgres, type TestPostgres } from "../../../../packages/db/test/postgres.ts";
import { FakeHodle, FakeLedger, transferEnvelope } from "../../test/fakes.ts";
import { registerSagas } from "./index.ts";

const CIRCLE = "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const CIRCLE_SAC = sacIdOf(classicAsset(CIRCLE));
const signer = Keypair.random();
const treasury = signer.publicKey();
const payer = Keypair.random().publicKey();
const ledger = new FakeLedger(treasury, () => Math.floor(Date.now() / 1000));
const hodle = new FakeHodle();

let pgc: TestPostgres;
let bb: Backbone;
let integratorId = "";

const waitFor = async <T>(read: () => Promise<T>, done: (v: T) => boolean, timeoutMs = 20_000): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await read();
    if (done(v)) return v;
    if (Date.now() > deadline) throw new Error(`timed out; last value ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
};

beforeAll(async () => {
  pgc = await startPostgres();
  await migrate(pgc.url);
  bb = createBackbone({ databaseUrl: pgc.url, pollingIntervalSeconds: 0.5 });
  await bb.start();
  ({ integratorId } = await bb.withTransaction((tx) => createIntegrator(tx, "Wiring", "p".repeat(32))));
  await registerSagas({
    backbone: bb,
    treasury,
    now: () => new Date(),
    hodle,
    ledger,
    signer,
    float: { minMicros: 0n, targetMicros: 0n },
  });
}, 120_000);

afterAll(async () => {
  await bb?.stop();
  await pgc?.stop();
});

async function payment(n: number) {
  const valueCents = 1234;
  const price = priceQuote({ valueCents, rateMicros: 5_400_000n, feeModel: "sandbox" });
  const expiresAt = new Date(Date.now() + 120_000).toISOString();
  return bb.withTransaction(async (tx) => {
    const quote = await insertQuote(tx, {
      integratorId,
      destination: {
        type: "br_code",
        brCode: buildStaticBrCode({
          key: "k@vants.example.com",
          merchantName: "LOJA",
          merchantCity: "RIO",
          amountCents: valueCents,
        }),
        payee: { name: "LOJA", city: "RIO" },
        isDynamic: false,
      },
      assetName: CIRCLE,
      assetSac: CIRCLE_SAC,
      valueCents,
      feeCents: 0,
      rateMicros: 5_400_000n,
      assetAmount7: price.assetAmount7,
      expiresAt,
    });
    const p = newPayment({
      id: `pay_wiring_${n}`,
      muxId: await nextMuxId(tx),
      quote: {
        asset: CIRCLE_SAC,
        assetAmount7: price.assetAmount7,
        valueCents,
        feeCents: 0,
        rateMicros: 5_400_000n,
        expiresAt,
      },
    });
    await insertPayment(tx, p, integratorId, quote.id);
    return p;
  });
}

const status = async (id: string) => (await bb.withTransaction((tx) => getPayment(tx, id)))?.payment.status;

const arrive = (muxId: string, amount7: bigint) => {
  const event = transferEnvelope({
    from: payer,
    to: treasury,
    assetName: CIRCLE,
    sac: CIRCLE_SAC,
    amount7,
    muxId,
    ledgerClosedAt: new Date().toISOString(),
  });
  const signal = { source: "pier", dedupeKey: event.id, payload: { subscriptionId: "sub", event } };
  return bb.recordInbound(signal).then(async (first) => ({ first, again: await bb.recordInbound(signal) }));
};

it("an exact deposit is paid and an underpaid one refunded, from the inbox alone", async () => {
  const paid = await payment(1);
  const short = await payment(2);
  const delivered = await arrive(paid.muxId, paid.quote.assetAmount7); // webhook and pull both deliver it
  expect([delivered.first.duplicate, delivered.again.duplicate]).toEqual([false, true]);
  await arrive(paid.muxId, paid.quote.assetAmount7); // a second, distinct transfer: refunded as unexpected
  await arrive(short.muxId, 1n);

  await waitFor(
    () => status(paid.id),
    (s) => s === "completed",
  );
  await waitFor(
    () => status(short.id),
    (s) => s === "refunded",
  );
  await waitFor(
    async () => ledger.payments.length,
    (n) => n === 2,
  ); // the second transfer to `paid` is refunded too
  expect(hodle.paid.size).toBe(1);
  expect(ledger.payments.map((p) => p.memo).sort()).toEqual(
    [`vants:rf:${BigInt(paid.muxId).toString(36)}:1`, `vants:rf:${BigInt(short.muxId).toString(36)}:1`].sort(),
  );
}, 60_000);

it("the sweep is scheduled every minute", async () => {
  const s = await bb.pool.query<{ name: string; cron: string }>("SELECT name, cron FROM pgboss.schedule");
  expect(s.rows).toEqual([{ name: "payment-sweep", cron: "* * * * *" }]);
});
