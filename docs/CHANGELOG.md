# Changelog — Telos

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
