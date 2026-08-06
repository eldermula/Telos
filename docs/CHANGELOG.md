# Changelog — Telos

## Phase 2 (in progress)

### 2026-08-06
- Broker onboarding `/api/v1/broker-connections` (CRUD) with single-connection `409 CONNECTION_ALREADY_EXISTS`
- AES-256-GCM field encryption for `encrypted_credentials` via `BROKER_CREDENTIALS_KEY`
- Local Python MT5 connector (`bot/mt5-connector`) validating against attached MetaQuotes-Demo terminal
- Smoke-tested: link → connected, no credential echo, ciphertext at rest, duplicate reject, patch, delete

## Phase 1 (complete)

### 2026-08-06
- Backend Express scaffold with `GET /health`
- Docker Compose for PostgreSQL 16 + Redis 7 (Alpine)
- Database migrations: full schema from `05_Database_Design.md` + risk tier seed
- Auth module `FR-AUTH-1`–`FR-AUTH-4` (`/api/v1/auth/*`) with bcrypt, JWT, Redis session blacklist + password-reset tokens
