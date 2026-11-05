-- Up Migration

-- Payment and refund sagas (SPEC §3.4, T-011). These tables are the sagas' work lists: pg-boss jobs only wake the pumps,
-- which read what to do from here, so a lost job loses nothing (INV-03).

-- Every transfer into the treasury that Pier reported, matched or not. `kind` is the domain's DepositKind, or
-- `unattributed` (a muxed id no payment has) or `unmarked` (no muxed id at all: top-ups, never refunded, §11 Q6).
CREATE TABLE deposits (
  id text PRIMARY KEY, -- Pier event id
  payment_id text REFERENCES payments (id),
  mux_id numeric(20, 0),
  asset_sac text NOT NULL,
  asset_name text NOT NULL,
  amount7 numeric(39, 0) NOT NULL,
  from_account text NOT NULL,
  tx_hash text NOT NULL,
  ledger_closed_at timestamptz NOT NULL,
  kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deposits_payment ON deposits (payment_id);

-- One payout per payment (INV-02): Hodle deduplicates on external_id, so every retry reuses it.
-- status: requested → sent (Hodle called at least once) → completed | failed | cancelled (payment left `funded` first).
CREATE TABLE payouts (
  payment_id text PRIMARY KEY REFERENCES payments (id),
  external_id text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'requested',
  attempts integer NOT NULL DEFAULT 0,
  transaction_id text,
  response jsonb,
  last_error text,
  confirmed_at timestamptz, -- Hodle's PAYOUT_SUCCESSFUL webhook (§3.6)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- What the treasury owes back (INV-10). The envelope is committed before it is submitted, and resubmitted unchanged until
-- its deadline has passed (DEC-023). status: requested → submitted → sent | failed (landed but failed: manual review).
CREATE TABLE refunds (
  id text PRIMARY KEY, -- "<payment>:rf<n>" (domain refund id) or "dep:<deposit id>" (unattributed)
  payment_id text REFERENCES payments (id),
  deposit_id text REFERENCES deposits (id),
  mux_id numeric(20, 0) NOT NULL,
  memo text NOT NULL UNIQUE,
  asset_name text NOT NULL,
  amount7 numeric(39, 0) NOT NULL CHECK (amount7 > 0),
  to_account text NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'requested',
  envelope_xdr text,
  tx_hash text,
  max_time bigint,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refunds_open ON refunds (created_at) WHERE status IN ('requested', 'submitted');

-- Down Migration

DROP TABLE refunds;
DROP TABLE payouts;
DROP TABLE deposits;
