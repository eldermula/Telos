-- 008_add_option2_execution_columns.sql
-- Option 2 (real order placement) — Increment A, schema only, zero
-- behavior change. Nothing in the codebase reads or writes these three
-- columns yet; every existing insert path keeps working unmodified via
-- the defaults below. This exists purely so B–E have somewhere to
-- persist state, per the explicit "smallest, most foundational piece
-- first" sequencing decision (see CHANGELOG.md).

-- trades.execution_mode — distinguishes a locally-simulated paper fill
-- from a real broker-executed order. ENUM, not text: like
-- broker_account_type (007), this is a small, truly fixed set defined
-- by this system's own design, not an admin-configurable list (that's
-- what justified `text` for trades.symbol in 005). Backfilled to
-- 'paper', honestly — every trade this project has ever recorded was a
-- paper-mode simulation; NOT NULL is then safe since both existing
-- insert paths (insertOpenPaperTrade / insertClosedPaperTrade) always
-- write a trade of a known mode.
CREATE TYPE trade_execution_mode AS ENUM ('paper', 'real');

ALTER TABLE trades ADD COLUMN execution_mode trade_execution_mode;
UPDATE trades SET execution_mode = 'paper' WHERE execution_mode IS NULL;
ALTER TABLE trades ALTER COLUMN execution_mode SET NOT NULL;
ALTER TABLE trades ALTER COLUMN execution_mode SET DEFAULT 'paper';

-- trades.broker_ticket — MT5's own order/position ticket number,
-- needed once a trade can correspond to something the broker actually
-- holds (Increment E's monitoring loop asks the connector "is this
-- ticket still open," which requires an identity beyond
-- symbol+direction+entry_price). Nullable, no backfill: no paper trade
-- was ever placed against a real broker, so there is no honest ticket
-- value to invent for existing rows — same reasoning as conditions'
-- nullability in 006. bigint, not int: MT5 ticket numbers are 64-bit.
ALTER TABLE trades ADD COLUMN broker_ticket bigint;

-- Partial unique index, scoped per bot_instance_id rather than global:
-- MT5 assigns ticket numbers per-account, not across all accounts
-- system-wide, so two unrelated users' real accounts could coincidentally
-- share a ticket number — a global UNIQUE would risk rejecting a
-- legitimate second user's trade over a false collision. Scoped to
-- (bot_instance_id, broker_ticket) instead: catches the real risk this
-- is meant to catch (a duplicate/reused ticket colliding with an
-- existing trade's identity during Increment E's close-time
-- reconciliation) without depending on global cross-account uniqueness
-- that MT5 itself doesn't actually guarantee. WHERE-scoped to real,
-- non-null tickets only — paper trades' NULL broker_ticket must stay
-- excluded, since a UNIQUE index would otherwise treat multiple NULLs
-- as fine (NULLs never collide in Postgres) but there's no reason to
-- even consider paper rows here.
CREATE UNIQUE INDEX trades_bot_instance_broker_ticket_unique
  ON trades (bot_instance_id, broker_ticket)
  WHERE execution_mode = 'real' AND broker_ticket IS NOT NULL;

-- bot_instances.live_trading_confirmed_at — Layer 2 of Option 2's
-- gating design (see CHANGELOG.md): a bot instance may only reach
-- real-mode execution if this is set, and it is set only via a
-- dedicated confirmation endpoint (Increment D), never implicitly by
-- Start or by account_type alone. Nullable, defaults NULL (never
-- confirmed) for every existing row — an honest default, since no
-- instance has ever gone through a confirmation flow that doesn't
-- exist yet. Cleared back to NULL on every Stop (Increment D) per the
-- explicit "Stop should not quietly persist live status" decision.
ALTER TABLE bot_instances ADD COLUMN live_trading_confirmed_at timestamptz;
