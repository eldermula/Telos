-- 018_restore_one_open_trade_per_user.sql
-- Restores the deliberate system-wide one-open constraint after a mistaken
-- Batch 2 migration (017) that scoped uniqueness to (user_id, asset_class).
-- Correlation-risk protection: ONE open trade per user across ALL asset
-- classes (forex_gold / crypto / synthetic) — docs/11 §0.2 / crypto Increment A.
-- Layer 1 kill switch + Layer 2 confirmation remain independently scoped per
-- asset class; only the open-position cardinality is system-wide.

DROP INDEX IF EXISTS one_open_trade_per_user_asset_class;

CREATE UNIQUE INDEX IF NOT EXISTS one_open_trade_per_user
  ON trades (user_id)
  WHERE status = 'open';
