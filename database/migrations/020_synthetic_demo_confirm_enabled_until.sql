-- 020_synthetic_demo_confirm_enabled_until.sql
-- Layer-2 confirm-live demo bypass (replaces env SYNTHETIC_ALLOW_DEMO_CONFIRM).
-- Same singleton as Layer-3 dispatch; null or past = disabled.

ALTER TABLE synthetic_demo_dispatch_config
  ADD COLUMN confirm_enabled_until TIMESTAMPTZ NULL;

COMMENT ON COLUMN synthetic_demo_dispatch_config.enabled_until IS
  'Layer 3: demo real-dispatch bypass; null/past = off';
COMMENT ON COLUMN synthetic_demo_dispatch_config.confirm_enabled_until IS
  'Layer 2: demo confirm-live bypass; null/past = off';
