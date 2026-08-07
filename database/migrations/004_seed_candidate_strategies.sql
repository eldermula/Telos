-- 004_seed_candidate_strategies.sql
-- Seeds Strategy A's starter pool (08_Bot_Architecture.md Section 13 —
-- "Now resolved") directly at status = 'active'. These are hand-written
-- (source = 'manual'), so per Section 11 Decision 2 they still notionally
-- owe a paper-trading window before going live in a stricter reading —
-- but Section 13 explicitly confirms these three seed as the launch pool
-- Selection (Module 4) draws from immediately, not `proposed`. Anything
-- the Discovery process (Section 9.4) adds later starts at `proposed`
-- and must earn its way to `active` through the normal gate; these three
-- are the one deliberate exception, matching Section 13's own wording.
--
-- rule_set shape (confirmed this revision, 08_Bot_Architecture.md
-- Section 9 Module 4):
--   regime_fit   — cheap pre-check against Module 2/3 output; a strategy
--                  that doesn't fit isn't evaluated for a signal at all.
--   signal       — the actual entry-trigger, computed from price bars.
--   stop/target  — both ATR-multiple based, off Module 2's shared ATR.
--   base_confidence — combined with regime_fit's margin at evaluation
--                  time (Module 4), not stored pre-computed here.

INSERT INTO candidate_strategies (name, rule_set, description, source, status, activated_at)
VALUES
  (
    'MA Crossover',
    '{
      "regime_fit": { "trend_quality_min": 0.6 },
      "signal": { "type": "ema_cross", "fast_period": 12, "slow_period": 26 },
      "stop": { "type": "atr_multiple", "multiple": 1.5 },
      "target": { "type": "reward_risk_ratio", "ratio": 2 },
      "base_confidence": 0.70
    }'::jsonb,
    'Trend-following: fast EMA crosses above/below a slow EMA signals BUY/SELL. Favored when trend_quality is high (strongly trending market).',
    'manual',
    'active',
    now()
  ),
  (
    'Breakout',
    '{
      "regime_fit": { "market_volatility_in": ["HIGH"] },
      "signal": { "type": "breakout", "lookback_bars": 20 },
      "stop": { "type": "atr_multiple", "multiple": 1.5 },
      "target": { "type": "reward_risk_ratio", "ratio": 2 },
      "base_confidence": 0.70
    }'::jsonb,
    'Price breaks above a recent high / below a recent low with momentum confirmation. Favored in high-volatility, directional conditions.',
    'manual',
    'active',
    now()
  ),
  (
    'RSI Mean Reversion',
    '{
      "regime_fit": { "trend_quality_max": 0.4 },
      "signal": { "type": "rsi_reversion", "period": 14, "oversold": 30, "overbought": 70 },
      "stop": { "type": "atr_multiple", "multiple": 1.5 },
      "target": { "type": "reward_risk_ratio", "ratio": 2 },
      "base_confidence": 0.70
    }'::jsonb,
    'Oversold/overbought RSI levels trigger counter-trend entries. Favored when trend_quality is low (ranging market).',
    'manual',
    'active',
    now()
  );
