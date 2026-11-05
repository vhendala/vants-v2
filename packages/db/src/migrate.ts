// Plain SQL migrations with node-pg-migrate (the pattern Pier uses). Applied migrations are never edited.
import { fileURLToPath } from "node:url";
import { runner } from "node-pg-migrate";

const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url));

export async function migrate(databaseUrl: string): Promise<void> {
  await runner({
    databaseUrl,
    dir: MIGRATIONS_DIR,
    direction: "up",
    migrationsTable: "pgmigrations",
    // api and worker may start at once: wait for the lock instead of failing.
    advisoryLockMode: "wait",
    log: () => {},
  });
}
