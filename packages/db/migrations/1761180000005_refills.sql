-- Up Migration

-- The float refill saga (SPEC §3.7, T-016): CCTP burn on Stellar → attestation → mint on Base → sandbox USDH credit. One row per
-- refill, advanced phase by phase; every external effect is recorded before it is made (envelopes) or made idempotent (the
-- CCTP nonce, the Hodle trackId), so a crash at any point resumes without moving money twice.
-- status: approving → burning → attesting → minting → crediting → completed | failed
CREATE TABLE refills (
  id text PRIMARY KEY,
  status text NOT NULL,
  amount6 numeric(39, 0) NOT NULL CHECK (amount6 > 0), -- USDC to bridge, CCTP units (6 decimals)
  max_fee6 numeric(39, 0) NOT NULL DEFAULT 0,
  approve_xdr text,
  approve_hash text,
  approve_max_time bigint,
  burn_xdr text,
  burn_hash text,
  burn_max_time bigint,
  message text,
  attestation text,
  fee_executed6 numeric(39, 0),
  mint_hash text,
  minted6 numeric(39, 0),
  credit_cents integer,
  credit6 numeric(39, 0),
  track_id text,
  settled boolean NOT NULL DEFAULT false,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
-- At most one refill in flight: the treasury's USDC and the float are moved by one saga at a time.
CREATE UNIQUE INDEX refills_one_active ON refills ((true)) WHERE status NOT IN ('completed', 'failed');

-- Down Migration

DROP TABLE refills;
