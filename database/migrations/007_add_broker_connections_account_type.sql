-- 007_add_broker_connections_account_type.sql
-- 08_Bot_Architecture.md Section 13 / 09_Security.md Section 11 —
-- "no demo/live account distinction anywhere in broker_connections."
-- Flagged during 6.5's scoping discussion as a real, currently-existing
-- gap: every real-order code path this system will ever have (Module 7
-- Execution, mt5Connector.placeOrder/closeOrder, the Python connector's
-- /order/place) runs identically regardless of whether the linked MT5
-- account is MetaQuotes-Demo or a real funded account. Fixed here as its
-- own small increment, before Option 2 (real order placement), per the
-- explicit "must be resolved before or alongside Option 2, not
-- discovered partway through it" decision on record.
--
-- ENUM, not text: MT5's own account_info().trade_mode is a small, truly
-- fixed set defined by MT5 itself (demo/contest/real), not an
-- admin-configurable list like the watchlist that justified `text` for
-- trades.symbol — matches the existing connection_status/trade_direction
-- precedent instead.
--
-- Backfill to 'demo', not left NULL: every broker_connections row ever
-- created in this project was linked against MetaQuotes-Demo (the only
-- account this project has ever tested against, per every prior
-- CHANGELOG verification note) — an honest backfill, same justification
-- as trades.symbol's backfill to 'EURUSD' in 005. NOT NULL is then safe:
-- validate()'s success path always returns account_info(), which always
-- has a trade_mode, so every future create/update always has a real
-- value to write, never a placeholder.

CREATE TYPE broker_account_type AS ENUM ('demo', 'contest', 'real');

ALTER TABLE broker_connections ADD COLUMN account_type broker_account_type;

UPDATE broker_connections SET account_type = 'demo' WHERE account_type IS NULL;

ALTER TABLE broker_connections ALTER COLUMN account_type SET NOT NULL;
