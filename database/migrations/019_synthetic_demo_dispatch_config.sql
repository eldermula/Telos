-- 019_synthetic_demo_dispatch_config.sql
-- Singleton admin-gated, time-limited synthetics Layer-3 demo-dispatch
-- bypass (replaces env SYNTHETIC_REAL_TRADING_ALLOW_DEMO).
-- Null or past enabled_until = disabled.

CREATE TABLE synthetic_demo_dispatch_config (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled_until TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_admin_user_id UUID REFERENCES users (id) ON DELETE SET NULL
);

INSERT INTO synthetic_demo_dispatch_config (id, enabled_until)
VALUES (1, NULL);
