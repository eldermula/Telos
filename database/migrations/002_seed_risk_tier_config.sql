-- 002_seed_risk_tier_config.sql
-- Tier 0–7 matrix from docs/08_Bot_Architecture.md Section 3

INSERT INTO risk_tier_config (tier, completed_blocks_min, step_size, base_risk, max_risk_ceiling)
VALUES
  (0, 0, 150.00, 0.02, 0.05),
  (1, 1, 150.00, 0.02, 0.10),
  (2, 2, 150.00, 0.03, 0.15),
  (3, 3, 150.00, 0.04, 0.20),
  (4, 4, 300.00, 0.05, 0.25),
  (5, 5, 300.00, 0.06, 0.30),
  (6, 6, 500.00, 0.08, 0.35),
  (7, 7, 500.00, 0.10, 0.40);
