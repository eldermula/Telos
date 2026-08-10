-- 023_forex_demo_dispatch_config.sql
-- Singleton admin-gated, time-limited forex demo bypasses (parallel to
-- synthetic_demo_dispatch_config final shape). All three until-columns
-- ship together; null or past = disabled for that layer.

CREATE TABLE forex_demo_dispatch_config (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled_until TIMESTAMPTZ NULL,
  confirm_enabled_until TIMESTAMPTZ NULL,
  manual_test_trade_enabled_until TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_admin_user_id UUID REFERENCES users (id) ON DELETE SET NULL
);

COMMENT ON COLUMN forex_demo_dispatch_config.enabled_until IS
  'Layer 3: demo real-dispatch bypass; null/past = off';
COMMENT ON COLUMN forex_demo_dispatch_config.confirm_enabled_until IS
  'Layer 2: demo confirm-live bypass; null/past = off';
COMMENT ON COLUMN forex_demo_dispatch_config.manual_test_trade_enabled_until IS
  'Manual test-dispatch/close gate; null/past = off';

INSERT INTO forex_demo_dispatch_config (
  id,
  enabled_until,
  confirm_enabled_until,
  manual_test_trade_enabled_until
)
VALUES (1, NULL, NULL, NULL);
