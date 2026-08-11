-- 026_add_m5_real_dispatch.sql
-- M5 PAPER-ONLY EXPERIMENT real-dispatch, Batch 1 (docs/14_M5_Forex_Paper_Experiment.md).
-- Additive only. Mirrors migration 016's synthetics-real-ledger pattern:
-- an independent Layer 2 confirm-live column on the SAME bot_instances row
-- already used by forex/crypto/synthetics -- an admin testing M5 real
-- dispatch must already have a linked broker connection, same as any other
-- asset class (ensureForUser). Does NOT touch forex live_trading_confirmed_at
-- or synthetic_live_trading_confirmed_at.
--
-- Unlike synthetics (016), there are no m5_active_trading_balance /
-- m5_peak_equity / m5_current_tier ledger columns here: M5 real-dispatch
-- deliberately reuses the SAME stateless bootstrap-risk math already proven
-- in the M5 paper build (m5-paper-strategy.js's computeAppliedRisk, computed
-- fresh from LIVE equity every tick), not the full APIRS tier-progression
-- engine -- so there is no persisted ledger to add.
ALTER TABLE bot_instances
  ADD COLUMN m5_live_trading_confirmed_at timestamptz;

COMMENT ON COLUMN bot_instances.m5_live_trading_confirmed_at IS
  'M5 paper-only-experiment Layer 2 confirm-live timestamp (docs/14_M5_Forex_Paper_Experiment.md). Independent of live_trading_confirmed_at (forex) and synthetic_live_trading_confirmed_at. Cleared when the M5 real session stops.';

-- Layer 3 (demo real-dispatch bypass) + Layer 2b (demo confirm-live bypass),
-- singleton row, same shape as forex_demo_dispatch_config (023) /
-- synthetic_demo_dispatch_config (019), minus manual_test_trade_enabled_until:
-- M5 real-dispatch has no separate manual-test-trade concept -- the whole
-- admin-started harness session already IS the manual test.
CREATE TABLE m5_demo_dispatch_config (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled_until TIMESTAMPTZ NULL,
  confirm_enabled_until TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_admin_user_id UUID REFERENCES users (id) ON DELETE SET NULL
);

COMMENT ON COLUMN m5_demo_dispatch_config.enabled_until IS
  'Layer 3: M5 demo real-dispatch bypass; null/past = off. Independent of forex_demo_dispatch_config / synthetic_demo_dispatch_config.';
COMMENT ON COLUMN m5_demo_dispatch_config.confirm_enabled_until IS
  'Layer 2: M5 demo confirm-live bypass; null/past = off.';

INSERT INTO m5_demo_dispatch_config (id, enabled_until, confirm_enabled_until)
VALUES (1, NULL, NULL);
