# 11 — Crypto & Synthetics Scoping — Telos

> Scoping and decision record. This document exists to answer five specific questions before any code gets written, per this project's standing design-first discipline — the same treatment Option 2 got across increments A–E before a single line touched `bot-runtime.js`. All five questions are now answered; nothing below remains open.

**Status: scoped and decided; isolated Increments A–D landed.** Instrument scope: **crypto, BTC/ETH only**, confirmed. Synthetics: explicitly deferred. Architecture (§0.2) and instrument scope (§6) settled. A–D verified without dispatcher wiring — still no `crypto-bot-runtime.js`. Next: human E.8 + Module 3 cost week + §6 stabilization buffer, then dispatcher-level work.

---

## 0. Architecture: the separate-pathway design (adopted)

Rather than wiring crypto into the existing forex+gold dispatch path, crypto is built as a **structurally separate pathway** — same city (same backend, same Postgres, same Redis, same APIRS core), different roads:

- **Shared, safe to reuse as-is:** `bot/apirs` (pure risk math — percentage-based, already instrument-agnostic), Postgres/Redis infrastructure, Auth, the WebSocket layer, the access gate.
- **New, parallel, isolated modules:** a crypto-specific Market Intelligence variant (shared math, new thresholds), a crypto-specific News Intelligence pipeline, crypto contract specs for Module 7, and — critically — **its own dispatcher path**, not a branch inside `bot-runtime.js`'s existing `tickOnce()`.

This mirrors the exact pattern that made Option 2 trustworthy: `_maybeOpenPositionReal`/`_maybeOpenPositionPaper` as genuinely separate methods, not an `if` threaded through shared code (Increment E, Layer 4). A crypto tick loop should be reviewable and testable in isolation, without risk of an edit meant for crypto silently changing forex/gold behavior, or vice versa.

**What this means practically:** the isolated pieces below (news pipeline, threshold calibration, contract specs) can be scoped and built without touching anything currently live or mid-verification (Module 3's forex pipeline, Option 2's E.8). Dispatcher-level wiring — where the roads actually meet in `bot-runtime.js`'s vicinity — waits until Option 2 is fully closed and Module 3's soft-launch period has run its course (§6, question 4).

### 0.1 — Why a genuinely separate `bot-runtime.js`, not just separate methods

Taking the isolation further than Increment E's internal method split: a standalone `crypto-bot-runtime.js`, never importing from or editing `bot-runtime.js`. Zero risk to the file Option 2's finish line depends on, and it removes the "don't touch the file that's mid-verification" caution entirely, since nothing touches it.

Three real questions this raised, unresolved by the split alone — resolved below in §0.2:

1. **How much surrounding orchestration is duplicated vs. shared?** `bot-runtime.js` isn't only open/monitor logic — it also calls the trades repository, publishes WebSocket events, writes to `bot_decision_log`, and is driven by the Start/Stop API surface. A second runtime needs all of that too.
2. **Does `broker_connections`' single-connection-per-user constraint still hold?** Confirmed and enforced back in Phase 2/4. Crypto on a different broker than forex/gold means a user needs two connections — a direct contradiction unless revisited.
3. **Does "one position system-wide" still mean what it originally meant?** The original reasoning (Section 13, `08_Bot_Architecture.md`) was about correlation risk across the 6 forex+gold instruments sharing USD exposure. Two independent runtimes, each sizing risk off the same account balance with no awareness of the other's open position, quietly reintroduces that exact risk — across asset classes instead of instruments.

### 0.2 — Resolved: layer split, connection cardinality, position limit

**Layer split, not all-or-nothing.** Share the `trades` repository, WebSocket event publishing, and `bot_decision_log` writes across both runtimes — add an `asset_class` enum (`forex_gold` / `crypto` / `synthetic`) to both tables, and let both runtimes call the same writer functions. Keep the tick loop itself — `tickOnce()`'s decision logic, open/monitor/close orchestration — genuinely separate: `crypto-bot-runtime.js` as its own file and loop, never importing from `bot-runtime.js`. This is where Increment E's lesson actually applies: isolation matters for the code that *decides to act*, not the code that *records what happened*.

Control plane: separate routes (`/bot/forex/start|stop`, `/bot/crypto/start|stop`), not one parameterized endpoint — makes it structurally impossible for a routing bug to dispatch a stop call to the wrong runtime. Shared process-supervision boilerplate can live in a common `RuntimeManager` helper; which runtime handles a given request should never be implicit.

Worth flagging for the self-hosted deployment specifically: two runtimes each independently opening a Postgres pool, Redis client, and WebSocket server is a real, avoidable resource cost on the current hardware (i5-6300U/8GB) — not just an abstract coupling concern.

**Connection cardinality: relax `UNIQUE(user_id)` to `UNIQUE(user_id, broker_id)`.** Not unlimited connections — one per broker, still bounded. A user can link a second account (e.g. Deriv alongside their existing MT5 connection) without removing the constraint that gave Phase 2/4 its safety guarantee. This is a connection-management/UX decision, not a custody question — Telos still never holds funds either way (Option A holds). `04_System_Architecture.md` needs updating once this lands, since that's where the original single-connection constraint is recorded.

**Position limit: one open position across the whole account, system-wide — not one per runtime.** Enforced through the now-shared `trades` table, not runtime-to-runtime coordination: each runtime's open-position check widens from "my rows" to all of this user's open rows regardless of `asset_class`. Closed against race conditions at the database level, not just the application level:

```sql
CREATE UNIQUE INDEX one_open_trade_per_user
ON trades (user_id)
WHERE status = 'open';
```

This preserves the original reasoning behind the single-position rule (stacked real-capital exposure against one balance) rather than quietly reopening it by omission. Worth naming a specific case this already covers: BTC and ETH are themselves highly correlated — they tend to move together, not independently — so holding one of each simultaneously wouldn't be diversification, it'd be levering the same directional bet twice. The system-wide guard prevents this as a side effect, since any open row (BTC or ETH) blocks a new one. That's a real correlation risk handled by the existing rule, not something that needed separate design.

Whether a user should ever be allowed to run two simultaneous positions across separate, genuinely independent funded accounts is a distinct, later product decision — explicitly not something that falls out of this build as a side effect.

**Concrete surface this implies** (decided, not yet built):
- New file `bot/crypto-bot-runtime.js` — own tick loop, own open/monitor/close methods; imports the shared writers below, never imports from `bot-runtime.js`
- Schema: `asset_class` enum (`forex_gold` | `crypto` | `synthetic`) added to `trades` and `bot_decision_log`
- Schema: the partial unique index above, enforcing one open trade per user
- Schema: `broker_connections` uniqueness relaxed to `UNIQUE(user_id, broker_id)`
- Routes: `/bot/crypto/start`, `/bot/crypto/stop` — explicit, alongside the existing forex routes

**Not part of this scope, still correctly parked:** the broker-selector UI (letting a user pick their server from a dropdown rather than free-text entry). Unrelated to the connection-cardinality change above — the backend works the same either way — and stays deferred to the general UI-polish phase per the standing decision.

---

## 1. What in Modules 2–4/7 assumes forex-like behavior

| Module | Forex-specific assumption today | Crypto impact | Synthetics impact (reference only — deferred) |
|---|---|---|---|
| **2 — Market Intelligence** | ADX/ATR math itself (`bot/market-intelligence`) is generic — works on any OHLC series. But the volatility category thresholds (`<0.8` LOW / `0.8–1.3` NORMAL / `>1.3` HIGH, Section 9's ratio-to-rolling-average design) were calibrated by watching real forex/gold behavior. | Two effects, not one: crypto's baseline vol runs at a different order of magnitude than FX majors — but Section 9's design is a ratio-to-rolling-average, which is self-normalizing to that baseline, so absolute level alone shouldn't break it. Early scoping hypothesized sharper crypto regime-switching would over-fire HIGH under 0.8/1.3. **Empirical Increment C settle (M15 × 1000 bars BTCUSD+ETHUSD, n=1936 ratios via `/rates`): pooled p10≈0.81 / p90≈1.25; forex bands give ~9% LOW / ~8% HIGH; provisional wider 0.65/1.55 nearly silenced the arms (~0.1% / ~0.9%). Settled crypto cutoffs = `0.8` / `1.3` (same numbers, separate constant for future drift). Re-run `calibrate-crypto-vol-c.js` after a major stress window.** | Synthetic indices have *designed*, statistically fixed volatility — likely needs its own threshold set entirely, calibrated against the instrument's documented profile rather than observed like forex. |
| **3 — News & Sentiment** | Entirely built around Forex Factory's economic calendar (rate decisions, NFP, CPI) plus forex-outlet RSS (ForexLive, FXStreet). | Real, meaningful news correlation — but different news entirely (exchange events, regulatory actions, ETF decisions, on-chain events). Needs its own source list and entity vocabulary (BTC/ETH-style tags instead of currency codes). Zero reuse of the calendar feed. | **Should not attempt news correlation at all.** Synthetic indices are algorithmically generated specifically to be immune to real-world events — wiring news into their evaluation would be actively wrong, not just wasted effort. |
| **4 — Strategy Selection** | The three starter strategies' signal logic (EMA cross, breakout, RSI reversion) is generically applicable to any price series. But `regime_fit` thresholds (`trend_quality_min`, `market_volatility_in`) were tuned assuming forex-like regime distributions. | Same recalibration need as Module 2 — the *logic* likely transfers, the *thresholds* probably don't without adjustment. | Same open question — synthetics' regime behavior may not map cleanly onto thresholds tuned for real market psychology. |
| **7 — Execution (lot sizing)** | Contract specs (contract size, pip value, `volume_min`/`step`/`max`) fetched per-instrument from `getSymbolInfo`, but Module 7's lot-sizing math (built in Option 2 Increment E.3) was scoped and tested only against forex+gold-shaped instruments. | Crypto often trades in fractional units with different margin/contract conventions than forex pairs — needs its own verified spec handling, not just "call the same function with a different symbol." | Synthetics have their own distinct contract conventions per Deriv's specification — same category of new work as crypto, different specifics. |

**Bottom line:** the *pure math* (ADX, ATR, EMA, RSI, percentage-based risk sizing) is genuinely reusable. The *calibration and specs* built on top of that math are forex-shaped and need their own pass for crypto — not a shared assumption that "if it worked for EURUSD, it'll work for BTC."

---

## 2. The broker dependency

**Synthetic indices are a Deriv-specific product,** unavailable through MetaQuotes-Demo or typical forex-focused brokers. Building synthetics support would have effectively pre-decided the still-open "which live broker" question from `02_Product_Requirements.md` §7 — not as a side effect, but as a direct requirement.

**Crypto is comparatively broker-agnostic.** Many MT5-compatible brokers offer crypto CFDs, so crypto alone doesn't force the live-broker decision the way synthetics would — though it does narrow the field to brokers offering crypto instruments specifically.

**Adopted, per §6:** the live-broker question stays open on its own merits (execution quality, regulation, fees, reputation) rather than being reverse-engineered from an instrument wishlist. Crypto — the broker-agnostic path — is the scope going forward; synthetics stays deferred specifically because it would have pre-decided that question.

---

## 3. News-relevance design, per instrument type

**Crypto** gets its own parallel pipeline to Module 3, not an extension of the existing one:
- New RSS/news sources (crypto-specific outlets — the existing ForexLive/FXStreet feeds have essentially zero crypto coverage)
- New entity vocabulary for the LLM classification step (BTC/ETH/token-style tags rather than currency-pair tags)
- A distinct prompt/classification schema, not just distinct vocabulary. Forex's HIGH/MEDIUM/LOW model is built around *scheduled, anticipated* releases, where impact often comes from the surprise relative to consensus — a beat or miss against forecast — not the release itself. Crypto news (an exchange hack, a regulatory ruling) is structurally different: closer to an unscheduled shock with no consensus forecast to deviate from. The classification schema needs its own impact model, not a relabeled version of the calendar-driven one.
- Same dedup/caching/cost-control architecture as the existing pipeline is worth reusing — the *pattern* (Claude classification, content-hash dedup, Redis caching, kill-switch-gated rollout) is sound and instrument-agnostic; it's the *sources, vocabulary, and impact model* that need to be new

**Synthetics (deferred)** would need explicit non-participation, not a design at all — kept here for reference:
- `market_quality` for a synthetic instrument should resolve to a fixed neutral value (or an explicit "not applicable" mode), never computed from news
- This should be an intentional, documented exclusion in whatever dispatch logic eventually handles synthetics — not an omission that happens to work because no news source exists for them

---

## 4. Mixed trading hours

**The current watchlist is entirely Mon–Fri forex-session-hours,** confirmed directly during this build (the XAUUSD "not warmed up" retry logic handles brief staleness after a symbol hasn't been polled recently, and the full weekend closure was independently observed and confirmed live — `tick_time` ~11h stale, `EURUSD` closed).

**Crypto trades 24/7.** Wired into the *same* tick loop as the existing watchlist, the system would need genuine state-awareness of which instruments are open at any given moment — a meaningfully different problem than the current retry-on-stale-tick handling, since "closed for the weekend" and "briefly stale" are different conditions requiring different responses.

Worth flagging precisely, since "trades 24/7" undersells the real texture: crypto is always technically tradeable, but liquidity and spread quality still vary meaningfully by time of day and day of week — thin weekend and off-peak windows are real, even without a hard closed state. That's a different problem from forex's clean open/closed binary: not "is this instrument tradeable right now" but "is this a good moment to trade it." That distinction probably belongs with Module 7's execution logic (spread/liquidity awareness at order time) rather than Module 2's volatility thresholds or a market-hours gate.

**This is exactly where the separate-pathway architecture (§0) earns its keep.** With crypto on its own dispatcher, entirely apart from the forex+gold tick loop, the market-hours problem mostly disappears — a crypto-only loop never needs to reason about forex market hours, and the existing forex loop never needs to reason about crypto's always-open nature. The mixed-hours complexity was only a real problem if both instrument types were forced through one shared loop.

---

## 5. Effort estimates

Crypto alone is the confirmed, active scope (§6). The Synthetics and Both rows below are retained for reference — they're what made the comparison in §2 and §6 concrete, not current work.

Per-item, assuming the separate-pathway architecture from §0, and assuming `bot/apirs`'s core risk math is reused as-is (no changes needed there):

| Scope | Estimate | Major cost drivers |
|---|---|---|
| **Crypto alone (active)** | ~17–27 hours | New parallel news pipeline (4–6h), new Module 7 contract-spec handling (3–5h), volatility/regime threshold recalibration (2–3h), watchlist instrument verification via `/symbol-info` (1–2h), new dispatcher path (3–5h), testing (4–6h) |
| **Synthetics alone (reference — deferred)** | ~16–24 hours, **plus the broker decision itself** | Explicit no-news-correlation wiring (~1h), Module 7 contract specs for Deriv's conventions (4–6h), volatility/regime recalibration against synthetics' designed profile (3–5h), new dispatcher path (3–5h), testing (4–6h) — the broker decision this would force isn't a coding cost, but a real, non-deferrable product decision |
| **Both together (reference — not pursued)** | ~28–40 hours (not fully additive) | Shared dispatcher-pattern infrastructure and shared APIRS reuse mean some overlap; the two news/threshold/spec tracks remain fully separate work either way |

These are the same order-of-magnitude estimates given conversationally earlier in this project's build — restated here for the record, not re-derived from scratch.

---

## 6. Open questions — resolved

1. **Crypto, synthetics, or both?** **Crypto alone.** Synthetics is explicitly deferred as its own future decision, not folded into this scope — synthetics forces the live-broker decision toward Deriv (§2), while crypto doesn't. If the broker decision is still meant to be evaluated on its own merits (execution quality, regulation, fees, reputation, per `02_Product_Requirements.md` §7), picking synthetics now would be picking Deriv now, dressed up as an instrument decision. If the broker choice eventually does land on Deriv or another dual-offering provider, synthetics becomes a cheap add-on later rather than a forcing function now.

2. **Which specific crypto pairs?** **BTC/ETH only.** Same reasoning that shaped the original 6-instrument watchlist: highest liquidity, broadest broker availability (keeps the broker question from narrowing further than necessary), the most robust news coverage for Module 3's classification pipeline to have real material to work with, and the most usable historical data for Module 2's volatility recalibration. A long-tail altcoin isn't just more work — thinner liquidity and choppier volatility mean a genuinely worse bot on day one, and worse fills at execution. A broader set is a future low-risk extension once this pipeline is proven, the same way a 7th forex instrument would be.

3. **Which specific synthetic indices, if synthetics is pursued later?** **Volatility Indices, conditionally** — Deriv's exact current product lineup wasn't verified live, so confirm their symbol list before treating this as final. Volatility Indices fit the existing "same logic, new thresholds" pattern (smooth, continuous price action matching the "designed, statistically fixed volatility" premise already described in §1). Boom/Crash and Jump indices are a different shape — long calm drift punctuated by designed, scheduled spikes — and would likely be misread by the existing breakout strategy as genuine breakouts. That's not a threshold-recalibration problem, it's a strategy-logic mismatch: a bigger lift than this document's estimates account for, and out of scope unless synthetics is revisited and scoped separately.

4. **Does this wait until Option 2 (E.8) and Module 3's soft-launch are both fully closed?** **Yes, confirmed explicitly,** for two reasons beyond general caution against multiplying concurrent unknowns:
   - The shared "any open position, any asset class" guard (§0.2) needs to be proven solid under real forex traffic before a second runtime starts depending on it. Standing up crypto while that guard is still effectively new risks a bug hitting both runtimes at once, at the exact moment isolating which one caused it is hardest.
   - Building crypto against a shared writers layer that's itself still settling means every crypto bug investigation has to first rule out "is this crypto, or is this the still-stabilizing shared layer" — the exact debugging ambiguity the separate-pathway architecture exists to avoid, which it only delivers if the shared substrate is solid *before* the second runtime starts trusting it.

5. **What triggers the actual go-ahead — two separate gates, not one:**
   - **Isolated pieces** (news pipeline, threshold calibration, Module 7 contract specs) — triggered by question 1 alone. Now that crypto-only/BTC-ETH is confirmed, **this can start now**, in parallel with Option 2/E.8 finishing. It doesn't touch `bot-runtime.js`, and its only touch on the shared layer is additive (the `asset_class` column) — nothing here is load-bearing on code that's mid-verification.
   - **Dispatcher-level wiring** (`crypto-bot-runtime.js`'s tick loop actually running, even in paper mode) — gated on question 4, plus a **stabilization buffer**: at least a full week of the shared writers layer running clean under real forex/gold traffic *after* E.8 and Module 3's soft-launch both close, before crypto code starts depending on it. "Closed yesterday" and "closed and proven stable for a week" are different guarantees — the second is what the isolation architecture is actually paying for.

**Concretely, what this unlocks starting now:** news pipeline, threshold calibration, and Module 7 contract-spec work for BTC/ETH — scoped to those two pairs, no waiting on anything else in this build to close first.

---

*Next: scope the first real increment against the isolated pieces unlocked by §6 — news pipeline, threshold calibration, and Module 7 contract specs for BTC/ETH — same discipline as Option 2's own "A — schema only, confirm before B" opener. Dispatcher-level wiring (`crypto-bot-runtime.js` actually running) waits for the stabilization buffer in §6, question 5.*
