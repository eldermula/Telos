-- 021_synthetic_manual_test_trade_enabled_until.sql
-- Manual test-dispatch/close gate (replaces env SYNTHETIC_ALLOW_MANUAL_TEST_TRADE).
-- Same singleton as Layer-2 confirm / Layer-3 dispatch; null or past = disabled.

ALTER TABLE synthetic_demo_dispatch_config
  ADD COLUMN manual_test_trade_enabled_until TIMESTAMPTZ NULL;

COMMENT ON COLUMN synthetic_demo_dispatch_config.manual_test_trade_enabled_until IS
  'Manual test-dispatch/close gate; null/past = off';
