# Changelog — Telos

## Phase 3 — APIRS Core (in progress)

**2026-08-06**

- New module `bot/apirs` (Node.js, no new runtime dependencies — tests run on Node's built-in `node:test`/`node:assert`)
- `08_Bot_Architecture.md` Section 3 & 3a: standard Tier 0–7 matrix lookup by completed blocks (mirrors `database/migrations/002_seed_risk_tier_config.sql` exactly) plus the sub-$50 bootstrap inverse-linear risk curve (5% at $50 → 70% at $10, flat-capped at 70% for balance ≤ $10); verified continuous, no discontinuity at the $50 handoff
- Section 4: position sizing engine — `risk_score` equation, the three penalty formulas (`drawdown_penalty`, `volatility_penalty`, `loss_penalty`), final applied risk clamped to `[1%, tier ceiling]` in both the standard and bootstrap regimes
- Section 5: profit-lock — 70/30 lock/growth split, Peak Reset Vector (balance and peak reduced by the identical locked amount), tier advancement capped at 7, gated off entirely below $50 per the settled Section 3a interaction
- Section 6 & 6.1: macro circuit breaker two-stage failsafe (`STRATEGY_A` → `STRATEGY_B` at 45% drawdown from peak → `HALTED` at 60%; `HALTED` terminal pending manual re-enable) plus Strategy B's flat 1% risk, 0.90 confidence bar, and frozen tier progression
- 60 unit tests passing across the four sections above (`bot/apirs/test/`), including targeted coverage for a tier-transition profit-lock trigger and a single bootstrap-phase loss (70% flat-cap risk) tripping the macro breaker outright while correctly landing in Strategy B rather than jumping straight to Halt
- `08_Bot_Architecture.md` Section 11 (pre-live paper-trading validation gate) removed per explicit decision, this revision — no minimum simulated-trade window or graduation criteria gates the transition to live capital; `12_Roadmap.md` Phase 9's exit criteria already reflects this
- **Still pending in this phase:** Section 7 (micro circuit breaker, including the bootstrap-specific single-loss-at-70%-risk override), Section 8 (closed-loop learning hooks, structure only), and the paper-trading harness itself — not yet started

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
