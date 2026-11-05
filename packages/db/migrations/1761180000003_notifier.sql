-- Up Migration

-- Integrator webhooks (SPEC §5.2, T-012). Every payment transition becomes one notification per active endpoint, signed
-- with the endpoint's Standard Webhooks secret. The secret must be readable to sign, so it is stored as given (PoC).
CREATE TABLE webhook_endpoints (
  id text PRIMARY KEY,
  integrator_id text NOT NULL REFERENCES integrators (id),
  url text NOT NULL,
  secret text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz
);
CREATE INDEX webhook_endpoints_integrator ON webhook_endpoints (integrator_id) WHERE disabled_at IS NULL;

-- payment_transitions is the notifier's outbox: a transition is fanned out to notifications once.
ALTER TABLE payment_transitions ADD COLUMN notified_at timestamptz;
UPDATE payment_transitions SET notified_at = now(); -- transitions before this migration had no endpoints to notify
CREATE INDEX payment_transitions_unnotified ON payment_transitions (at) WHERE notified_at IS NULL;

-- One delivery per (endpoint, webhook-id). webhook_id = "<paymentId>:<version>", stable across retries, so receivers dedupe.
CREATE TABLE notifications (
  endpoint_id text NOT NULL REFERENCES webhook_endpoints (id),
  webhook_id text NOT NULL,
  payment_id text NOT NULL REFERENCES payments (id),
  body jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending', -- pending | delivered | failed
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_status integer,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (endpoint_id, webhook_id)
);
CREATE INDEX notifications_due ON notifications (next_attempt_at) WHERE status = 'pending';

-- Down Migration

DROP TABLE notifications;
DROP INDEX payment_transitions_unnotified;
ALTER TABLE payment_transitions DROP COLUMN notified_at;
DROP TABLE webhook_endpoints;
