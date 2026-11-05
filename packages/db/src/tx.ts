// One transaction handle for repositories, whether the transaction came from our pool or from a pg-boss worker.
import type pg from "pg";

export interface Tx {
  query<R extends object = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
}

/** What pg-boss accepts as `db` (its `IDatabase`): enqueue inside a transaction we already hold. */
export interface BossDb {
  executeSql(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

export const fromPgClient = (client: pg.PoolClient): Tx => ({
  query: async <R extends object>(text: string, values?: unknown[]) => {
    const res = await client.query(text, values);
    return { rows: res.rows as R[] };
  },
});

export const fromBossDb = (db: BossDb): Tx => ({
  query: async <R extends object>(text: string, values?: unknown[]) => {
    const res = await db.executeSql(text, values);
    return { rows: res.rows as R[] };
  },
});

export const toBossDb = (tx: Tx): BossDb => ({ executeSql: (text, values) => tx.query(text, values) });

/** Runs `fn` in a transaction on its own pooled connection; commits on success, rolls back on any throw. */
export async function withTransaction<T>(pool: pg.Pool, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(fromPgClient(client));
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
