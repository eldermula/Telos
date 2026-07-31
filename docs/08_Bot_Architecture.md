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

### 6.1 Strategy B — Capital Preservation Mode (Proposed, pending confirmation)

- **Flat 1% risk per trade**, regardless of tier — the Tier 0–7 risk ceilings (Section 3) are ignored entirely while in Strategy B.
- **Confidence bar raised**: only takes trades where `strategy_confidence >= 0.90` — the highest-conviction setups only.
- **Tier/milestone progression frozen** — no new tiers unlock while in Strategy B; the bot is defending capital, not growing it.
- **Recovery condition**: returns to Strategy A once `active_trading_balance` recovers to within half the macro drawdown threshold from peak (drawdown back under 22.5% from peak) — a hysteresis band so the bot doesn't flap between A and B right at the 45% boundary.
- **Resolving "`STRATEGY_B_OR_HALT`":** this is a two-stage failsafe, not an either/or. The 45% breaker always switches to Strategy B first — it never jumps straight to a full halt. A full halt (with mandatory manual re-enable) only triggers if Strategy B is *also* breached by a secondary, deeper floor — proposed at 60% down from the original peak. This also serves the "cheapest and reliable" priority: an unnecessary full stop means the bot isn't working at all, so the design defends capital first and only stops completely as a last resort.

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

### 9.1 Module Failure/Timeout Fallback (Proposed, pending confirmation)

- **Module 2 (Market Intelligence) fails/times out:** set `trend_quality = 0.5` (neutral) and force `market_volatility = HIGH` for that cycle.
- **Module 3 (News AI) fails/times out:** set `market_quality = 0.5` (neutral) and `news_impact_score = 0` (neutral), and force `market_volatility = HIGH` for that cycle.
- **General rule:** any single module failure for a given tick forces `market_volatility = HIGH` for that cycle. This deliberately reuses the existing Phase 6 rule rather than inventing new failure-handling logic — it's the cheapest and most reliable option, since it adds no new state or code paths, just triggers the already-defined 1% clamp.

### 9.2 AI-Call Latency & Cadence (Proposed) — designed around "cheapest, fast, reliable"

- **Fast path (every tick, no API cost):** Master Orchestrator, APIRS (Module 5), Execution Engine (Module 7) — pure deterministic math, no external calls. Sub-50ms is realistic here.
- **Slow path (periodic, cached):** Modules 2–4's AI-backed analysis runs on a fixed interval — proposed every 15–30 seconds, or event-triggered (e.g. a new economic calendar release) — rather than on every tick. The latest result is cached and reused by the fast path until the next update. This is both faster *and* cheaper: forex conditions don't meaningfully change tick-to-tick, and a 15–30s cadence cuts LLM API call volume dramatically compared to calling per-tick.
- **Prefer free/rule-based computation wherever it's genuinely sufficient:** Module 2's `trend_quality`/`volatility_penalty` (moving averages, ATR, RSI-style indicators) don't need an LLM at all — plain technical calculation is free and faster. Reserve Claude/OpenAI API calls for what actually needs language understanding: Module 3's unstructured news/RSS parsing, and higher-level confidence reasoning in Module 4. Calling an LLM for every input regardless of whether it needs one is the expensive, slow option — this design avoids that by default.

### 9.3 Module 3 Data Source Reliability (Proposed)

- Maintain 2–3 **free** RSS/economic-calendar sources in priority order (no paid data feeds, per the cost priority) — short timeout (3–5s) on the primary before falling back to the next.
- If all sources fail for a cycle, treat it as a Module 3 failure per Section 9.1 (neutral values + forced HIGH volatility).
- Lightweight health tracker: if News AI fails N consecutive cycles (proposed: 5), mark it "degraded" and skip attempting it for a cooldown period (proposed: 5 minutes) rather than repeatedly timing out and adding latency to every tick — keeps the fast path fast even when a free source is temporarily down.

## 10. Data Payload Structure (Proposed)

The environment dictionary the Master Orchestrator assembles and passes to APIRS:

```json
{
  "timestamp": "ISO-8601",
  "account_state": {
    "active_trading_balance": 0.00,
    "peak_equity": 0.00,
    "active_strategy_mode": "STRATEGY_A"
  },
  "market_intelligence": {
    "trend_quality": 0.0,
    "market_volatility": "LOW | NORMAL | HIGH",
    "volatility_penalty": 0.0
  },
  "news_intelligence": {
    "market_quality": 0.0,
    "news_impact_score": 0.0
  },
  "strategy_signal": {
    "trade_direction": "BUY | SELL | WAIT",
    "strategy_confidence": 0.0,
    "proposed_entry": 0.0,
    "proposed_stop": 0.0,
    "proposed_target": 0.0
  },
  "learning_engine": {
    "live_win_probability": 0.0,
    "drawdown_penalty": 0.0,
    "loss_penalty": 0.0,
    "consecutive_losses": 0,
    "daily_drawdown_pct": 0.0
  }
}
```

APIRS's response back to the Master Orchestrator:

```json
{
  "final_applied_position_risk": 0.0,
  "profit_lock_triggered": false,
  "active_strategy_mode": "STRATEGY_A | STRATEGY_B | HALTED",
  "trade_approved": true
}
```

Field names here are a starting proposal — they'll likely need to match whatever shape the Backend API/Cursor implements, but this establishes the contract.

## 11. Pre-Live Validation Policy (Proposed) — resolves `FR-BOT-8`

- Any **new or materially modified strategy**, or any change to a tier's Base Risk / Max Risk Ceiling, must run in **paper-trading mode** (simulated execution, no real broker orders — zero cost, which fits the cost priority directly) for a minimum sample window, proposed to match the Learning Engine's existing 50-trade rolling window (Section 8).
- **Minimum bar to graduate to live**, proposed as a starting point: positive net P&L over the paper window, and `live_win_probability` above 45%. Both are easy to tune later.
- **Tier progression itself (Sections 3–5) doesn't need re-validation** — it's risk-scaling on an already-validated strategy, not a new strategy. Only new strategies or changed formulas trigger this gate.

## 12. Core Management Principles

1. Small account size does not justify reckless risk allocation.
2. Large account size does not justify careless exposure.
3. Completed profit blocks increase risk *permission*, not risk *obligation*.
4. High confidence plus strong market metrics allows higher risk — it doesn't require it.
5. Poor confidence or negative market conditions must reduce risk immediately.
6. Protect capital baselines before chasing profit growth.
7. Never increase aggression without statistical validation.
8. Every decision should maximize long-term system survival, not short-term gain.

## 13. Open Items

Every gap below now has a proposed resolution elsewhere in this document — pending your confirmation, not yet treated as settled:

- **Strategy B** — defined in Section 6.1. Confirm the flat 1% risk, 0.90 confidence bar, and 60%-from-peak secondary halt floor.
- **Penalty parameter formulas** — defined in Section 4. Confirm the three formulas.
- **`FR-BOT-8` (backtesting / paper-trading gate)** — policy proposed in Section 11. Confirm the 50-trade window and the graduation bar (positive P&L + 45% win probability).
- **Module failure/timeout fallback values** — defined in Section 9.1.
- **AI-call latency/cadence** — resolved in Section 9.2 (fast deterministic path + 15–30s cached AI path).
- **Data Payload Structure** — proposed in Section 10.
- **Module 3 data source reliability** — proposed in Section 9.3.

**Still genuinely open, no proposal yet:**
- The actual content of `STRATEGY_A`'s candidate strategy set (breakouts, mean reversion, or others) — Module 4 references this but the specific strategies themselves haven't been defined.
- Which broker(s)/MT5 connection method — carried over from `03_SRS.md` Section 8, blocks Module 7's exact implementation.

---

*This document supersedes the abbreviated profit-lock description in `03_SRS.md` Section 3.5.1 — that section should point here rather than duplicate the formulas.*