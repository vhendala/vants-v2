-- Up Migration

-- Investing and adding money in the mini app (T-026).

-- One signed action that isn't a Pix payment: investing in a vault, taking money out of one, or opening a trustline so an
-- asset bought by Pix can arrive. Like an exit, submit accepts only this hash, signed.
CREATE TABLE app_actions (
  id text PRIMARY KEY,
  account text NOT NULL,
  kind text NOT NULL, -- invest | redeem | trustline
  detail jsonb NOT NULL,
  tx_hash text NOT NULL UNIQUE,
  tx_xdr text NOT NULL,
  max_time bigint NOT NULL,
  summary jsonb NOT NULL,
  status text NOT NULL DEFAULT 'built', -- built | submitted | done | failed
  submitted_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_actions_account ON app_actions (account, created_at DESC);

-- A person's Etherfuse customer (one per Stellar account). Their documents and CPF go to Etherfuse only; Vants keeps the ids
-- and the name and e-mail it shows back.
CREATE TABLE ramp_customers (
  account text PRIMARY KEY,
  customer_id text NOT NULL,
  bank_account_id text NOT NULL,
  display_name text NOT NULL,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Money added by Pix through Etherfuse: the order, what it buys, and where it stands.
CREATE TABLE ramp_orders (
  id text PRIMARY KEY, -- Etherfuse's order id
  account text NOT NULL,
  target_asset text NOT NULL, -- CODE:ISSUER
  amount_brl numeric(14, 2) NOT NULL,
  amount_asset text NOT NULL, -- as quoted
  fee_brl numeric(14, 2) NOT NULL,
  status text NOT NULL DEFAULT 'created', -- created | funded | completed | failed | refunded | canceled
  pix_code text,
  delivered_tx text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ramp_orders_account ON ramp_orders (account, created_at DESC);

-- Down Migration

DROP TABLE ramp_orders;
DROP TABLE ramp_customers;
DROP TABLE app_actions;
