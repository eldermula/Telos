-- 016_add_bot_instances_synthetic_real_ledger.sql
-- Synthetics real-dispatch Batch 1 — independent balance / tier /
-- Layer 2 confirmation columns on the same bot_instances row.
-- Additive only. Defaults match APIRS INITIAL_BALANCE (10.0) / tier 0.
-- Does not change forex live_trading_confirmed_at or paper ledgers.
-- No order-placement behavior in this migration.

ALTER TABLE bot_instances
  ADD COLUMN synthetic_initial_balance numeric NOT NULL DEFAULT 10.0;

ALTER TABLE bot_instances
  ADD COLUMN synthetic_active_trading_balance numeric NOT NULL DEFAULT 10.0;

ALTER TABLE bot_instances
  ADD COLUMN synthetic_peak_equity numeric NOT NULL DEFAULT 10.0;

ALTER TABLE bot_instances
  ADD COLUMN synthetic_current_tier integer NOT NULL DEFAULT 0;

ALTER TABLE bot_instances
  ADD COLUMN synthetic_live_trading_confirmed_at timestamptz;

COMMENT ON COLUMN bot_instances.synthetic_initial_balance IS
  'Synthetics pathway seed balance (independent of forex initial_balance).';
COMMENT ON COLUMN bot_instances.synthetic_active_trading_balance IS
  'Synthetics pathway active ledger (independent of forex active_trading_balance).';
COMMENT ON COLUMN bot_instances.synthetic_peak_equity IS
  'Synthetics pathway peak equity (independent of forex peak_equity).';
COMMENT ON COLUMN bot_instances.synthetic_current_tier IS
  'Synthetics pathway risk tier (independent of forex current_tier).';
COMMENT ON COLUMN bot_instances.synthetic_live_trading_confirmed_at IS
  'Synthetics Layer 2 confirm-live timestamp; cleared on synthetic Stop. Not shared with forex live_trading_confirmed_at.';
