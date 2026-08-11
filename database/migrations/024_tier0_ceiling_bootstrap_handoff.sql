-- 024_tier0_ceiling_bootstrap_handoff.sql
-- Tier 0's Max AI Risk Ceiling 5% -> 30%, matching the revised Section 3a
-- bootstrap curve's $50 anchor so the bootstrap -> standard-matrix handoff
-- stays continuous. Values only; 002's seed rows for tiers 1-7 unchanged.

UPDATE risk_tier_config
SET max_risk_ceiling = 0.30
WHERE tier = 0;
