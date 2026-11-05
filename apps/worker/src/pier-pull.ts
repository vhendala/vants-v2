// The Pier pull reconciler (SPEC §3.6, DEC-003). Webhooks give latency; this gives completeness: it reads the treasury
// subscription's log from a stored cursor, page by page, and stores every event in the inbox under the envelope id (the
// webhook path's key too). The cursor moves only after a whole page is stored, so a crash re-reads at most one page and
// the inbox absorbs the duplicates (INV-04).
import type { Backbone } from "@vants/db";

export interface PierPullSource {
  page(
    subscriptionId: string,
    after: string | undefined,
    limit: number,
  ): Promise<{ events: Array<{ id: string; position: string }>; next: string }>;
}

export interface PullResult {
  recorded: number;
  duplicates: number;
  cursor: string;
}

export const pierCursorName = (subscriptionId: string) => `pier:${subscriptionId}`;

export async function pullOnce(input: {
  backbone: Pick<Backbone, "recordInbound" | "withTransaction" | "getCursor" | "setCursor">;
  source: PierPullSource;
  subscriptionId: string;
  pageSize?: number;
}): Promise<PullResult> {
  const { backbone, source, subscriptionId } = input;
  const name = pierCursorName(subscriptionId);
  let cursor = (await backbone.withTransaction((tx) => backbone.getCursor(tx, name))) ?? undefined;
  let recorded = 0;
  let duplicates = 0;

  for (;;) {
    const page = await source.page(subscriptionId, cursor, input.pageSize ?? 100);
    if (page.events.length === 0) break;
    for (const event of page.events) {
      const r = await backbone.recordInbound({
        source: "pier",
        dedupeKey: event.id,
        payload: { subscriptionId, event },
      });
      if (r.duplicate) duplicates += 1;
      else recorded += 1;
    }
    const next = page.events.at(-1)?.position ?? page.next;
    await backbone.withTransaction((tx) => backbone.setCursor(tx, name, next));
    cursor = next;
  }
  return { recorded, duplicates, cursor: cursor ?? "0" };
}
