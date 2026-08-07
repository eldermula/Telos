# 09 — Security — Telos

> Read `MASTER_PROJECT_BLUEPRINT.md`, `04_System_Architecture.md`, `05_Database_Design.md`, and `06_API_Specification.md` first. This document consolidates the security posture that's been referenced piecemeal elsewhere (`NFR-2`, Blueprint Section 5/5a, AI Rules 6a/6b) into one place, and adds what wasn't covered yet: network exposure, dependency hygiene, and incident response — all designed around the confirmed self-hosted, cost-conscious setup rather than assuming cloud-native tooling.

---

## 1. Core Security Principles (Restated, Not New)

These are already non-negotiable elsewhere in the doc set — repeated here because a Security doc that doesn't state them explicitly is incomplete:

- **Non-custodial, always** (Blueprint 5a) — no code path may accept, hold, or transfer user trading funds. This is as much a security boundary as a product one: it means a credential leak or a bug can never result in Telos itself being the point of loss for user capital.
- **Frontend never talks to the Bot/broker directly** (Blueprint Section 5) — every trade-execution path goes through the Backend API and Trading Engine. This is the primary defense against a compromised or malicious frontend request causing unauthorized trades.
- **APIRS has absolute veto power** (`08_Bot_Architecture.md` Section 9) — no probabilistic AI output can force a trade past the deterministic risk engine.

## 2. Authentication & Authorization

- Passwords hashed with a modern, free, well-vetted algorithm (bcrypt or Argon2 — both free/open-source, no licensing cost) — never reversible encryption, never plaintext (`FR-AUTH-1`).
- JWT-based sessions (`FR-AUTH-2`), short-lived access tokens with a refresh mechanism; refresh/blacklist state cached in Redis (`05_Database_Design.md` `session:{user_id}`).
- Role-based authorization: every `/admin/*` route checks `role: admin` server-side (`06_API_Specification.md` Section 13) — `403`, never a silently filtered response, so a bug can't accidentally leak admin data to a regular user by returning a smaller version of the same payload.
- MFA (`FR-AUTH-5`) remains explicitly out of scope until designed — noted here so it isn't forgotten, not because it's being deprioritized indefinitely.

### 2a. Site-wide Access Gate (Phase 8.5 — Pre-launch)

Keeps casual visitors and bots off the **entire** app (before login/signup) during this stage. **Not** a replacement for Auth — real JWT sessions stay underneath exactly as before.

- Passphrase: Isaiah 43:18–19 (NKJV) lives only in `ACCESS_GATE_PHRASE` (server `.env`). Never in the frontend bundle.
- Comparison is **server-side only**: submitted text and the env value are both normalized (lowercase → strip punctuation → collapse whitespace) before equality check.
- On success: httpOnly cookie `telos_gate` (name configurable) carrying a JWT signed with **`ACCESS_GATE_SECRET`** (dedicated — independent of `JWT_SECRET`), TTL default **30 days**.
- Cookie flags: production `Secure; SameSite=None; Path=/` (cross-origin Vercel → Tunnel); local/dev `SameSite=Lax` without Secure so http://localhost works.
- CORS: `credentials: true` with a single configured origin (never `*`).
- Middleware on every `/api/v1/*` route except `POST /access-gate/verify` and `GET /access-gate/status`. `GET /health` stays outside `/api/v1` and is never gated (uptime — §10 / Phase 8.4). WebSocket `/ws` checks the same cookie when the gate is configured.
- Rate limit on verify: 5 / 15 min / IP (`rateLimit.preAuth()`, same posture as signup).
- Gate enforces when both `ACCESS_GATE_PHRASE` and `ACCESS_GATE_SECRET` are set; production refuses to start without them. Local/dev may omit both so smoke tests keep working.
- Setup: set the two env vars in `backend/.env` (see `.env.example`); frontend already sends `credentials: 'include'` and shows the gate UI before Auth.

## 3. Broker Credential Security

The single most sensitive data this system holds, given what it unlocks (trade execution on a real account):

- Encrypted at rest with a field-level cipher (AES-256) — `05_Database_Design.md` Section 3, `broker_connections.encrypted_credentials`.
- Decrypted only within the Backend API/Trading Engine boundary — never sent to, cached in, or reconstructable by the Frontend (`NFR-2`; UI Guide Section 4.6 reinforces this with the "never rehydrate" form rule).
- Never appear in any API response body, log line, or error message, including admin-facing ones (`06_API_Specification.md` Section 14).
- **Open item, carried from `05`:** key management approach — where the encryption key itself lives, and whether/how it rotates. On a self-hosted single machine, the practical options are an environment-variable-based key (simplest, lowest cost, but the key lives on the same machine as the encrypted data — a real tradeoff) versus a free-tier secrets manager if one fits the self-hosted setup. Needs a decision before this is considered complete, not before it's usable.

## 4. Network Security (Self-Hosted Context)

This is the area that changes the most compared to a typical cloud deployment, given the confirmed setup (`04_System_Architecture.md` Section 8: self-hosted PC, Cloudflare Tunnel, phone hotspot):

- **Cloudflare Tunnel** (confirmed) means no inbound ports are opened on the router at all — the PC initiates the connection outward to Cloudflare, which is materially safer than port-forwarding, and free.
- **HTTPS/TLS termination** happens at Cloudflare's edge as part of the Tunnel — no certificate management burden on the self-hosted side, no cost.
- **Recommend enabling Cloudflare's free-tier WAF/firewall rules** (basic rate limiting and bot-protection rules are available on the free plan) as a first line of defense in front of the Backend API — this is a free layer of protection that doesn't consume any of the PC's limited 8GB RAM (`04_System_Architecture.md` Section 8), since it runs at Cloudflare's edge, not locally.
- **CORS** on the Backend API restricted to the actual Vercel-deployed Frontend origin only — not a wildcard — so the API can't be casually called from an arbitrary third-party page even if a request somehow carries a valid-looking token.
- The self-hosted machine's local network/router admin interface is a separate concern from Telos itself, but worth a plain mention: standard home-network hygiene (router admin password changed from default, Wi-Fi/hotspot password not shared) matters more here than in a typical cloud setup, since a compromised local network is now adjacent to a machine holding encrypted trading credentials.

## 5. Data Protection & Backups

- ~~Backup strategy~~ → **implemented, Phase 8.2.** `database/scripts/backup.js` runs a `pg_dump` via `docker compose exec`, wraps the dump in AES-256-GCM (`BACKUP_ENCRYPTION_KEY`, distinct from `BROKER_CREDENTIALS_KEY`), commits into a local clone of a **private GitHub repo separate from this code repo**, and pushes. Retention defaults to the last 14 dumps. One-time setup + Windows Task Scheduler instructions: `docs/OPS.md` §1. Decrypt helper: `database/scripts/restore-backup.js`.
- `broker_connections.encrypted_credentials` remain field-level ciphertext inside any dump by construction — a backup is not an exception to Section 3's rule. The dump-file encryption is an *additional* layer so non-credential rows aren't plaintext to anyone with GitHub access alone.

## 6. Audit & Logging

Already built into the schema, restated here as a security control rather than just a feature:

- `bot_decision_log` (`05` Section 1.2) — every strategy switch, profit-lock trigger, and circuit-breaker event, with the full environment snapshot that caused it (`FR-BOT-6`/`NFR-6`). This is what makes a disputed or unexpected trade investigable after the fact.
- `admin_audit_log` — every admin write, including risk-tier changes (`06_API_Specification.md` Section 13), so admin access is itself accountable, not just gated.
- Neither log should ever contain broker credentials or full payment-adjacent data, even in the `details`/`jsonb` snapshot fields — worth an explicit check during implementation, since it would be easy for a raw environment-dictionary dump to accidentally include something it shouldn't.

## 7. Rate Limiting & Abuse Prevention

- Redis-backed rate limiting (`05` Section 2, `ratelimit:{user_id}:{endpoint}`) — specific thresholds per endpoint still open (`06_API_Specification.md` Section 15), but the mechanism is in place.
- Auth endpoints (`/auth/login`, `/auth/password-reset/*`) need tighter limits than general API traffic, given they're the most attractive brute-force target — worth calling out explicitly rather than applying one blanket rate limit everywhere.

## 8. Input Validation & API Hygiene

- All request bodies validated server-side against an explicit schema (not just trusted because the Frontend sent them) — standard practice, free to implement with any schema-validation library already compatible with the approved Node/Express stack.
- Parameterized queries only — no raw string-concatenated SQL, to close off SQL injection as a category entirely.
- Error responses never leak internal detail (stack traces, query text, file paths) — matches the API spec's `{ error: { code, message } }` shape (`06_API_Specification.md` Section 2), which is deliberately generic on the wire.

## 9. Dependency & Container Security ($0-cost tooling)

Consistent with the project's standing cost priority:

- ~~`npm audit` / Dependabot~~ → **implemented, Phase 8.3.** `.github/dependabot.yml` (weekly npm + GitHub Actions updates for `backend/` and `frontend/`) and `.github/workflows/npm-audit.yml` (`npm audit --audit-level=high` on push/PR). `bot/*` packages are dependency-free Node modules and are deliberately not listed. Docker images (Blueprint Section 6) kept minimal — smaller images mean a smaller attack surface and less resource pressure on the constrained 8GB RAM machine, which is a security and a performance win from the same change.

## 10. Incident Response (Lightweight, Matched to Current Scale)

Given the current scale (5 initial users, self-hosted), a lightweight plan beats an elaborate one that won't actually get maintained:

- **Bot going offline or erroring** — already surfaces via `connection.error` WebSocket events and the Notifications module (`FR-NOTIF-2`); this doubles as the first layer of incident detection. **External uptime monitoring (Phase 8.4):** point a free HTTP monitor (UptimeRobot recommended — no credit card) at `GET /health` through the Cloudflare Tunnel hostname. Setup steps in `docs/OPS.md` §2. Deeper Postgres/Redis checks stay on `GET /api/v1/admin/system-health` (admin-gated) and are not what the external monitor hits.
- **Suspected credential compromise** — the response is straightforward given the non-custodial model: disconnect the affected `broker_connection` (`DELETE /broker-connections/:id`), which removes Telos's stored access, and the user separately rotates credentials directly with their broker. Telos never having custody of funds significantly limits the blast radius of this scenario compared to a custodial platform.
- **Formal incident response runbook** — not built out yet; proposed as something to revisit once past the initial 5-user phase (`04_System_Architecture.md` Section 8), rather than over-building process for the current scale.

## 11. Open Items

**Settled:**
- ~~Key management approach~~ → environment-variable-based key, tradeoff and rationale in `05_Database_Design.md` Section 4.
- ~~Backup destination~~ → scheduled encrypted `pg_dump` exports pushed to a private GitHub repo (`05_Database_Design.md` Section 4) — free, reuses existing infrastructure.
- ~~Per-endpoint rate limit thresholds~~ → general default: 60 requests/minute per user for read (`GET`) endpoints, 10 requests/minute for state-changing (`POST`/`PATCH`/`DELETE`) endpoints. Auth login keeps its tighter override (5/15min/IP, `06_API_Specification.md` Section 3). WebSocket connections aren't REST-rate-limited by this scheme. **Implemented, Phase 8.1** (`backend/src/middleware/rate-limit.js`) — and while doing so, a handful of routes were deliberately tightened *below* this general default, decided and confirmed before implementing (see `CHANGELOG.md`):
  - `/auth/signup` and both `/auth/password-reset/*` routes → 5/15min per IP, matching login's brute-force posture (this section, Section 7 above) — signup additionally protects against mass fake-account creation, password-reset additionally protects the Brevo free-tier email quota.
  - `/trading/session/start` and `/trading/session/stop` → 5/min per user — legitimate use is a handful of presses a day; each call does real work (MT5 connect/disconnect) on the resource-constrained self-hosted machine (`04_System_Architecture.md` §8).
  - `/admin/*` GET routes → 20/min per admin; `PATCH /admin/risk-tiers/:tier` and `PATCH /admin/candidate-strategies/:id` → 5/min per admin — shrinks a compromised-admin-token's blast radius given these reach cross-user PII (GETs) or live trading math / active-strategy selection (the two PATCHes, Phase 7.8/7.9).
  - Design note carried into the implementation itself: the general limiter fails *open* (allows the request through) on a Redis error, since a rate limiter taking down the entire API during a transient infra blip would be a worse outcome than briefly losing abuse protection. Login's own separate, untouched limiter keeps its existing fail-*closed* behavior — brute-force protection on that one specific path is worth an availability tradeoff the general limiter isn't.

**Still genuinely open — not a technical decision, flagged for you specifically:**
- **Regulatory/compliance considerations** — running an automated trading platform, even non-custodial, may carry jurisdiction-specific obligations depending on where users are located and how the platform is described. Worth checking with someone qualified before real users connect real accounts (Roadmap Phase 9) — this isn't something any of these documents can resolve.

**Resolved (post-Phase-6, before Option 2 — see `CHANGELOG.md`):**
- ~~No demo/live account distinction anywhere in `broker_connections`~~ → fixed as its own small increment, deliberately sequenced before Option 2 (real order placement) rather than discovered partway through it. `broker_connections.account_type` (`demo`/`contest`/`real`) is detected automatically from the live MT5 terminal's `account_info().trade_mode` at every validate call — never accepted as user input, since a wrong self-reported flag would recreate the exact risk this closes. Migration `007_add_broker_connections_account_type.sql`; verified live against MetaQuotes-Demo (`account_type: 'demo'` returned end-to-end). **Scope boundary:** this makes the distinction knowable and persisted; it does not itself gate `placeOrder`/`closeOrder` — no code path calls those from the automatic loop yet. Deciding how Option 2 should behave differently (if at all) per account type is that increment's own design decision, not pre-empted here. See `08_Bot_Architecture.md` Section 13 for the same item from the architecture angle.

---

*This closes out the core technical doc set (01–09). `10_AI_Rules.md` and `11_AI_Prompt_Library.md` are process documents rather than system design; `12_Roadmap.md` sequences implementation from here.*