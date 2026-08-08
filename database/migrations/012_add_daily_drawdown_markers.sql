-- 012_add_daily_drawdown_markers.sql
-- Real dailyDrawdownPct for the micro circuit breaker (08_Bot_Architecture §7).
-- Additive, null-safe boot: first tick / null markers roll over at current
-- equity (daily-drawdown.js). Nothing reads these until bot-runtime wiring.

-- UTC calendar day key for the active boundary (YYYY-MM-DD). date, not
-- timestamptz: the boundary is a calendar day, not an instant.
ALTER TABLE bot_instances ADD COLUMN daily_drawdown_day date;

-- Equity at day open — audit / future start-of-day mode; peak-of-day is
-- the live baseline for dailyDrawdownPct.
ALTER TABLE bot_instances ADD COLUMN daily_start_equity numeric;

-- High-water mark since daily_drawdown_day. Peak Reset Vector (profit-lock)
-- must shrink this alongside lifetime peak_equity so a lock cannot look
-- like a same-day crash.
ALTER TABLE bot_instances ADD COLUMN daily_peak_equity numeric;