-- 014_add_bot_instances_crypto_status.sql
-- Crypto Increment E (paper dispatcher) — separate crypto runtime flag so
-- forex `status` and crypto running state cannot collide on rehydrate.
-- Additive only; default 'stopped'. Does not touch bot-runtime.js.

ALTER TABLE bot_instances
  ADD COLUMN crypto_status text NOT NULL DEFAULT 'stopped';

ALTER TABLE bot_instances
  ADD CONSTRAINT bot_instances_crypto_status_check
  CHECK (crypto_status IN ('stopped', 'running', 'error'));

COMMENT ON COLUMN bot_instances.crypto_status IS
  'Crypto paper runtime (Increment E). Independent of forex status.';
