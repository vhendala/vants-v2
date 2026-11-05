-- Up Migration

-- Vants Pay v0 (SPEC §5.1, T-010). Integrators authenticate with API keys stored only as hashes.
CREATE TABLE integrators (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE api_keys (
  key_hash text PRIMARY KEY,
  integrator_id text NOT NULL REFERENCES integrators (id),
  prefix text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

-- A priced, validated destination. Amounts as numeric so no value is ever rounded.
CREATE TABLE quotes (
  id text PRIMARY KEY,
  integrator_id text NOT NULL REFERENCES integrators (id),
  destination jsonb NOT NULL,
  asset_name text NOT NULL,
  asset_sac text NOT NULL,
  value_cents integer NOT NULL CHECK (value_cents > 0),
  fee_cents integer NOT NULL CHECK (fee_cents >= 0),
  rate_micros numeric(30, 0) NOT NULL CHECK (rate_micros > 0),
  asset_amount7 numeric(39, 0) NOT NULL CHECK (asset_amount7 > 0),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Muxed ids (DEC-004): one per payment, never reused.
CREATE SEQUENCE payment_mux_seq START 1000;

-- One payment per quote. `state` is the domain Payment (serialized); `version` is the optimistic lock.
CREATE TABLE payments (
  id text PRIMARY KEY,
  integrator_id text NOT NULL REFERENCES integrators (id),
  quote_id text NOT NULL UNIQUE REFERENCES quotes (id),
  mux_id numeric(20, 0) NOT NULL UNIQUE,
  status text NOT NULL,
  version integer NOT NULL,
  state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payment_transitions (
  payment_id text NOT NULL REFERENCES payments (id),
  version integer NOT NULL,
  from_status text,
  to_status text NOT NULL,
  input_type text NOT NULL,
  causation_id text,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (payment_id, version)
);

-- Idempotency-Key: the first response to a (integrator, key) is replayed for the same request.
CREATE TABLE idempotency_keys (
  integrator_id text NOT NULL REFERENCES integrators (id),
  key text NOT NULL,
  request_hash text NOT NULL,
  status integer NOT NULL,
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (integrator_id, key)
);

-- Down Migration

DROP TABLE idempotency_keys;
DROP TABLE payment_transitions;
DROP TABLE payments;
DROP SEQUENCE payment_mux_seq;
DROP TABLE quotes;
DROP TABLE api_keys;
DROP TABLE integrators;
