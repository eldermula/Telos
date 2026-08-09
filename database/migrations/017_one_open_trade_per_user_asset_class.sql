-- 017_one_open_trade_per_user_asset_class.sql
-- SUPERSEDED by 018_restore_one_open_trade_per_user.sql.
--
-- This migration incorrectly relaxed the system-wide one_open_trade_per_user
-- index to (user_id, asset_class). That violated docs/11 §0.2 correlation-risk
-- protection (ONE open across the whole account). Kept as a no-op so databases
-- that already recorded "017" in schema_migrations do not re-apply the bad
-- DROP/CREATE, while fresh installs that somehow still run this filename do
-- not destroy the 013 index. Migration 018 restores the correct index wherever
-- the original 017 SQL had already been applied.

SELECT 1;
