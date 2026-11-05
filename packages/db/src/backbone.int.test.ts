// T-002: the event backbone on a real Postgres (SPEC §3.3, INV-04).
import type { EventDraft } from "@vants/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPostgres, type TestPostgres } from "../test/postgres.ts";
import { type Backbone, createBackbone, migrate } from "./index.ts";

let pgc: TestPostgres;
let bb: Backbone;

const waitFor = async <T>(read: () => Promise<T>, done: (v: T) => boolean, timeoutMs = 15_000): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await read();
    if (done(v)) return v;
    if (Date.now() > deadline) throw new Error(`timed out; last value ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
};

const draft = (type: string, n: number): EventDraft => ({
  type,
  version: 1,
  aggregate: { type: "test", id: `agg-${n}` },
  correlationId: `corr-${n}`,
  causationId: null,
  payload: { n },
});

const count = async (sql: string, values: unknown[] = []) =>
  Number((await bb.pool.query<{ n: string }>(sql, values)).rows[0]?.n ?? 0);

beforeAll(async () => {
  pgc = await startPostgres();
  await migrate(pgc.url);
  await migrate(pgc.url); // idempotent
  bb = createBackbone({ databaseUrl: pgc.url, pollingIntervalSeconds: 0.5 });
  await bb.start();
  await bb.pool.query("CREATE TABLE effects (key text NOT NULL, attempt int NOT NULL)");
}, 120_000);

afterAll(async () => {
  await bb?.stop();
  await pgc?.stop();
});

describe("migration 0001", () => {
  it("creates the backbone tables", async () => {
    const tables = await bb.pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    expect(tables.rows.map((r) => r.table_name)).toEqual(
      expect.arrayContaining(["consumed_events", "cursors", "inbox", "outbox"]),
    );
  });
});

describe("inbox (INV-04)", () => {
  it("stores each (source, dedupe key) once and enqueues it once", async () => {
    await bb.ensureQueue("inbox.dup");
    const first = await bb.recordInbound({ source: "dup", dedupeKey: "evt-1", payload: { a: 1 } });
    const second = await bb.recordInbound({ source: "dup", dedupeKey: "evt-1", payload: { a: 1 } });
    expect(first.duplicate).toBe(false);
    expect(second).toEqual({ id: first.id, duplicate: true });
    expect(await count("SELECT count(*) AS n FROM inbox WHERE source = 'dup'")).toBe(1);
    expect(await count("SELECT count(*) AS n FROM pgboss.job WHERE name = 'inbox.dup'")).toBe(1);
  });

  it("a crash between the ack and the handler's commit loses nothing and applies the effect once", async () => {
    await bb.ensureQueue("inbox.crash", { retryLimit: 5, retryDelay: 0 });
    let attempts = 0;
    await bb.consumeInbox("crash", async (record, tx) => {
      attempts += 1;
      await tx.query("INSERT INTO effects (key, attempt) VALUES ($1, $2)", [record.dedupeKey, attempts]);
      if (attempts === 1) throw new Error("simulated crash after a partial write");
    });

    const { id } = await bb.recordInbound({ source: "crash", dedupeKey: "evt-crash", payload: { amount: "10" } });
    await waitFor(
      () => count("SELECT count(*) AS n FROM inbox WHERE id = $1 AND processed_at IS NOT NULL", [id]),
      (n) => n === 1,
    );

    expect(attempts).toBe(2);
    expect((await bb.pool.query("SELECT attempt FROM effects WHERE key = 'evt-crash'")).rows).toEqual([{ attempt: 2 }]);

    // The provider redelivers after we processed it: no second job, no second effect.
    expect((await bb.recordInbound({ source: "crash", dedupeKey: "evt-crash", payload: {} })).duplicate).toBe(true);
    await new Promise((r) => setTimeout(r, 1500));
    expect(await count("SELECT count(*) AS n FROM effects WHERE key = 'evt-crash'")).toBe(1);
  });
});

describe("outbox and fan-out", () => {
  it("delivers only committed events, to every subscribed queue, once per consumer", async () => {
    for (const q of ["saga.a", "saga.b"]) {
      await bb.ensureQueue(q, { retryLimit: 3, retryDelay: 0 });
      await bb.subscribe("ThingHappened", q);
    }
    const seen: Record<string, string[]> = { "saga.a": [], "saga.b": [] };
    for (const q of ["saga.a", "saga.b"] as const) {
      await bb.consume(q, async (event, tx) => {
        seen[q]?.push(event.id);
        await tx.query("INSERT INTO effects (key, attempt) VALUES ($1, 1)", [`${q}:${event.id}`]);
      });
    }

    await expect(
      bb.withTransaction(async (tx) => {
        await bb.publish(tx, [draft("ThingHappened", 1)]);
        throw new Error("rolled back");
      }),
    ).rejects.toThrow("rolled back");

    const [published] = await bb.withTransaction((tx) => bb.publish(tx, [draft("ThingHappened", 2)]));
    expect(published?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(published?.occurredAt).toBeTruthy();

    await waitFor(
      async () => [seen["saga.a"]?.length, seen["saga.b"]?.length],
      ([a, b]) => a === 1 && b === 1,
    );
    expect(seen["saga.a"]).toEqual([published?.id]);
    expect(seen["saga.b"]).toEqual([published?.id]);
    expect(await count("SELECT count(*) AS n FROM outbox")).toBe(1);

    // pg-boss redelivers the same envelope (at least once): the consumer's effect still happens once.
    await bb.boss.send("saga.a", published as object);
    await new Promise((r) => setTimeout(r, 1500));
    expect(await count("SELECT count(*) AS n FROM effects WHERE key = $1", [`saga.a:${published?.id}`])).toBe(1);
  });
});

describe("wake-up jobs (T-011)", () => {
  it("enqueues only when the caller's transaction commits", async () => {
    await bb.ensureQueue("wake.tx");
    await bb.withTransaction((tx) => bb.enqueue(tx, "wake.tx", { n: 1 }));
    await bb
      .withTransaction(async (tx) => {
        await bb.enqueue(tx, "wake.tx", { n: 2 });
        throw new Error("rollback");
      })
      .catch(() => undefined);
    const jobs = await bb.pool.query<{ data: { n: number } }>("SELECT data FROM pgboss.job WHERE name = 'wake.tx'");
    expect(jobs.rows.map((r) => r.data.n)).toEqual([1]);
  });

  it("a stately queue holds at most one waiting job, and a throwing handler is retried", async () => {
    await bb.ensureQueue("wake.pump", { policy: "stately", retryDelay: 0 });
    for (let i = 0; i < 3; i++) await bb.withTransaction((tx) => bb.enqueue(tx, "wake.pump"));
    expect(await count("SELECT count(*) AS n FROM pgboss.job WHERE name = 'wake.pump'")).toBe(1);

    let runs = 0;
    await bb.process("wake.pump", async () => {
      runs += 1;
      if (runs === 1) throw new Error("not yet");
    });
    await waitFor(
      () => count("SELECT count(*) AS n FROM pgboss.job WHERE name = 'wake.pump' AND state = 'completed'"),
      (n) => n === 1,
    );
    expect(runs).toBe(2);
  });
});

describe("ledger postings (T-015, INV-06)", () => {
  it("publish writes each event's postings in its transaction: balanced when committed, absent when rolled back", async () => {
    const deposit = (id: string): EventDraft => ({
      type: "DepositMatched",
      version: 1,
      aggregate: { type: "payment", id },
      correlationId: id,
      causationId: null,
      payload: { kind: "exact", asset: "CUSDC", amount7: "12345" },
    });
    const [kept] = await bb.withTransaction((tx) => bb.publish(tx, [deposit("pay-ledger-1")]));
    await bb
      .withTransaction(async (tx) => {
        await bb.publish(tx, [deposit("pay-ledger-2")]);
        throw new Error("rollback");
      })
      .catch(() => undefined);
    const rows = await bb.pool.query<{ event_id: string; account: string; amount: string }>(
      "SELECT event_id, account, amount::text FROM ledger_entries WHERE event_type = 'DepositMatched' ORDER BY account",
    );
    expect(rows.rows).toEqual([
      { event_id: kept?.id, account: "clearing:pay-ledger-1", amount: "-12345" },
      { event_id: kept?.id, account: "treasury", amount: "12345" },
    ]);
  });
});

describe("named locks (T-016)", () => {
  it("runs holders of the same name one at a time, across connections, and releases on throw", async () => {
    const order: string[] = [];
    const hold = (tag: string, ms: number) =>
      bb.withLock("treasury-signer-test", async () => {
        order.push(`${tag}:in`);
        await new Promise((r) => setTimeout(r, ms));
        order.push(`${tag}:out`);
      });
    await Promise.all([hold("a", 150), hold("b", 10)]);
    expect([order.slice(0, 2), order.slice(2)].map((x) => x[0]?.slice(0, 1) === x[1]?.slice(0, 1))).toEqual([
      true,
      true,
    ]);
    await expect(bb.withLock("treasury-signer-test", async () => Promise.reject(new Error("boom")))).rejects.toThrow(
      "boom",
    );
    expect(await bb.withLock("treasury-signer-test", async () => "free again")).toBe("free again");
  });
});

describe("cursors", () => {
  it("stores and updates a named cursor transactionally", async () => {
    await bb.withTransaction(async (tx) => expect(await bb.getCursor(tx, "pier.treasury")).toBeNull());
    await bb.withTransaction((tx) => bb.setCursor(tx, "pier.treasury", "100"));
    await bb.withTransaction((tx) => bb.setCursor(tx, "pier.treasury", "250"));
    await bb.withTransaction(async (tx) => expect(await bb.getCursor(tx, "pier.treasury")).toBe("250"));
  });
});
