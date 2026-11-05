// Postgres for integration tests (*.int.test.ts), started with Testcontainers (the same pattern as Pier's test/postgres.ts).
import { PostgreSqlContainer } from "@testcontainers/postgresql";

export interface TestPostgres {
  url: string;
  stop(): Promise<void>;
}

export async function startPostgres(): Promise<TestPostgres> {
  const container = await new PostgreSqlContainer("postgres:18.6").start();
  return { url: container.getConnectionUri(), stop: async () => void (await container.stop()) };
}
