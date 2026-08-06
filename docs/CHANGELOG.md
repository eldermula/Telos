# Changelog — Telos

## Phase 4 — Trading Engine Integration & Real-Time Updates (complete through 4.6a)

**2026-08-06**

- **4.1** Trading Engine scaffold: `backend/src/engine/` — `bot_instances` ensure/load (APIRS `$10` defaults), Redis `bot:{id}:status` cache aligned with `GET /trading/session` shape. Smoke: `scripts/smoke-trading-engine-41.js` → `TRADING_ENGINE_41_PASS`
- **4.2** Trading REST: `POST /trading/session/start|stop`, `GET /trading/session` (JWT, single broker resolve, Redis-backed session shape). Smoke: `scripts/smoke-trading-session-42.js` → `TRADING_SESSION_42_PASS`
- **4.3** In-process paper `BotRuntime`: uses `bot/apirs` via `runTradeCycle`, stub signals, persists `trades` + `bot_decision_log`, Redis equity sync, in-process `event-bus`. Smoke: `scripts/smoke-bot-runtime-43.js` → `BOT_RUNTIME_43_PASS`
- **4.4** WebSocket `/ws?token=<jwt>` + Redis pub/sub `bot-events:{id}`; dependency `ws` added. Events: `bot.status_changed`, `trade.closed`, `equity.updated`, `strategy.switched`. Smoke: `scripts/smoke-websocket-44.js` → `WEBSOCKET_44_PASS`
- **4.5** Trading reads: `GET /trading/positions|orders|history|decision-log`. `history`/`decision-log` paginated (`{ data, meta: { page, limit, total } }`); `positions` always empty under the paper harness (no open-trade state produced by `runTradeCycle`); `orders` always empty **by design**, not a gap — the bot's execution model never places resting limit/stop orders, only immediate market orders with attached `stop_price`/`target_price` (now documented in `06_API_Specification.md` Section 6). Smoke: `scripts/smoke-trading-reads-45.js` → `TRADING_READS_45_PASS`
- **4.6a** First real MT5 order-placement path — `bot/mt5-connector/server.py`: `GET /symbol-info`, `GET /positions`, `POST /order/place`, `POST /order/close` (filling-mode retry across FOK/IOC/RETURN; `trade_mode_full` check surfaces closed-market conditions distinctly from a code error). Backend client (`mt5-connector.client.js`) wraps all four. **Manually-triggered only — not called from `BotRuntime`'s automatic tick loop; 4.6b (wiring real trades into the live loop) explicitly deferred until Phase 6 delivers real signals and position-monitoring exists.** Smoke: `scripts/smoke-mt5-order-46.js` → confirmed `EURUSD` `volume_min=0.01`, `trade_mode_full=true`, live ticks; placed, verified, and closed a real 0.01-lot BUY order against MetaQuotes-Demo (ticket `57869054102`) → `MT5_ORDER_46_PASS`

**Phase 4 is complete through 4.6a.** Full paper-trading loop works end-to-end: Start/Stop, live WebSocket status/trade/equity events, and positions/history/decision-log reads. First successful real MT5 order-execution proof is on record against MetaQuotes-Demo — manually-triggered only, deliberately not wired into the automatic bot loop (4.6b, deferred to Phase 6).

## Phase 3 — APIRS Core (complete)

**2026-08-06**

- New module `bot/apirs` (Node.js, no new runtime dependencies — tests run on Node's built-in `node:test`/`node:assert`)
- Section 2: initial parameters/constants — `$10` starting balance, 70/30 lock/growth split, 45%/60% macro drawdown thresholds, 1% emergency floor
- Section 3 & 3a: standard Tier 0–7 matrix by completed profit blocks (mirrors `database/migrations/002_seed_risk_tier_config.sql` exactly) plus the sub-$50 bootstrap inverse-linear risk curve (5% at $50 → 70% at $10, flat-capped at 70% for balance ≤ $10) — verified continuous, no discontinuity at the $50 handoff
- Section 4: position sizing engine — `risk_score` equation, the three penalty formulas (`drawdown_penalty`, `volatility_penalty`, `loss_penalty`), final applied risk clamped to `[1%, applicable ceiling]` in both regimes
- Section 5: profit-lock — 70/30 split, Peak Reset Vector (balance and peak reduced by the identical locked amount), tier advancement capped at 7, gated off entirely below $50
- Section 6 & 6.1: macro circuit breaker two-stage failsafe (`STRATEGY_A` → `STRATEGY_B` at 45% drawdown from peak → `HALTED` at 60%, terminal pending manual re-enable) plus Strategy B's flat 1% risk, 0.90 confidence bar, frozen tier progression, and 22.5% recovery hysteresis back to Strategy A
- Section 7: micro circuit breaker — the standard Two-Strike Rule (volatility HIGH, `consecutive_losses >= 2`, `daily_drawdown_pct >= 15%`, `strategy_confidence < 80%`) forcing next-trade risk to the 1% emergency floor, composed with the Section 3a single-loss override (any loss at `balance <= $10` escalates straight to `STRATEGY_B` without waiting for a second strike) — implemented as a composition on top of the Section 6 macro breaker result, with no changes needed to `macroCircuitBreaker.js` itself
- Section 8: closed-loop learning hooks, structure only (no AI calls this phase) — rolling 50-trade `live_win_probability` and `consecutive_losses`, both pure reducers over trade history, feeding the already-built Section 4/7 formulas as plain inputs
- Paper-trading harness (`paperTradingHarness.js`) — composes Sections 3–8 into a full per-trade simulation loop (tier/bootstrap lookup → position sizing → Strategy B/HALTED gating → micro breaker → simulated fill → macro breaker + bootstrap override → profit-lock), satisfying `12_Roadmap.md` Phase 3's exit criteria. Distinct from the removed Section 11 policy gate — this is simulation test infrastructure with no live-trading gating logic of its own
- `08_Bot_Architecture.md` Section 11 (pre-live paper-trading validation gate) removed per explicit decision, this revision — no minimum trade count or graduation criteria gates the transition to live capital; `12_Roadmap.md` Phase 9's exit criteria already reflects this
- **106 unit tests passing across all seven sections plus the harness (`bot/apirs/test/`), zero regressions across the full build**

**Phase 3 (APIRS Core) is complete** per `12_Roadmap.md`'s exit criteria: tier, risk score, position size, profit-lock, and both circuit breakers all verified against simulated trade sequences, zero API spend.

## Phase 2 — Broker Onboarding (complete)

**2026-08-06**

- Implemented `/api/v1/broker-connections` per `06_API_Specification.md` Section 4: `POST` (link), `GET` (list), `GET /:id`, `PATCH /:id`, `DELETE /:id`
- Application-enforced single connection per user — second link returns `409 CONNECTION_ALREADY_EXISTS`
- Field-level AES-256-GCM encryption for `broker_connections.encrypted_credentials` using `BROKER_CREDENTIALS_KEY` (env var, per `05` Section 4 / `09` Section 3)
- Local Python MT5 connector (`bot/mt5-connector`) via official `MetaTrader5` package; credentials never echoed in API responses, logs, or connector output
- Verified against MetaQuotes-Demo (login `5053904111`): connect → `connection_status: connected`, list/get/patch/delete, duplicate rejection, ciphertext at rest (no plaintext password in DB), real credentials linked via `PATCH` with `last_validated_at` updated

## Phase 1 — Backend Skeleton & Infrastructure (complete)

**2026-08-06**

- Node.js + Express backend scaffold with root `GET /health`
- Docker Compose: PostgreSQL 16 + Redis 7 (Alpine); `backend/Dockerfile`
- Full schema migrations from `05_Database_Design.md` (raw SQL + `database/migrate.js`, `schema_migrations` tracker) including `risk_tier_config` seed (Tier 0–7)
- Auth module `FR-AUTH-1`–`FR-AUTH-4`: signup, login, logout, password-reset request/confirm, `/auth/me` — bcrypt passwords, JWT sessions, Redis blacklist + reset tokens; MFA out of scope
- End-to-end Auth verified locally; password-reset uses server-side link logging until SMTP is configured
- Cloudflare Quick Tunnel verified: public `GET /health` → `{"status":"ok"}`
