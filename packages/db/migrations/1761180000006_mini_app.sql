-- Up Migration

-- The mini app (SPEC §3.5, §5.3, T-020).

-- SEP-10: "the Server should not provide more than one JWT for a specific challenge transaction".
CREATE TABLE auth_challenges (
  hash text PRIMARY KEY,
  account text NOT NULL,
  used_at timestamptz NOT NULL DEFAULT now()
);

-- One exit per mini-app payment: its single planned transaction (DEC-031). Submit accepts only that hash, signed.
CREATE TABLE exits (
  id text PRIMARY KEY,
  account text NOT NULL,
  payment_id text NOT NULL UNIQUE REFERENCES payments (id),
  route text NOT NULL, -- classic | router
  picks jsonb NOT NULL,
  tx_hash text NOT NULL UNIQUE,
  tx_xdr text NOT NULL,
  max_time bigint NOT NULL,
  summary jsonb NOT NULL,
  status text NOT NULL DEFAULT 'built', -- built | submitted
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX exits_account ON exits (account, created_at DESC);

-- Mini-app payments run through the rail like any integrator's, under this built-in one (it has no API key).
INSERT INTO integrators (id, name) VALUES ('int_vants_mini_app', 'Vants mini app') ON CONFLICT (id) DO NOTHING;

-- Down Migration

DROP TABLE exits;
DROP TABLE auth_challenges;
DELETE FROM integrators WHERE id = 'int_vants_mini_app';
