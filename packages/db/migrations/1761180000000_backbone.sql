-- Up Migration

-- Event backbone (SPEC §3.3). Domain tables arrive in later migrations with the tasks that design them (DEC-017).

-- Every external signal (Pier, Hodle, wallet submits) is stored once, before any handler runs (INV-04).
CREATE TABLE inbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source text NOT NULL,
  dedupe_key text NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (source, dedupe_key)
);

-- Append-only log of every domain event published (envelope v0), written in the same transaction as the state change.
CREATE TABLE outbox (
  id uuid PRIMARY KEY,
  type text NOT NULL,
  version integer NOT NULL,
  occurred_at timestamptz NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  correlation_id text NOT NULL,
  causation_id text,
  payload jsonb NOT NULL
);
CREATE INDEX outbox_aggregate ON outbox (aggregate_type, aggregate_id, occurred_at);
CREATE INDEX outbox_correlation ON outbox (correlation_id, occurred_at);

-- Which consumer has applied which event: pg-boss delivers at least once, effects happen once.
CREATE TABLE consumed_events (
  consumer text NOT NULL,
  event_id uuid NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);

-- Named read positions, e.g. the Pier pull reconciler's cursor.
CREATE TABLE cursors (
  name text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Down Migration

DROP TABLE cursors;
DROP TABLE consumed_events;
DROP TABLE outbox;
DROP TABLE inbox;
