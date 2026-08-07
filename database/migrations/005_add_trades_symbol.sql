-- 005_add_trades_symbol.sql
-- 08_Bot_Architecture.md Section 13 / 05_Database_Design.md Section 1.2:
-- the trades table had no instrument column, a schema gap flagged before
-- 6.2 but not actually migrated until now that Module 4 (6.4) makes it a
-- hard blocker — Selection can choose any of 6 watchlist instruments per
-- trade, so which one has to be recorded per row, not assumed.
--
-- Backfill: every trade placed before this migration was opened under
-- the single hardcoded PAPER_TRADING_SYMBOL bot-runtime.js used prior to
-- 6.4 (env default 'EURUSD'). NOT NULL is safe to apply directly because
-- of the backfill, not despite it.

ALTER TABLE trades ADD COLUMN symbol TEXT;

UPDATE trades SET symbol = COALESCE(symbol, 'EURUSD') WHERE symbol IS NULL;

ALTER TABLE trades ALTER COLUMN symbol SET NOT NULL;

CREATE INDEX idx_trades_symbol ON trades (symbol);
