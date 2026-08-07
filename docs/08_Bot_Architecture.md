# 08 — Bot Architecture — Telos — Adaptive Progressive Intelligence Risk System (APIRS)

> Read `MASTER_PROJECT_BLUEPRINT.md` and `03_Software_Requirements_Specification.md` (especially Section 3.5, Trading Bot) first. This document is the authoritative technical spec for the Trading Bot's risk engine.

**Edition:** Hyper-Growth Capital Scaling Model (Max 40% Risk Capacity above $50; see Section 3a for the sub-$50 bootstrap phase, which runs hotter)
**Purpose:** Grow accounts aggressively only when statistically justified, while protecting accumulated capital through dynamic risk scaling, milestone-based profit locking, and intelligent drawdown control.

---

## 1. Custody & Terminology Note (Non-Negotiable)

**This entire system operates inside the bot/backend, on the user's own linked broker account. At no point does Telos move, hold, or transfer money.**

The original spec for this system used the term "withdrawal" for the profit-locking mechanism in Phase 4. Per the resolution already made in `03_SRS.md` Section 3.5.1, this document uses **`locked_profit_amount`** instead of "withdrawal_amount" throughout. The behavior is identical — reduce the capital the bot is actively risking once a milestone is hit — but the naming avoids any future misreading as an instruction to move funds out of the account. This keeps the system fully compliant with the non-custodial rule (Blueprint Section 5a) with no exception required.

If actual cash withdrawal to the user's bank was ever intended for any part of this system, that remains a user-initiated action through their own broker, outside Telos — not something this engine executes.

## 2. Initial Parameters & Constants

```
initial_balance        = 10.00
active_trading_balance  = 10.00   (renamed from current_balance — see Note above)
peak_equity             = 10.00
active_strategy_mode    = STRATEGY_A
lock_ratio              = 0.70    (renamed from withdrawal_ratio)
growth_ratio            = 0.30
macro_max_drawdown_pct  = 0.45
micro_daily_drawdown_limit = 0.15
emergency_floor_risk    = 0.01
```

**Settled — starting balance revised from $50 to $10 (this revision).** This changes which risk regime a new account starts in: at $10, the account starts inside the **sub-$50 bootstrap phase** (Section 3a below), not directly in Tier 0 of the standard matrix (Section 3). The standard Tier 0–7 matrix and its dollar step sizes are otherwise **unchanged** — they still apply exactly as originally specified once `active_trading_balance` crosses $50.

## 3. Phase 1 & 2 — Dynamic Milestone Risk Tier Matrix (Applies once `active_trading_balance` ≥ $50)

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

**Unchanged by this revision, per explicit instruction:** every dollar amount in this table (step sizes) and every percentage in this table (Base Risk / Max AI Risk Ceiling) stays exactly as originally specified for any balance at or above $50. This table only governs the account once it has grown past the bootstrap phase in Section 3a — it does not itself change shape based on how the account got there.

## 3a. Sub-$50 Micro-Balance Bootstrap Risk Scaling (Proposed — pending confirmation, this revision)

**Why this exists:** the standard Tier 0–7 matrix (Section 3) was designed around dollar-amount step sizes ($150–$500) that only make sense relative to a starting balance in the same order of magnitude. At a $10 starting balance, those step sizes are 15–50x the account itself — the tier system would never realistically progress under the standard percentages (2–5% base/ceiling at Tier 0). This section defines a **separate, temporary risk regime** that applies only while `active_trading_balance < $50`, so the account has a defined (if aggressive) way to reach the point where the standard matrix in Section 3 becomes meaningful.

**Rule — inverse linear scaling between two anchor points:**
- At `active_trading_balance = $50`: risk = **5%** (matches Tier 0's Max AI Risk Ceiling exactly, so there's no discontinuity at the $50 handoff point).
- At `active_trading_balance = $10`: risk = **70%**, per explicit instruction.
- For any balance strictly between $10 and $50, risk scales linearly between those two points:

```
bootstrap_risk_pct(balance) = 0.05 + ((50 - balance) / 40) * 0.65
```

- For `active_trading_balance ≤ $10` (e.g. after an early loss shrinks the account further): risk is **capped flat at 70%** — the formula is not extrapolated below $10, since doing so would approach or exceed 100% risk per trade, which is not a valid position size.
- Once `active_trading_balance ≥ $50`, the account exits this section entirely and is governed by Section 3's Tier 0–7 matrix from that point forward, unchanged.

**Worked reference table:**

| Balance | Bootstrap Risk % |
|---|---|
| $50.00 | 5.00% |
| $40.00 | 21.25% |
| $30.00 | 37.50% |
| $20.00 | 53.75% |
| $10.00 | 70.00% |
| ≤ $10.00 | 70.00% (flat cap) |

**Flagged explicitly, not smoothed over:** this regime is dramatically more aggressive than anything else in this document, including the already-flagged Tier 7 ceiling. At the $10–$20 end of this scale, a single stop-loss hit consumes more than half the account; two consecutive losing trades in that range can reduce the account to a few dollars or less. This section does **not** currently interact with the Phase 5 macro circuit breaker (Section 6) or Phase 6 micro circuit breaker (Section 7) — both of those were designed around the standard matrix's risk levels, and whether they should override or coexist with this bootstrap phase is an open item (see Section 13). Until that's resolved, treat this section as high-risk-by-design and pending your explicit sign-off before any live (non-paper) use.

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
2. `calculated_risk = tier_base_risk * risk_score` — where `tier_base_risk` is the Section 3 table's Base Risk once `active_trading_balance ≥ $50`, or the Section 3a `bootstrap_risk_pct(balance)` value while below $50.
3. Final applied position risk is locked between 1% (0.01) and the applicable ceiling — the active tier's Max AI Risk Ceiling (Section 3) once ≥ $50, or the Section 3a bootstrap value while below $50.
4. `final_risk = MAX(0.01, MIN(calculated_risk, applicable_risk_ceiling))`

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

**Settled — Section 3a interaction:** profit-lock does **not** apply while `active_trading_balance < $50`. `current_tier_step_size` stays undefined for the entire bootstrap phase by design — this phase is intentionally light on rules (Section 3a, Section 13) so the account has room to grow unencumbered. Profit-lock begins the moment the account crosses into the standard Tier 0–7 matrix at $50, exactly as originally specified, with no bootstrap-specific variant needed.

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

**Settled — Section 3a interaction:** confirmed intended. At bootstrap-phase risk levels (up to 70%), a single losing trade can exceed this 45% macro-drawdown threshold outright, meaning the macro breaker can fire after just one trade rather than acting as a longer-horizon safeguard. This is accepted as the tradeoff for allowing 70% risk at very small balances — see Section 13.

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

**Settled — Section 3a-specific rule (this revision):** the standard two-strike rule above still applies throughout the bootstrap phase unchanged. In addition, a **single-loss override** applies specifically at the bootstrap phase's risk ceiling: if a trade taken at or near the 70% flat-cap risk level (i.e. `active_trading_balance ≤ $10`, per Section 3a) results in a loss, `active_strategy_mode` switches to `STRATEGY_B` immediately — after that one loss, not after two. This is tighter than the standard two-strike rule by design: a loss at the maximum bootstrap risk level is proportionally far more damaging than a loss at the standard matrix's maximum of 40%, so it doesn't wait for a second occurrence before stepping back into capital preservation.

## 8. Phase 7 — Closed-Loop Self Learning

At the completion of every trade execution cycle, the engine recalculates and feeds updated performance vectors (`strategy_confidence`, `live_win_probability`, `market_quality`, `trend_quality`) back into the Phase 3 scoring for the next trading sequence.

## 9. Multi-Agent Orchestration Architecture

**System type:** Orchestrated Event-Driven Multi-Agent Trading System. This describes how the bot's internal modules communicate to feed APIRS (Sections 3–7 above) with the live inputs it needs.

**Design principle:** APIRS is deterministic and does not guess — it strictly executes the math in Sections 3–7 (and, while applicable, Section 3a). All prediction/analysis (market structure, news, strategy signals) is handled by separate probabilistic modules that feed data *into* APIRS. APIRS has absolute veto power: no trade executes without its sign-off, regardless of how confident the upstream modules are.

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

### 9.0 Watchlist — Bounded Multi-Instrument Scope (New, this revision — confirmed)

**What changed:** Modules 2–4 previously operated against a single, implicitly fixed instrument (the paper harness hardcodes `EURUSD` via `PAPER_SYMBOL`). This revision removes that assumption: the bot now evaluates a fixed, admin-configured **watchlist** of instruments every tick and autonomously decides which one (if any) to trade — not user-selected, and not fully open to anything the broker offers.

**Why bounded, not fully open:** an unbounded instrument universe multiplies per-tick work linearly with instrument count for Module 2 (technical structure) and Module 4 (strategy fit), and multiplies the surface area Module 7 needs correct execution specs for. Section 9.2's cost/latency design (rule-based fast path, LLM reserved for what genuinely needs language understanding) already assumes a small, known set of things evaluated per tick — an unbounded watchlist would break that assumption. A fixed watchlist keeps this bounded and auditable while still letting the bot pick the best opportunity across several distinct markets rather than being stuck waiting on one instrument that happens to be quiet.

**Confirmed watchlist — 5 forex majors + gold:**

| Instrument | Type | Why included |
|---|---|---|
| EURUSD | Forex major | Highest liquidity/lowest spread pair traded globally; already the pair this project has tested against |
| GBPUSD | Forex major | Second-most-liquid major, meaningfully different volatility/session profile than EUR |
| USDJPY | Forex major | Asian-session coverage the other majors don't give; JPY pip-value math is a genuinely different case worth having in the pool from day one (Module 7, below) |
| AUDUSD | Forex major | Commodity-currency behavior distinct from the EUR/GBP/JPY cluster — diversifies what Module 2's trend/volatility signals actually see across the watchlist |
| USDCAD | Forex major | Another commodity-linked pair with a different correlation profile than AUDUSD (oil vs. broader commodities) |
| XAUUSD (Gold) | Metal (CFD) | Session-independent (trades all major sessions), classic "risk-off" instrument that behaves differently than any FX pair — meaningfully diversifies the news-driven trades Module 3/4 can act on |

All six are standard on MetaQuotes-Demo and any real MT5 broker — no exotic pairs, no CFDs beyond gold.

**Verified tradable on MetaQuotes-Demo, this revision** — reused the `/symbol-info` connector endpoint from 4.6a against the live-attached terminal, same check already done for EURUSD:

| Instrument | `trade_mode_full` | Live bid/ask at check time | digits / point |
|---|---|---|---|
| EURUSD | `true` | 1.15351 / 1.15351 | 5 / 0.00001 |
| GBPUSD | `true` | 1.34481 / 1.34481 | 5 / 0.00001 |
| USDJPY | `true` | 158.333 / 158.334 | 3 / 0.001 |
| AUDUSD | `true` | 0.70411 / 0.70411 | 5 / 0.00001 |
| USDCAD | `true` | 1.40056 / 1.40057 | 5 / 0.00001 |
| XAUUSD | `true` | 4312.87 / 4313.13 | 2 / 0.01 |

All six returned `ok: true` and `trade_mode_full: true` — fully tradable, not just quoted. One operational detail worth carrying into Module 2's design: XAUUSD's *first* `/symbol-info` call returned a zero tick (`bid: 0.0, ask: 0.0, tick_time: 0`) even though `trade_mode_full` was already `true` — a symbol not previously in Market Watch needs a moment after `symbol_select` before the terminal receives its first real tick from the feed. A second call ~2s later returned a live tick normally. Module 2 (and any other module polling ticks for the first time per watchlist instrument) should treat a `0`/`null` bid or ask as "not warmed up yet, retry" rather than a hard failure — this isn't specific to XAUUSD, just more likely to surface on whichever watchlist instrument hasn't been queried recently.

**Module 1 — Master Orchestrator**
Central router. Holds the watchlist (Section 9.0) as config. On every new price tick or news event, triggers Module 2 once per watchlist instrument and Module 4's cross-instrument Selection pass, plus Module 3 once per new headline batch (not per instrument — see Module 3 below), collects all outputs into a single environment dictionary per evaluated instrument, and passes the set to Module 4 for cross-instrument selection, then APIRS (Module 5). If APIRS approves a risk size greater than 0.00 for whichever instrument Module 4 selected, routes the trade vector to Module 7 (Execution); otherwise discards the opportunity for that tick.

**Module 2 — Market Intelligence Worker**
Evaluates technical structure and trend state — now once per instrument in the watchlist (Section 9.0), not a single fixed instrument. Outputs, per instrument: `trend_quality` (0.0–1.0), `market_volatility` (LOW/NORMAL/HIGH), `volatility_penalty` (0.0–1.0, based on ATR/spread). Stays rule-based/free per Section 9.2 — evaluating six instruments instead of one adds CPU work, not LLM cost.

**Module 3 — News & Sentiment Intelligence Worker**
Parses free RSS feeds, economic calendars, and announcements for macroeconomic impact — **once per headline, not once per headline per instrument** (cost control: an LLM call is already the most expensive step in this pipeline, so multiplying it by watchlist size would be the single largest cost increase this revision could introduce). Each headline's one LLM-parsed output includes which of the watchlist's instruments it's relevant to (e.g. a Fed statement tags USD-quoted pairs; an RBA statement tags AUDUSD; a safe-haven-demand headline tags XAUUSD) plus a sentiment/impact score. A lightweight, rule-based keyword/entity matcher (no second LLM call) then fans that single classification out to per-instrument `market_quality` / `news_impact_score` — an instrument a given headline doesn't concern gets a neutral contribution from that headline, not a repeated API call spent finding out it doesn't apply.

**Module 4 — Strategy Engine (Selection + Discovery)**

Two distinct sub-responsibilities, on two different cadences:

- **Selection** (real-time, every tick): **materially new responsibility this revision** — evaluates every instrument in the watchlist (Section 9.0) against the pool of *validated* candidate strategies, and now decides both **which instrument to trade** and **which strategy fits it**, rather than only the latter (previously the instrument was a given). Outputs: `chosen_instrument` (one of the watchlist, or none if nothing across the whole watchlist clears the bar this tick), `trade_direction` (BUY/SELL/WAIT), `strategy_confidence` (0.0–1.0), proposed entry/stop/target prices — all scoped to whichever instrument was chosen. Still rule-based JSON-matching per Section 9.2, so evaluating six instruments × the strategy pool stays zero-LLM-cost; the search space grows linearly with watchlist size, not with API call count.
- **Discovery** (periodic — weekly/monthly, not per-tick, to keep this cheap): the AI researches established trading methodologies and proposes new candidate strategies as structured rule-sets, expanding the pool Selection draws from over time. Full mechanics in Section 9.4.

**Every candidate strategy — hand-written or AI-discovered — enters the same pool, but Selection only draws from strategies that have reached `active` status.** Getting there requires passing the scoped `FR-BOT-8` paper-trading gate described in Section 9.4/Section 11 — this applies equally regardless of source (`manual` or `ai_discovered`); nothing skips straight to `active` just because a person wrote it instead of the AI, or vice versa.

### 9.4 Strategy Discovery Mechanics

- **Cadence:** weekly or monthly, not real-time — strategy discovery doesn't need to react to market ticks, and running it rarely keeps API cost minimal (consistent with the cost priority applied throughout Section 9.2).
- **Process:** the AI (Claude/OpenAI, same models as `FR-BOT-1`) researches known trading approaches — classic technical systems, established trader/author frameworks, price-action patterns — and outputs a structured rule-set: entry/exit conditions, the market regime it's suited for (trending/ranging/high-volatility), and a plain-language description.
- **Registration:** each proposed strategy is stored with a status (`proposed` → `paper_testing` → `active` or `rejected`) — schema in `05_Database_Design.md`. Nothing skips straight to `active`, for either `source` value (`manual` or `ai_discovered`) — this is the scoped gate reinstated in Section 11.
- **Graduation bar:** reuses the original `FR-BOT-8` criteria this project already had on record before Section 11's system-level gate was removed — a minimum paper-trading window (proposed: 50 trades, matching the Learning Engine's rolling window in Section 8) with positive net P&L and >45% win probability. A strategy that doesn't clear this bar stays `paper_testing` or moves to `rejected`; it does not become eligible for Selection.
- **Human visibility:** proposed/paper-testing strategies should be visible somewhere reviewable (Admin module is the natural fit) even though the gate itself is automatic — a person should be able to see what the AI is proposing, not just what's already live.

**Module 5 — APIRS Risk Engine**
The deterministic core described in Sections 3–7 (and Section 3a) of this document. Receives account balance, peak equity, and the combined outputs of Modules 2–4. Runs the applicable tier/bootstrap lookup, risk score equation, macro circuit breaker, and micro circuit breaker in sequence, then outputs `final_applied_position_risk` and a `profit_lock_triggered` flag *(renamed from "withdrawal_triggered" — per the Section 1 custody note, this flag only indicates the Phase 4 profit-lock rule fired internally, not that any funds moved).*

**Module 6 — Learning Engine**
Post-trade review. Logs each trade's outcome against the conditions present when it opened. Feeds `live_win_probability` (rolling 50-trade window) and adjustments to `drawdown_penalty`/`loss_penalty` back into future Module 5 runs.

**Module 7 — Execution Engine**
Translates the approved risk percentage into exact lot/contract sizes based on entry/stop distance, and places the order via the broker's API. Stays blind to market sentiment — only acts on parameters explicitly verified by the Master Orchestrator and APIRS. Logs latency, flagging broker delays over 200ms.

**New requirement, this revision — per-instrument execution specs:** the watchlist (Section 9.0) means Module 7 can no longer assume one EURUSD-shaped lot-sizing formula. It needs a per-instrument execution spec (contract size, pip-value formula, minimum lot) for every watchlist instrument, not just the one forex pair tested so far. The MT5 connector's existing `/symbol-info` endpoint (`04_System_Architecture.md` Section 3.6) already returns per-instrument `volume_min`/`volume_step`/`digits`/`point` on request — that part is already instrument-agnostic. What's new: JPY-quoted pairs (USDJPY) and gold (XAUUSD) compute pip value/contract size differently than a standard non-JPY forex pair, so Module 7's lot-sizing math needs to branch on instrument type rather than assume one fixed formula.

**Confirmed implementation:** this module runs as a local Python service using the official `MetaTrader5` package (`04_System_Architecture.md` Section 3.6) — the one scoped exception to the Node.js stack (Blueprint Section 6), since MT5's free/native integration library is Python-only. It communicates with the rest of the Bot (Node.js) over a local internal API. One MT5 terminal instance runs per linked broker account, and since one account per user is now confirmed (Section 13), that's a predictable, bounded resource footprint at the 5-user initial scale.

**Why this holds up architecturally:** separating deterministic risk math (APIRS) from probabilistic analysis (Market/News/Strategy modules) is a legitimate, well-established pattern in institutional algorithmic trading — not just a theoretical nicety. It also means a failure in one module (e.g. the news feed going down) is isolated and doesn't take down the whole bot.

### 9.1 Module Failure/Timeout Fallback (Proposed, pending confirmation)

- **Module 2 (Market Intelligence) fails/times out:** set `trend_quality = 0.5` (neutral) and force `market_volatility = HIGH` for that cycle.
- **Module 3 (News AI) fails/times out:** set `market_quality = 0.5` (neutral) and `news_impact_score = 0` (neutral), and force `market_volatility = HIGH` for that cycle.
- **General rule:** any single module failure for a given tick forces `market_volatility = HIGH` for that cycle. This deliberately reuses the existing Phase 6 rule rather than inventing new failure-handling logic — it's the cheapest and most reliable option, since it adds no new state or code paths, just triggers the already-defined 1% clamp.

### 9.2 AI-Call Latency & Cadence (Proposed) — designed around "cheapest, fast, reliable"

- **Fast path (every tick, no API cost):** Master Orchestrator, APIRS (Module 5), Execution Engine (Module 7) — pure deterministic math, no external calls. Sub-50ms is realistic here.
- **Slow path (periodic, cached):** Modules 2–4's AI-backed analysis runs on a fixed interval — proposed every 15–30 seconds, or event-triggered (e.g. a new economic calendar release) — rather than on every tick. The latest result is cached and reused by the fast path until the next update. This is both faster *and* cheaper: forex conditions don't meaningfully change tick-to-tick, and a 15–30s cadence cuts LLM API call volume dramatically compared to calling per-tick.
- **Prefer free/rule-based computation wherever it's genuinely sufficient:** Module 2's `trend_quality`/`volatility_penalty` (moving averages, ATR, RSI-style indicators) don't need an LLM at all — plain technical calculation is free and faster. Reserve Claude/OpenAI API calls for what actually needs language understanding: Module 3's unstructured news/RSS parsing, and higher-level confidence reasoning in Module 4. Calling an LLM for every input regardless of whether it needs one is the expensive, slow option — this design avoids that by default.

### 9.3 Module 3 Data Source Reliability (Confirmed, this revision — implemented in 6.3)

- Maintain 2–3 **free** RSS/economic-calendar sources in priority order (no paid data feeds, per the cost priority) — short timeout (3–5s) on the primary before falling back to the next. **Confirmed set:** Forex Factory's public calendar JSON (structured) + `forexlive.com/feed/news` primary / `fxstreet.com/rss/news` secondary (unstructured, RSS).
- **Best-effort, not strict, on partial failure:** if the calendar feed fails but headlines succeed (or vice versa), Module 3 returns a real result using whichever source(s) succeeded. Only a *total* outage — both fail — is treated as a Module 3 failure per Section 9.1 (neutral values + forced HIGH volatility).
- Lightweight per-source health tracker (calendar and the RSS chain tracked independently): if a source fails N consecutive cycles (5), mark it "degraded" and skip attempting it for a cooldown period (5 minutes) rather than repeatedly timing out and adding latency to every tick — keeps the fast path fast even when a free source is temporarily down.
- **Rate-limiting (`429`) is tracked separately from a hard failure, not folded into the same counter — discovered as a real, recurring condition, not a hypothetical.** During 6.3's own live verification, Forex Factory's calendar endpoint (Cloudflare-fronted, `cache-control: public, max-age=60`) actually rate-limited under this project's own repeated test-cadence requests. A source that's rate-limiting you is *up and responding* — a fundamentally different signal than a network error or a 5xx, and treating repeated 429s as "the source looks broken" would degrade a perfectly healthy free feed for 5 minutes over nothing more than calling it too often. Instead: a `429` sets a separate `rateLimitedUntil` backoff (honoring the response's `Retry-After` header if present, else defaulting to 60s — matching the calendar feed's own observed cache lifetime) and explicitly does **not** increment the hard-failure counter or set `degradedUntil`. Both `degradedUntil` and `rateLimitedUntil` gate the same "skip this source for now" check — they're just two different reasons to skip, tracked independently so a string of 429s can't accidentally mask (or get masked by) a genuine outage on the same source.

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

## 11. Pre-Live Validation Policy — system-level gate removed; strategy-pool gate reinstated (Phase 6 revision)

This section has two distinct decisions layered on it, kept on record separately rather than one silently overwriting the other, per this project's flag-rather-than-silently-resolve discipline.

**Original policy (superseded):** this section previously required any new or materially modified strategy, or any change to a tier's risk parameters — including the Section 3a bootstrap curve — to run through a minimum paper-trading window (proposed at 50 trades, matching the Learning Engine's rolling window) before being permitted to go live, with a minimum bar of positive net P&L and >45% win probability to graduate.

**Decision 1 (system-level "go live" gate — still removed, unchanged from the prior revision):** the engine as a whole — APIRS's implementation, tier parameters, the Section 3a bootstrap curve — is permitted to go live with real capital as soon as implementation is complete, with no minimum simulated-trade window and no automated graduation criteria gating *the system's* transition from paper to live. This is about whether Telos starts trading a real linked account at all, independent of which individual strategies Module 4 is allowed to select from.

**Decision 2 (strategy-pool gate — reinstated, this revision, narrower scope than the original policy):** independent of Decision 1, each individual entry in the `candidate_strategies` pool (Module 4, Section 9.4) — whether `source = manual` or `source = ai_discovered` — must still pass its own `FR-BOT-8` paper-trading window before Selection is allowed to draw from it live. Reasoning: Decision 1 was about not blocking the *system's* live-capital readiness on an arbitrary global trade count; it was never meant to mean "let an AI-discovered strategy with a plain-language rule-set start trading real money with zero prior verification that it behaves sensibly against real price sequences." Those are different risks — the first is about engine correctness, already covered by unit tests (Sections 3–5) and code review; the second is about whether a specific set of trading rules (which no human necessarily reviewed line-by-line, especially `ai_discovered` ones) actually produces sane behavior before it's trusted with real capital. Mechanics: Section 9.4's `proposed → paper_testing → active | rejected` status flow, using the same graduation bar as the original policy above (≥50 simulated trades, positive net P&L, >45% win probability) — `05_Database_Design.md`'s `candidate_strategies` schema and `03_SRS.md`'s `FR-BOT-8` were already written this way and did not need updating; only this section's earlier "removed entirely" language was too broad and is corrected here.

**Reasoning on record for Decision 1, per this project's own flag-rather-than-silently-resolve discipline:**
- The gate's original purpose was to validate that newly-implemented code behaves correctly under real trade sequences before real capital depends on it — distinct from the Learning Engine (Module 6, Section 8), which continues adjusting `live_win_probability` and related inputs indefinitely regardless of this decision.
- Removing the *system-level* gate means the first live trade this system ever places may also be the first time the full implementation — including Sections 6–8, not yet built as of the prior revision — has ever executed against a real, live trade sequence.
- This was raised explicitly as a tradeoff before that decision was made. The decision to accept that risk in exchange for reaching live trading sooner was made deliberately, not by omission.

**What still exists, unaffected by either decision:**
- The Learning Engine (Section 8) continues operating continuously in production, live or otherwise — it was never gated by this section.
- The macro and micro circuit breakers (Sections 6, 7) remain fully in effect from the first live trade onward — neither decision here affects any in-production safety mechanism.
- Unit-level test coverage (as built for Sections 3–5 so far, and to continue for Sections 6–8) is unaffected by Decision 1 — that removal is specifically about the *live-capital* gate, not about testing the code at all.

**Not addressed by this change, still open:** whether any reduced or informal verification step happens between "implementation complete" and "first live trade" for the *system-level* gate (Decision 1) is left to the person's discretion at that time, not specified here. This is separate from the *strategy-level* gate (Decision 2), which is now fully specified above.

## 12. Core Management Principles

1. Small account size does not justify reckless risk allocation.
2. Large account size does not justify careless exposure.
3. Completed profit blocks increase risk *permission*, not risk *obligation*.
4. High confidence plus strong market metrics allows higher risk — it doesn't require it.
5. Poor confidence or negative market conditions must reduce risk immediately.
6. Protect capital baselines before chasing profit growth.
7. Never increase aggression without statistical validation.
8. Every decision should maximize long-term system survival, not short-term gain.

*(Note: Section 3a's bootstrap risk curve is in direct, acknowledged tension with Principle 1 above. This is a deliberate, accepted exception — confirmed in Section 13 — scoped specifically to balances under $50, not a contradiction left to quietly disagree.)*

## 13. Open Items

**Settled** — confirmed given `05_Database_Design.md`, `06_API_Specification.md`, and everything built since have already assumed these without issue:
- ~~Strategy B~~ → Section 6.1 (flat 1% risk, 0.90 confidence bar, 60%-from-peak secondary halt floor).
- ~~Penalty parameter formulas~~ → Section 4.
- ~~`FR-BOT-8` backtesting/paper-trading gate~~ → **two-part resolution, Section 11.** The *system-level* go-live gate (engine/tier-parameter readiness) is removed. The *strategy-pool* gate is reinstated (Phase 6 revision): every `candidate_strategies` entry, `manual` or `ai_discovered`, still passes its own paper-trading window before Selection can draw from it live.
- ~~Module failure/timeout fallback values~~ → Section 9.1.
- ~~AI-call latency/cadence~~ → Section 9.2.
- ~~Data Payload Structure~~ → Section 10.
- ~~Module 3 data source reliability~~ → Section 9.3.

**Now resolved — `STRATEGY_A`'s initial candidate strategy pool:**

A starter *pool* — not a permanent limit — of three well-established, free-to-compute strategies, giving the Strategy Engine (Module 4) something concrete to select between at launch, based on `trend_quality`/`market_quality`:

1. **Trend-following (MA crossover)** — fast EMA crosses above/below a slow EMA signals BUY/SELL. Favored when `trend_quality` is high.
2. **Breakout** — price breaks above a recent high / below a recent low with momentum confirmation. Favored in high-volatility, directional conditions.
3. **Mean reversion (RSI-based)** — oversold/overbought RSI levels trigger counter-trend entries. Favored when `trend_quality` is low (ranging market).

This pool grows over time via the Discovery process (Section 9.4) — new strategies the AI proposes join this same pool once registered, starting at `status = proposed`. **The strategy-pool paper-trading gate applies to these additions (Section 11, Decision 2, reinstated)** — an AI-discovered strategy must clear the same `proposed → paper_testing → active` bar as a hand-written one before it's eligible for live Selection; it gets no more and no less scrutiny than a strategy a human wrote.

**Now resolved — `rule_set` concrete shape and Selection implementation (6.4):** the schema referenced above as `jsonb`/"structured entry/exit conditions" now has a fixed, implemented shape — `regime_fit` (cheap pre-check against Module 2/3's current reading), `signal` (`ema_cross`/`breakout`/`rsi_reversion`, one per strategy above), `stop`/`target` (both ATR-multiple based off Module 2's shared ATR — pure price-level math, works identically across all six watchlist instruments without per-instrument branching), `base_confidence`. Full shape and worked example in `05_Database_Design.md` Section 1.4. `strategy_confidence` is `base_confidence` nudged by how far past its own `regime_fit` threshold the current reading is (scale factor `0.5`, clamped `[0,1]`) — a deliberately conservative starting point, flagged to revisit once real trade outcomes exist to calibrate against.

**Settled — Watchlist / multi-instrument scope (Section 9.0, this revision):**

- **Watchlist membership** — confirmed: EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD, XAUUSD (Section 9.0), verified tradable (`trade_mode_full: true`, live ticks) against MetaQuotes-Demo via the same `/symbol-info` connector endpoint 4.6a used for EURUSD.
- **Concurrent positions across instruments — settled, this revision: one open position at a time, system-wide, not concurrent across instruments.** Module 4 picks at most one instrument to trade per tick (Section 9.0); `BotRuntime`'s existing single-open-position behavior stays exactly as-is regardless of which instrument gets chosen — no new APIRS/Execution code path for holding multiple simultaneous positions. **Reasoning on record:** this preserves the already-validated risk math in Sections 4–8 without requiring new aggregate cross-position exposure logic, and specifically avoids correlation risk given 4 of the 6 watchlist instruments (EURUSD, GBPUSD, AUDUSD, USDCAD) share USD as one leg — two "independently risk-sized" simultaneous positions in correlated pairs isn't the same risk as two positions in genuinely uncorrelated instruments, and the macro/micro circuit breakers (Sections 6–7) were designed around a single exposure, not an aggregate across several. **Not dismissed as a future option:** concurrent multi-instrument execution is a legitimate enhancement to revisit later — it would let the bot use idle time on a quiet instrument to act on an opportunity elsewhere instead of waiting — but it requires new APIRS-level aggregate-exposure rules (e.g. a correlation-aware combined risk cap across simultaneously-open positions) that don't exist yet and are explicitly out of scope for this revision.
- **`05_Database_Design.md` schema gap, confirmed by inspection this revision:** the `trades` table had no `symbol`/`instrument` column — documented at the time (see `05_Database_Design.md` Section 1.2, `trades.symbol`) as blocking Module 2–4 implementation directly, not a later cleanup item, but the actual migration (`005_add_trades_symbol.sql`) didn't land until 6.4, immediately before Selection needed it to persist which instrument it chose. Applied and verified against the live DB (backfilled pre-existing rows to `'EURUSD'`, then set `NOT NULL`) as part of 6.4.

**Settled — all four Section 3a interaction questions, this revision:**

- ~~Interaction with Phase 4 (Profit Lock)~~ → does not apply below $50. Begins only once the account crosses into the standard Tier 0–7 matrix (Section 5).
- ~~Interaction with the macro circuit breaker~~ → confirmed intended. A single loss can trigger the 45% macro breaker outright at bootstrap risk levels — accepted as the deliberate tradeoff of allowing 70% risk at very small balances (Section 6).
- ~~Interaction with the micro circuit breaker~~ → resolved with a new bootstrap-specific rule: a single loss at the 70% flat-cap risk level (balance ≤ $10) triggers an immediate switch to Strategy B, rather than waiting for the standard two-strike threshold (Section 7).
- ~~Permanent feature vs. one-time bootstrap~~ → **permanent by design, deliberately minimal.** Section 3a is intended to stay light-touch — few rules, maximum room for the account to grow from a very small starting balance — rather than accumulating the same constraint layers as the standard matrix. This is an intentional, accepted tension with Core Management Principle 1 (Section 12), not a gap to close later.

**Resolved (post-Phase-6, before Option 2 — see `CHANGELOG.md`):**

- ~~No demo/live account distinction anywhere in `broker_connections`~~ → fixed as its own small increment, sequenced deliberately before touching Option 2 at all. `broker_connections.account_type` (`demo`/`contest`/`real`) is now detected automatically from the live MT5 terminal (`mt5.account_info().trade_mode`) at every validate call — never user-supplied — and exposed via the public API. **What this does not do:** it doesn't itself gate or differentiate any real-order code path (Module 7 Execution, `mt5Connector.placeOrder`/`closeOrder`) — there still isn't one wired into the automatic loop. It makes the distinction *knowable and persisted* so that when Option 2 (real order placement) is eventually designed, it has a real field to consult rather than having to retrofit detection partway through. Consuming this field to actually restrict/differentiate execution is Option 2's own design responsibility, not resolved here. See `09_Security.md` Section 11 for the same item from the security-review angle.

---

*This document supersedes the abbreviated profit-lock description in `03_SRS.md` Section 3.5.1 — that section should point here rather than duplicate the formulas.*