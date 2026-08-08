-- 015_add_bot_instances_synthetic_status.sql
-- Synthetics paper dispatcher — separate synthetic runtime flag so
-- forex `status` / crypto_status / synthetic running state cannot collide.
-- Additive only; default 'stopped'. Does not touch bot-runtime.js.

ALTER TABLE bot_instances
  ADD COLUMN synthetic_status text NOT NULL DEFAULT 'stopped';

ALTER TABLE bot_instances
  ADD CONSTRAINT bot_instances_synthetic_status_check
  CHECK (synthetic_status IN ('stopped', 'running', 'error'));

COMMENT ON COLUMN bot_instances.synthetic_status IS
  'Synthetics paper runtime (Volatility Indices). Independent of forex/crypto status.';
