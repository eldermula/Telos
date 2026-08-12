-- 028_add_xau_vwap_live_dispatch.sql
-- XAUUSD VWAP p90 LIVE Layer 2 confirm + Layer 3 demo config (docs/17).
-- Independent of forex / synthetic / m5 confirm and demo-dispatch state.

ALTER TABLE bot_instances
  ADD COLUMN xau_vwap_live_trading_confirmed_at timestamptz;

COMMENT ON COLUMN bot_instances.xau_vwap_live_trading_confirmed_at IS
  'XAUUSD VWAP p90 live strategy Layer 2 confirm-live timestamp (docs/17). Independent of live_trading_confirmed_at, synthetic_live_trading_confirmed_at, and m5_live_trading_confirmed_at. Cleared when the XAU VWAP live session stops.';

CREATE TABLE xau_vwap_demo_dispatch_config (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled_until TIMESTAMPTZ NULL,
  confirm_enabled_until TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_admin_user_id UUID REFERENCES users (id) ON DELETE SET NULL
);

COMMENT ON COLUMN xau_vwap_demo_dispatch_config.enabled_until IS
  'Layer 3: XAU VWAP demo real-dispatch bypass; null/past = off.';
COMMENT ON COLUMN xau_vwap_demo_dispatch_config.confirm_enabled_until IS
  'Layer 2: XAU VWAP demo confirm-live bypass; null/past = off.';

INSERT INTO xau_vwap_demo_dispatch_config (id, enabled_until, confirm_enabled_until)
VALUES (1, NULL, NULL);
