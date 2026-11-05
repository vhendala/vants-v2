-- Up Migration

-- The books (SPEC §3.7, INV-06, T-015). `publish` writes each event's postings in the event's own transaction, so the
-- entries of any committed event sum to zero per asset. Amounts are in the asset's smallest unit (7 decimals for Stellar
-- assets, 6 for USDH).
CREATE TABLE ledger_entries (
  id bigserial PRIMARY KEY,
  event_id uuid NOT NULL,
  event_type text NOT NULL,
  account text NOT NULL,
  asset text NOT NULL,
  amount numeric(39, 0) NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, account, asset)
);
CREATE INDEX ledger_entries_account ON ledger_entries (account, asset);

-- USDH held back for payouts that are funded but not yet paid (§3.7): available = float balance − open reservations.
CREATE TABLE float_reservations (
  payment_id text PRIMARY KEY REFERENCES payments (id),
  amount6 numeric(39, 0) NOT NULL CHECK (amount6 >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz
);
CREATE INDEX float_reservations_open ON float_reservations (created_at) WHERE released_at IS NULL;

-- Each reconciliation of a ledger account against the outside world. `drift` = the same difference twice in a row.
CREATE TABLE reconciliations (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  scope text NOT NULL, -- treasury | float
  asset text NOT NULL,
  asset_name text NOT NULL,
  ledger numeric(39, 0) NOT NULL,
  actual numeric(39, 0) NOT NULL,
  diff numeric(39, 0) NOT NULL,
  status text NOT NULL -- ok | mismatch | drift
);
CREATE INDEX reconciliations_latest ON reconciliations (scope, asset, at DESC);

-- Down Migration

DROP TABLE reconciliations;
DROP TABLE float_reservations;
DROP TABLE ledger_entries;
