-- Soft-halt: block new opens while keeping the tick loop (and open-position
-- monitoring) alive. Distinct from status=stopped (full Stop) and from the
-- in-memory _halted error path. Per-asset-class columns match crypto/synthetic
-- status separation.

ALTER TABLE bot_instances
  ADD COLUMN halt_new_opens BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE bot_instances
  ADD COLUMN synthetic_halt_new_opens BOOLEAN NOT NULL DEFAULT FALSE;
