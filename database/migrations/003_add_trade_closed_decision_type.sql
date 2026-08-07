-- Phase 6.1 — position monitoring replaces the paper harness's
-- instant open+close-in-one-tick convention with a real open/monitor/close
-- lifecycle (bot-runtime.js). 'trade_approved' now logs at position-open
-- time (entry/stop/target known, outcome not yet); this new value logs
-- the resolution once price actually crosses stop or target.
ALTER TYPE decision_type ADD VALUE 'trade_closed';
