-- 013_add_crypto_asset_class_foundation.sql
-- Crypto Increment A (docs/11_Crypto_Synthetics_Scoping.md §0.2 / §6) —
-- schema only, zero application-behavior change. Same discipline as
-- Option 2 Increment A (008): additive columns + constraints so later
-- isolated crypto pieces (news / vol thresholds / Module 7 specs) and
-- eventually crypto-bot-runtime.js have a solid shared substrate.
-- Does NOT touch bot-runtime.js, trades.repository.js, or the broker
-- connections service — app still rejects a second connection (409).

-- ---------------------------------------------------------------------------
-- 1. asset_class enum (forex_gold | crypto | synthetic)
-- synthetic included now per §0.2 even though synthetics are deferred —
-- avoids a later enum migration when/if that scope reopens.
-- ---------------------------------------------------------------------------
CREATE TYPE asset_class AS ENUM ('forex_gold', 'crypto', 'synthetic');

ALTER TABLE trades ADD COLUMN asset_class asset_class;
UPDATE trades SET asset_class = 'forex_gold' WHERE asset_class IS NULL;
ALTER TABLE trades ALTER COLUMN asset_class SET NOT NULL;
ALTER TABLE trades ALTER COLUMN asset_class SET DEFAULT 'forex_gold';

ALTER TABLE bot_decision_log ADD COLUMN asset_class asset_class;
UPDATE bot_decision_log SET asset_class = 'forex_gold' WHERE asset_class IS NULL;
ALTER TABLE bot_decision_log ALTER COLUMN asset_class SET NOT NULL;
ALTER TABLE bot_decision_log ALTER COLUMN asset_class SET DEFAULT 'forex_gold';

-- ---------------------------------------------------------------------------
-- 2. trades.user_id — required for the system-wide one-open-position index
-- (§0.2). Column did not exist; only bot_instance_id did. Backfill from
-- bot_instances, then keep future inserts working via trigger so existing
-- insertOpen* paths need no app change.
-- ---------------------------------------------------------------------------
ALTER TABLE trades ADD COLUMN user_id UUID REFERENCES users (id);

UPDATE trades t
SET user_id = bi.user_id
FROM bot_instances bi
WHERE bi.id = t.bot_instance_id
  AND t.user_id IS NULL;

-- Fail loud if any orphan row somehow lacked a bot_instance (should be
-- impossible under the FK); NOT NULL would otherwise succeed with NULLs.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM trades WHERE user_id IS NULL) THEN
    RAISE EXCEPTION '013: trades.user_id backfill left NULL rows';
  END IF;
END $$;

ALTER TABLE trades ALTER COLUMN user_id SET NOT NULL;

CREATE INDEX trades_user_id_idx ON trades (user_id);

CREATE OR REPLACE FUNCTION trades_set_user_id_from_bot_instance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.user_id IS NULL THEN
    SELECT bi.user_id INTO NEW.user_id
    FROM bot_instances bi
    WHERE bi.id = NEW.bot_instance_id;

    IF NEW.user_id IS NULL THEN
      RAISE EXCEPTION
        'trades.user_id: bot_instance % not found or has no user_id',
        NEW.bot_instance_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trades_set_user_id_bi
  BEFORE INSERT ON trades
  FOR EACH ROW
  EXECUTE FUNCTION trades_set_user_id_from_bot_instance();

-- ---------------------------------------------------------------------------
-- 3. System-wide one open trade per user (DB-enforced, not just app-level).
-- Preserves 08 §13 / 11 §0.2: stacked exposure against one balance, across
-- asset classes. Preflight confirmed no user currently has >1 open row.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX one_open_trade_per_user
  ON trades (user_id)
  WHERE status = 'open';

-- ---------------------------------------------------------------------------
-- 4. broker_connections.broker_id + UNIQUE(user_id, broker_id)
-- There was never a DB UNIQUE(user_id) — cardinality was app-only (409).
-- This adds the decided composite uniqueness. broker_id is a controlled
-- slug, distinct from free-text broker_name. Trigger derives broker_id
-- from lower(trim(broker_name)) when omitted so createConnection keeps
-- working with zero app code changes in this increment.
-- ---------------------------------------------------------------------------
ALTER TABLE broker_connections ADD COLUMN broker_id TEXT;

UPDATE broker_connections
SET broker_id = lower(trim(broker_name))
WHERE broker_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM broker_connections
    WHERE broker_id IS NULL OR length(trim(broker_id)) = 0
  ) THEN
    RAISE EXCEPTION '013: broker_connections.broker_id backfill left empty rows';
  END IF;
END $$;

ALTER TABLE broker_connections ALTER COLUMN broker_id SET NOT NULL;

CREATE OR REPLACE FUNCTION broker_connections_set_broker_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.broker_id IS NULL OR length(trim(NEW.broker_id)) = 0 THEN
    NEW.broker_id := lower(trim(NEW.broker_name));
  END IF;
  IF NEW.broker_id IS NULL OR length(trim(NEW.broker_id)) = 0 THEN
    RAISE EXCEPTION 'broker_connections.broker_id could not be derived from broker_name';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER broker_connections_set_broker_id_bi
  BEFORE INSERT ON broker_connections
  FOR EACH ROW
  EXECUTE FUNCTION broker_connections_set_broker_id();

CREATE UNIQUE INDEX broker_connections_user_broker_unique
  ON broker_connections (user_id, broker_id);