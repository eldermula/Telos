# 08 — Bot Architecture — Telos — Adaptive Progressive Intelligence Risk System (APIRS)

> Read `MASTER_PROJECT_BLUEPRINT.md` and `03_Software_Requirements_Specification.md` (especially Section 3.5, Trading Bot) first. This document is the authoritative technical spec for the Trading Bot's risk engine.

**Edition:** Hyper-Growth Capital Scaling Model (Max 40% Risk Capacity)
**Purpose:** Grow accounts aggressively only when statistically justified, while protecting accumulated capital through dynamic risk scaling, milestone-based profit locking, and intelligent drawdown control.

---

## 1. Custody & Terminology Note (Non-Negotiable)

**This entire system operates inside the bot/backend, on the user's own linked broker account. At no point does Telos move, hold, or transfer money.**

The original spec for this system used the term "withdrawal" for the profit-locking mechanism in Phase 4. Per the resolution already made in `03_SRS.md` Section 3.5.1, this document uses **`locked_profit_amount`** instead of "withdrawal_amount" throughout. The behavior is identical — reduce the capital the bot is actively risking once a milestone is hit — but the naming avoids any future misreading as an instruction to move funds out of the account. This keeps the system fully compliant with the non-custodial rule (Blueprint Section 5a) with no exception required.

If actual cash withdrawal to the user's bank was ever intended for any part of this system, that remains a user-initiated action through their own broker, outside Telos — not something this engine executes.

## 2. Initial Parameters & Constants

```
initial_balance        = 50.00
active_trading_balance  = 50.00   (renamed from current_balance — see Note above)
peak_equity             = 50.00
active_strategy_mode    = STRATEGY_A
lock_ratio              = 0.70    (renamed from withdrawal_ratio)
growth_ratio            = 0.30
macro_max_drawdown_pct  = 0.45
micro_daily_drawdown_limit = 0.15
emergency_floor_risk    = 0.01
```

## 3. Phase 1 & 2 — Dynamic Milestone Risk Tier Matrix

The engine calculates the current tier by evaluating total completed profit blocks. Step Size is the dollar profit target required to unlock the next tier.

| Tier | Completed Blocks | Step Size | Base Risk | Max AI Risk Ceiling |
|---|---|---|---|---|
| 0 | 0 | $150.00 | 2% | 5% |
| 1 | 1 | $150.00 | 2% | 10% |
| 2 | 2 | $150.00 | 3% | 15% |
| 3 | 3 | $150.00 | 4% | 20% |
| 4 | 4 | $300.00 | 5% | 25% |
| 5 | 5 | $300.00 | 6% | 30% |
| 6 | 6 | $500.00 | 8% | 35% |
| 7 | 7+ | $500.00 | 10% | 40% |

*(Flag: Tier 7's 40% ceiling is a deliberately aggressive setting — confirm this is intended before enabling live trading at that tier.)*

## 4. Phase 3 — Position Sizing Engine

All environmental inputs are normalized decimals between 0.0 (worst) and 1.0 (best):

- `strategy_confidence`
- `live_win_probability`
- `market_quality`
- `trend_quality`
- `drawdown_penalty`
- `volatility_penalty`
- `loss_penalty`

**Rules:**
1. `risk_score = strategy_confidence + live_win_probability + market_quality + trend_quality - drawdown_penalty - volatility_penalty - loss_penalty`
2. `calculated_risk = tier_base_risk * risk_score`
3. Final applied position risk is locked between 1% (0.01) and the active tier's Max AI Risk Ceiling.
4. `final_risk = MAX(0.01, MIN(calculated_risk, tier_max_risk_ceiling))`

**Proposed formulas (pending confirmation)** for the three penalty inputs — each designed to scale smoothly toward 1.0 as conditions approach an existing circuit-breaker threshold, so the Risk Score degrades gracefully rather than being fine right up until a hard breaker fires:

- `drawdown_penalty = MIN((peak_equity - active_trading_balance) / peak_equity / macro_max_drawdown_pct, 1.0)` — reaches 1.0 exactly as the account approaches the Phase 5 macro breaker (45% down from peak).
- `volatility_penalty = MAX(0, MIN(1, (current_ATR / rolling_20_period_avg_ATR) - 1))` — 0 at normal volatility, rising to 1.0 once current volatility is roughly double the recent average.
- `loss_penalty = MIN(consecutive_losses / 3, 1.0)` — 0.33 after one loss, 0.67 after two (right before the Phase 6 two-strike breaker forces 1% risk anyway), 1.0 at three or more.

## 5. Phase 4 — Profit Lock & Capital Reinvestment

Evaluated on trade execution close. Uses a 70% locked / 30% growth split (`lock_ratio` / `growth_ratio`).

**Rules:**
1. `net_profit = active_trading_balance - initial_balance`
2. If `net_profit <= 0`, skip this phase.
3. `completed_blocks = floor(net_profit / current_tier_step_size)`
4. If `completed_blocks == 0`, skip this phase.
5. Otherwise:
   - `milestone_profit = completed_blocks * current_tier_step_size`
   - `locked_profit_amount = milestone_profit * lock_ratio`
   - `retained_growth = milestone_profit * growth_ratio`
6. **Peak Reset Vector** (prevents false circuit-breaker triggers — see Phase 5): reduce both tracked balances by the same locked amount, in sync:
   - `active_trading_balance = active_trading_balance - locked_profit_amount`
   - `peak_equity = peak_equity - locked_profit_amount`

This is an internal accounting/risk-exposure adjustment only. No funds move; the locked portion simply stops being counted as capital available for active risk-taking.

## 6. Phase 5 — Peak Equity Protection (Macro Circuit Breaker)

Tracks historical equity peaks and halts trading before catastrophic failure.

**Rules:**
1. On every closed trade cycle: `peak_equity = MAX(peak_equity, active_trading_balance)`
2. `loss_threshold_floor = peak_equity * (1 - macro_max_drawdown_pct)` — i.e., 45% down from peak
3. If `active_trading_balance <= loss_threshold_floor`:
   - Immediately switch `active_strategy_mode` to `STRATEGY_B_OR_HALT`
   - Kill all active market exposure instantly
   - Issue an emergency user notification (ties to `FR-NOTIF-3`)

**This resolves `FR-BOT-5` / `FR-BOT-7` from the SRS:** "equity decline trend" is defined as a 45% drawdown from peak equity, triggering an immediate strategy switch or halt.

## 7. Phase 6 — Emergency Safety (Micro Circuit Breaker)

Instantly decouples the risk engine from aggressive settings when immediate technical threats appear.

**Rule:** Force final applied position risk to exactly 1% (0.01) for the next trade if **any** of the following are true:
- `market_volatility` is HIGH
- `consecutive_losses >= 2` (the "Two-Strike Rule")
- `daily_drawdown_pct >= 15%` (0.15)
- `strategy_confidence < 80%` (0.80)

This is the short-horizon complement to the macro circuit breaker in Phase 5 — it reacts within a single trading day rather than waiting for a full drawdown from peak.

## 8. Phase 7 — Closed-Loop Self Learning

At the completion of every trade execution cycle, the engine recalculates and feeds updated performance vectors (`strategy_confidence`, `live_win_probability`, `market_quality`, `trend_quality`) back into the Phase 3 scoring for the next trading sequence.

## 9. Multi-Agent Orchestration Architecture

**System type:** Orchestrated Event-Driven Multi-Agent Trading System. This describes how the bot's internal modules communicate to feed APIRS (Sections 3–7 above) with the live inputs it needs.

**Design principle:** APIRS is deterministic and does not guess — it strictly executes the math in Sections 3–7. All prediction/analysis (market structure, news, strategy signals) is handled by separate probabilistic modules that feed data *into* APIRS. APIRS has absolute veto power: no trade executes without its sign-off, regardless of how confident the upstream modules are.

**High-level flow:**
```
Live Broker Feed / API (market data + news ticks)
        ↓
Master Orchestrator
        ↓ (triggers in parallel on every new tick/event)
Market Intelligence  |  News & Sentiment AI  |  Strategy Selection Engine
        ↓ (all three feed outputs back to the Master)
APIRS Risk Engine  ←  Learning Engine feeds in live_win_probability / drawdown_penalty / loss_penalty
  (deterministic gatekeeper — absolute veto power)
        ↓ (only if approved risk size > 0.00)
Execution Engine → places trade via Broker API
```

**Module 1 — Master Orchestrator**
Central router. On every new price tick or news event, triggers Modules 2–4 in parallel, collects their outputs into a single environment dictionary, and passes it to APIRS (Module 5). If APIRS approves a risk size greater than 0.00, routes the trade vector to Module 7 (Execution); otherwise discards the opportunity.

**Module 2 — Market Intelligence Worker**
Evaluates technical structure and trend state. Outputs: `trend_quality` (0.0–1.0), `market_volatility` (LOW/NORMAL/HIGH), `volatility_penalty` (0.0–1.0, based on ATR/spread).

**Module 3 — News & Sentiment Intelligence Worker**
Parses free RSS feeds, economic calendars, and announcements for macroeconomic impact. Outputs: `market_quality` (0.0–1.0), `news_impact_score` (weighted positive/negative).

**Module 4 — Strategy Selection Engine**
Houses the independent technical trading strategies (breakouts, mean reversion, etc. — the actual strategy set is still an open item, see Section 11). Outputs: `trade_direction` (BUY/SELL/WAIT), `strategy_confidence` (0.0–1.0), proposed entry/stop/target prices.

**Module 5 — APIRS Risk Engine**
The deterministic core described in Sections 3–7 of this document. Receives account balance, peak equity, and the combined outputs of Modules 2–4. Runs the tier lookup, risk score equation, macro circuit breaker, and micro circuit breaker in sequence, then outputs `final_applied_position_risk` and a `profit_lock_triggered` flag *(renamed from "withdrawal_triggered" — per the Section 1 custody note, this flag only indicates the Phase 4 profit-lock rule fired internally, not that any funds moved).*

**Module 6 — Learning Engine**
Post-trade review. Logs each trade's outcome against the conditions present when it opened. Feeds `live_win_probability` (rolling 50-trade window) and adjustments to `drawdown_penalty`/`loss_penalty` back into future Module 5 runs.

**Module 7 — Execution Engine**
Translates the approved risk percentage into exact lot/contract sizes based on entry/stop distance, and places the order via the broker's API. Stays blind to market sentiment — only acts on parameters explicitly verified by the Master Orchestrator and APIRS. Logs latency, flagging broker delays over 200ms.

**Why this holds up architecturally:** separating deterministic risk math (APIRS) from probabilistic analysis (Market/News/Strategy modules) is a legitimate, well-established pattern in institutional algorithmic trading — not just a theoretical nicety. It also means a failure in one module (e.g. the news feed going down) is isolated and doesn't take down the whole bot.

**Two things to pin down before this becomes `04_System_Architecture.md`'s bot-level diagram** (tracked in Section 11):
- **Fallback behavior on module failure/timeout** isn't fully defined yet — "lower confidence and let APIRS clamp risk to 1%" is the intent, but needs an explicit rule (e.g. specific default values for `market_quality`/`news_impact_score` when the News AI is unavailable) rather than staying implicit.
- **AI-call latency and cadence** — if Modules 2–4 call an LLM (Claude/OpenAI) synchronously on every tick, a 10–50ms round-trip isn't realistic; LLM inference typically adds hundreds of milliseconds at minimum. Decide whether AI analysis runs per-tick (slower, always fresh) or on a periodic cadence with the latest cached result reused between ticks (faster, still current) — this materially changes the system diagram.

## 10. Core Management Principles

1. Small account size does not justify reckless risk allocation.
2. Large account size does not justify careless exposure.
3. Completed profit blocks increase risk *permission*, not risk *obligation*.
4. High confidence plus strong market metrics allows higher risk — it doesn't require it.
5. Poor confidence or negative market conditions must reduce risk immediately.
6. Protect capital baselines before chasing profit growth.
7. Never increase aggression without statistical validation.
8. Every decision should maximize long-term system survival, not short-term gain.

## 11. Open Items

- **Strategy B** — rules not yet defined (referenced in Phase 5 as `STRATEGY_B_OR_HALT`).
- **Penalty parameter formulas** — exact math for `drawdown_penalty`, `volatility_penalty`, and `loss_penalty` (Phase 3) not yet defined.
- **`FR-BOT-8` (backtesting / paper-trading gate)** — this system defines risk *management* in detail but doesn't yet specify how new tiers/strategies get validated before running on a live linked account. Recommend deciding this before any live deployment.
- **Module failure/timeout fallback values** — needs explicit default values (not just "lower confidence") for when Market Intelligence or News AI is unavailable or times out.
- **AI-call latency/cadence** — decide whether Modules 2–4's AI analysis runs synchronously per-tick or on a periodic cadence with cached results, since this changes the realistic latency budget.
- **Data Payload Structure** — the exact shape of the data passed between the Master Orchestrator and APIRS is not yet defined; needed for `04_System_Architecture.md` and `06_API_Specification.md`.
- **Module 3 data source reliability** — free RSS feeds/economic calendars carry rate-limit and uptime risk; worth a fallback plan even outside the general module-failure case above.

---

*This document supersedes the abbreviated profit-lock description in `03_SRS.md` Section 3.5.1 — that section should point here rather than duplicate the formulas.*