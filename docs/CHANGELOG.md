# Changelog — Telos

## Phase 1 (in progress)

### 2026-08-06
- Backend Express scaffold with `GET /health`
- Docker Compose for PostgreSQL 16 + Redis 7 (Alpine)
- Database migrations: full schema from `05_Database_Design.md` + risk tier seed
- Auth module `FR-AUTH-1`–`FR-AUTH-4` (`/api/v1/auth/*`) with bcrypt, JWT, Redis session blacklist + password-reset tokens
