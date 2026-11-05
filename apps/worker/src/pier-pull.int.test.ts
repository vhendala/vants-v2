// T-008 acceptance: the pull reconciler catches up from its cursor and a crash mid-page loses and duplicates nothing.
import { type Backbone, createBackbone, migrate } from "@vants/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPostgres, type TestPostgres } from "../../../packages/db/test/postgres.ts";
import { type PierPullSource, pullOnce } from "./pier-pull.ts";

let pgc: TestPostgres;
let bb: Backbone;

const envelope = (n: number) => ({
  position: String(1000 + n),
  id: `rpc-evt-${n}`,
  type: "contract",
  ledger: 5_000_000 + n,
  ledgerClosedAt: "2026-10-22T21:43:37.000Z",
  txHash: `tx${n}`,
  transactionIndex: 0,
  operationIndex: 0,
  contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  topic: [],
  value: "",
  decoded: { topic: ["transfer", "GSENDER", "GTREASURY", "native"], value: { amount: "1", to_muxed_id: String(n) } },
});
const ALL = Array.from({ length: 250 }, (_, i) => envelope(i + 1));

/** Pier's pull API over a fixed log, 100 per page. */
const source = (log = ALL): PierPullSource => ({
  async page(_sub, after, limit) {
    const from = log.findIndex((e) => BigInt(e.position) > BigInt(after ?? "0"));
    const events = from === -1 ? [] : log.slice(from, from + limit);
    return { events, next: events.at(-1)?.position ?? after ?? "0" };
  },
});

const inboxCount = async () =>
  Number((await bb.pool.query<{ n: string }>("SELECT count(*) AS n FROM inbox WHERE source = 'pier'")).rows[0]?.n);

beforeAll(async () => {
  pgc = await startPostgres();
  await migrate(pgc.url);
  bb = createBackbone({ databaseUrl: pgc.url });
  await bb.start();
  await bb.ensureQueue("inbox.pier");
}, 120_000);

afterAll(async () => {
  await bb?.stop();
  await pgc?.stop();
});

describe("pullOnce", () => {
  it("survives a crash mid-page: on restart every event lands in the inbox exactly once", async () => {
    let recorded = 0;
    const crashing = {
      ...bb,
      recordInbound: async (s: Parameters<Backbone["recordInbound"]>[0]) => {
        recorded += 1;
        if (recorded === 131) throw new Error("killed after 130 records, before the cursor moved");
        return bb.recordInbound(s);
      },
    };
    await expect(pullOnce({ backbone: crashing, source: source(), subscriptionId: "sub_1" })).rejects.toThrow("killed");
    expect(await inboxCount()).toBe(130);

    const r = await pullOnce({ backbone: bb, source: source(), subscriptionId: "sub_1" });
    expect(await inboxCount()).toBe(250);
    expect(r).toMatchObject({ cursor: "1250" });

    // Running again with nothing new changes nothing.
    const again = await pullOnce({ backbone: bb, source: source(), subscriptionId: "sub_1" });
    expect(again).toMatchObject({ recorded: 0, duplicates: 0, cursor: "1250" });
    expect(await inboxCount()).toBe(250);
  });

  it("stores events under the same dedupe key the webhook path uses (the envelope id)", async () => {
    const row = await bb.pool.query<{ dedupe_key: string; payload: { subscriptionId: string } }>(
      "SELECT dedupe_key, payload FROM inbox WHERE source = 'pier' ORDER BY id LIMIT 1",
    );
    expect(row.rows[0]?.dedupe_key).toBe("rpc-evt-1");
    expect(row.rows[0]?.payload.subscriptionId).toBe("sub_1");
  });

  it("skips an event a webhook already delivered", async () => {
    const extra = envelope(251);
    await bb.recordInbound({ source: "pier", dedupeKey: extra.id, payload: { subscriptionId: "sub_1", event: extra } });
    const r = await pullOnce({ backbone: bb, source: source([...ALL, extra]), subscriptionId: "sub_1" });
    expect(r).toMatchObject({ recorded: 0, duplicates: 1, cursor: "1251" });
  });
});
