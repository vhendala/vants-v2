// The event backbone (SPEC §3.3): outbox + pg-boss fan-out for domain events, an inbox for external signals, and
// transactional consumers, so every effect commits together with the job that caused it (INV-04).
import { randomUUID } from "node:crypto";
import { type DomainEvent, type EventDraft, postingsFor } from "@vants/domain";
import pg from "pg";
import { type Job, PgBoss, type QueuePolicy } from "pg-boss";
import { type BossDb, fromBossDb, type Tx, toBossDb, withTransaction } from "./tx.ts";

export interface BackboneOptions {
  databaseUrl: string;
  /** Base polling interval for workers, in seconds (pg-boss minimum 0.5). Queues also wake up on NOTIFY. */
  pollingIntervalSeconds?: number;
}

export interface QueueSettings {
  /** Attempts after the first before the job is marked failed. Default 10. */
  retryLimit?: number;
  /** Seconds before the first retry; doubles with backoff. Default 1. */
  retryDelay?: number;
  /** Cap on the backoff delay, in seconds. Default 300. */
  retryDelayMax?: number;
  /** Seconds a job may run before it is retried. Default 300. */
  expireInSeconds?: number;
  /** pg-boss queue policy. `stately` (one waiting, one running) makes a queue a single-flight pump. Default `standard`. */
  policy?: QueuePolicy;
}

export interface InboundSignal {
  source: string;
  dedupeKey: string;
  payload: unknown;
}

export interface InboxRecord {
  id: string;
  source: string;
  dedupeKey: string;
  payload: unknown;
  receivedAt: string;
}

export type EventHandler = (event: DomainEvent, tx: Tx) => Promise<void>;
export type InboxHandler = (record: InboxRecord, tx: Tx) => Promise<void>;

export interface Backbone {
  readonly pool: pg.Pool;
  readonly boss: PgBoss;
  start(): Promise<void>;
  stop(): Promise<void>;
  withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** Runs `fn` while holding a named session-level advisory lock: one holder at a time across processes, no open transaction. */
  withLock<T>(name: string, fn: () => Promise<T>): Promise<T>;
  ensureQueue(name: string, settings?: QueueSettings): Promise<void>;
  /** Route every event of `eventType` to `queue` (fan-out: one queue per consumer). */
  subscribe(eventType: string, queue: string): Promise<void>;
  /** Append to the outbox and enqueue for every subscriber, inside the caller's transaction. */
  publish(tx: Tx, drafts: EventDraft[]): Promise<DomainEvent[]>;
  /** Wake `queue` once the caller's transaction commits. Jobs carry no state: handlers read it from the database. */
  enqueue(tx: Tx, queue: string, data?: object): Promise<void>;
  /** Run `handler` per job outside any transaction (for network calls); it must be idempotent. A throw retries the job. */
  process(queue: string, handler: (data: unknown) => Promise<void>): Promise<string>;
  /** Wake `queue` on a cron schedule (pg-boss, minute resolution). */
  schedule(queue: string, cron: string): Promise<void>;
  /** Handle events from `queue`, each in one transaction with the job's completion and a per-consumer dedupe. */
  consume(queue: string, handler: EventHandler): Promise<string>;
  /** Store an external signal once and enqueue it for `inbox.<source>`. Resolve before acknowledging the sender. */
  recordInbound(signal: InboundSignal): Promise<{ id: string; duplicate: boolean }>;
  /** Process `inbox.<source>`: each record once, in one transaction with its effects. */
  consumeInbox(source: string, handler: InboxHandler): Promise<string>;
  getCursor(tx: Tx, name: string): Promise<string | null>;
  setCursor(tx: Tx, name: string, value: string): Promise<void>;
}

export const inboxQueue = (source: string) => `inbox.${source}`;

const DEFAULTS: Required<QueueSettings> = {
  retryLimit: 10,
  retryDelay: 1,
  retryDelayMax: 300,
  expireInSeconds: 300,
  policy: "standard",
};

export function createBackbone(options: BackboneOptions): Backbone {
  const pool = new pg.Pool({ connectionString: options.databaseUrl });
  const boss = new PgBoss({ connectionString: options.databaseUrl });
  const pollingIntervalSeconds = options.pollingIntervalSeconds ?? 2;
  // pg-boss emits 'error' for background failures (maintenance, polling). Without a listener EventEmitter throws.
  boss.on("error", (err) => console.error("[pg-boss]", err));

  const work = (queue: string, handle: (data: unknown, tx: Tx) => Promise<void>) =>
    boss.work(
      queue,
      { transactional: true, batchSize: 1, pollingIntervalSeconds },
      async (jobs: Job<unknown>[], db: BossDb) => {
        const tx = fromBossDb(db);
        for (const job of jobs) await handle(job.data, tx);
      },
    );

  return {
    pool,
    boss,

    async start() {
      await boss.start();
    },

    async stop() {
      await boss.stop({ graceful: true, timeout: 10_000 });
      await pool.end();
    },

    withTransaction: (fn) => withTransaction(pool, fn),

    async withLock(name, fn) {
      const client = await pool.connect();
      try {
        await client.query("SELECT pg_advisory_lock(hashtextextended($1, 1))", [name]);
        try {
          return await fn();
        } finally {
          await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 1))", [name]);
        }
      } finally {
        client.release();
      }
    },

    async ensureQueue(name, settings = {}) {
      const s = { ...DEFAULTS, ...settings };
      const backoff = s.retryDelay > 0;
      const queue = {
        retryLimit: s.retryLimit,
        retryDelay: s.retryDelay,
        retryBackoff: backoff,
        // pg-boss only accepts a backoff cap when backoff is on.
        ...(backoff ? { retryDelayMax: s.retryDelayMax } : {}),
        expireInSeconds: s.expireInSeconds,
        notify: true,
      };
      const existing = await boss.getQueue(name);
      // pg-boss fixes a queue's policy at creation.
      if (existing && existing.policy !== s.policy)
        throw new Error(`queue ${name} exists with policy ${existing.policy}`);
      if (existing) await boss.updateQueue(name, queue);
      else await boss.createQueue(name, { ...queue, policy: s.policy });
    },

    subscribe: (eventType, queue) => boss.subscribe(eventType, queue),

    async publish(tx, drafts) {
      const db = toBossDb(tx);
      const events: DomainEvent[] = [];
      for (const d of drafts) {
        const event: DomainEvent = { ...d, id: randomUUID(), occurredAt: new Date().toISOString() };
        await tx.query(
          `INSERT INTO outbox (id, type, version, occurred_at, aggregate_type, aggregate_id, correlation_id, causation_id, payload)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            event.id,
            event.type,
            event.version,
            event.occurredAt,
            event.aggregate.type,
            event.aggregate.id,
            event.correlationId,
            event.causationId,
            JSON.stringify(event.payload),
          ],
        );
        // The books move with the event (INV-06): its postings commit or roll back together with it.
        for (const posting of postingsFor(event)) {
          await tx.query(
            "INSERT INTO ledger_entries (event_id, event_type, account, asset, amount) VALUES ($1, $2, $3, $4, $5)",
            [event.id, event.type, posting.account, posting.asset, posting.amount.toString()],
          );
        }
        await boss.publish(event.type, event as object, { db });
        events.push(event);
      }
      return events;
    },

    async enqueue(tx, queue, data = {}) {
      await boss.send(queue, data, { db: toBossDb(tx) });
    },

    process: (queue, handler) =>
      boss.work(queue, { batchSize: 1, pollingIntervalSeconds }, async (jobs: Job<unknown>[]) => {
        for (const job of jobs) await handler(job.data);
      }),

    schedule: (queue, cron) => boss.schedule(queue, cron),

    consume: (queue, handler) =>
      work(queue, async (data, tx) => {
        const event = data as DomainEvent;
        const fresh = await tx.query(
          "INSERT INTO consumed_events (consumer, event_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING event_id",
          [queue, event.id],
        );
        if (fresh.rows.length === 0) return; // already applied by this consumer
        await handler(event, tx);
      }),

    async recordInbound(signal) {
      return withTransaction(pool, async (tx) => {
        const inserted = await tx.query<{ id: string }>(
          `INSERT INTO inbox (source, dedupe_key, payload) VALUES ($1, $2, $3)
           ON CONFLICT (source, dedupe_key) DO NOTHING RETURNING id::text`,
          [signal.source, signal.dedupeKey, JSON.stringify(signal.payload)],
        );
        const row = inserted.rows[0];
        if (row) {
          await boss.send(inboxQueue(signal.source), { inboxId: row.id }, { db: toBossDb(tx) });
          return { id: row.id, duplicate: false };
        }
        const existing = await tx.query<{ id: string }>(
          "SELECT id::text FROM inbox WHERE source = $1 AND dedupe_key = $2",
          [signal.source, signal.dedupeKey],
        );
        return { id: existing.rows[0]?.id ?? "", duplicate: true };
      });
    },

    consumeInbox: (source, handler) =>
      work(inboxQueue(source), async (data, tx) => {
        const { inboxId } = data as { inboxId: string };
        const found = await tx.query<{
          id: string;
          source: string;
          dedupe_key: string;
          payload: unknown;
          received_at: Date;
          processed_at: Date | null;
        }>(
          "SELECT id::text, source, dedupe_key, payload, received_at, processed_at FROM inbox WHERE id = $1 FOR UPDATE",
          [inboxId],
        );
        const row = found.rows[0];
        if (!row || row.processed_at) return;
        await handler(
          {
            id: row.id,
            source: row.source,
            dedupeKey: row.dedupe_key,
            payload: row.payload,
            receivedAt: row.received_at.toISOString(),
          },
          tx,
        );
        await tx.query("UPDATE inbox SET processed_at = now() WHERE id = $1", [inboxId]);
      }),

    async getCursor(tx, name) {
      const res = await tx.query<{ value: string }>("SELECT value FROM cursors WHERE name = $1", [name]);
      return res.rows[0]?.value ?? null;
    },

    async setCursor(tx, name, value) {
      await tx.query(
        `INSERT INTO cursors (name, value) VALUES ($1, $2)
         ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [name, value],
      );
    },
  };
}
