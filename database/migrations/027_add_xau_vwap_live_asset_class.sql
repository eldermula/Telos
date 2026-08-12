-- 027_add_xau_vwap_live_asset_class.sql
-- XAUUSD VWAP p90 LIVE (docs/17_XAU_VWAP_Live_Strategy.md).
-- ADD VALUE must be its own migration (same discipline as 025 / 013).
ALTER TYPE asset_class ADD VALUE 'xau_vwap_live';
