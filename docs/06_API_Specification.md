# 06 — API Specification — Telos

> Read `MASTER_PROJECT_BLUEPRINT.md`, `03_Software_Requirements_Specification.md`, `04_System_Architecture.md`, `05_Database_Design.md`, and `08_Bot_Architecture.md` first. This document defines the concrete REST + WebSocket contract between Frontend and Backend API, and is written to match `05_Database_Design.md`'s schema field-for-field where a response is a near-direct read of a table. It does not define the Backend↔Trading Engine↔Bot internal contract — that's `08_Bot_Architecture.md` Section 10, and remains internal-only, never exposed to the Frontend (Blueprint Section 5 / AI Rules 6a).
>
> **Revision note:** this version reconciles the first draft against `05_Database_Design.md`. See Section 16 for an explicit list of what changed and why — several mismatches surfaced (naming, cardinality assumptions, missing tables) that are flagged rather than silently resolved, per AI Rules Section 9.

---

## 1. Purpose & Scope

Defines every REST endpoint and WebSocket event the Frontend is permitted to use. If it's not in this document, the Frontend has no business calling it. Endpoint set maps 1:1 onto the modules in the PRD/SRS: Auth, Onboarding, Dashboard, Trading, AI Assistant, Portfolio, Analytics, Reports, Notifications, Settings, Admin.

## 2. Conventions

- **Base path:** `/api/v1`
- **Auth:** JWT bearer token in `Authorization: Bearer <token>` header on every route except `POST /auth/signup`, `POST /auth/login`, `POST /auth/password-reset/request`, `POST /auth/password-reset/confirm`.
- **Format:** JSON in, JSON out. `Content-Type: application/json`.
- **Naming:** REST resource nouns, plural, kebab-case in paths, and — where a resource maps directly onto a `05_Database_Design.md` table — the path and field names match that table's naming exactly (e.g. `broker_connections` table → `/broker-connections` endpoint, `broker_name` field) rather than inventing parallel terminology. Per AI Rules Section 4/7: no ad-hoc naming.
- **Method semantics:** standard — `GET` read, `POST` create/action, `PATCH` partial update, `DELETE` remove. Non-CRUD trading actions (Start/Stop) are `POST` to an action sub-resource (`POST /trading/session/start`), not verbs baked into a resource name.
- **Pagination:** list endpoints accept `?page=` and `?limit=` (default `limit=25`, max `100`), return `{ data: [...], meta: { page, limit, total } }`.
- **Errors:** consistent shape —
  ```json
  {
    "error": {
      "code": "BROKER_CONNECTION_FAILED",
      "message": "Human-readable description",
      "details": {}
    }
  }
  ```
  HTTP status communicates error class (`400`/`401`/`403`/`404`/`409`/`422`/`500`); `code` is a stable machine-readable string.
- **Idempotency:** state-changing actions that could plausibly be double-submitted (`Start Trading`, `Stop Trading`, broker link) accept an optional `Idempotency-Key` header.

## 3. Auth (`FR-AUTH-1` – `FR-AUTH-5`)

Matches the `users` table (`05` Section 1.2) directly — no changes needed after review.

| Method | Path | Purpose | Auth required |
|---|---|---|---|
| POST | `/auth/signup` | Create account (email + password) | No |
| POST | `/auth/login` | Log in, returns JWT | No |
| POST | `/auth/logout` | Invalidate current session | Yes |
| POST | `/auth/password-reset/request` | Send reset email | No |
| POST | `/auth/password-reset/confirm` | Complete reset with token | No |
| GET | `/auth/me` | Current user profile | Yes |

`POST /auth/login` response:
```json
{ "token": "jwt...", "user": { "id": "...", "email": "...", "role": "user | admin" } }
```

**JWT model — settled (Phase 1 planning):** single token only, as shown above. No access/refresh split for now — `09_Security.md` Section 2's mention of a refresh mechanism is deferred to Roadmap Phase 8 (hardening), not built in Phase 1. Logout invalidates the token via a Redis blacklist entry (`session:{user_id}`), checked on every authenticated request until the token's natural expiry.

**Full request/response bodies — settled (Phase 1 planning), filling the gap this section originally left open:**

```json
// POST /auth/signup
{ "email": "string", "password": "string" }
→ 201 { "user": { "id", "email", "role" } }
// Also auto-creates an empty settings row for the new user (1:1 per 05's ERD) —
// avoids null-settings edge cases everywhere else that reads settings.

// POST /auth/login
{ "email": "string", "password": "string" }
→ 200 { "token": "...", "user": { "id", "email", "role" } }

// POST /auth/logout
(no body, requires auth) → 204

// POST /auth/password-reset/request
{ "email": "string" }
→ 200 { "message": "If that email exists, a reset link was sent." }
// Deliberately generic — never confirms whether the email exists (no user enumeration).
// Token stored in Redis with a TTL (password_reset:{token}), not a Postgres table —
// fits Redis's ephemeral-state role (05 Section 3) rather than adding a new table for it.
// Email delivery: dev placeholder (log the reset link server-side) until a real SMTP
// provider is configured — nodemailer is wired in but unused until then. This is an
// interim state, not a final decision — revisit before Phase 9's live rollout.

// POST /auth/password-reset/confirm
{ "token": "string", "password": "string" }
→ 200 { "message": "Password updated." }

// GET /auth/me
→ 200 { "id", "email", "role", "created_at" }
```

**Health check — settled:** `GET /health` lives at the root, outside `/api/v1` — standard placement for a tunnel/liveness probe, not part of the versioned API surface.

**Auth rate limiting — settled default:** 5 login attempts per 15 minutes per IP, via the Redis `ratelimit:` mechanism already in `05` Section 2. Other endpoints' thresholds remain open (Section 15).

MFA (`FR-AUTH-5`) remains out of scope for this contract version — not designed now to avoid guessing at a shape before requirements land.

## 3a. Migration Tooling (Settled — Phase 1 Planning)

Raw SQL migration files (`database/migrations/NNN_description.sql`), run in order by a small Node script (`database/migrate.js`) using `pg` directly — no ORM. Matches AI Rules' preference for explicit, deterministic code over abstraction, and keeps the dependency footprint smaller on the resource-constrained self-hosted machine (`04_System_Architecture.md` Section 8 — 8GB RAM, modest CPU, multiple containers running concurrently). Migrations are tracked in a `schema_migrations` table.

## 4. Onboarding — Broker Connections (`FR-ONB-1` – `FR-ONB-6`)

**Renamed from the first draft's `/broker-accounts` to `/broker-connections`, and `broker_type` to `broker_name`, to match the `broker_connections` table in `05` exactly** — see Section 16.1.

**Confirmed — single broker account per user, enforced at the application layer** (`04_System_Architecture.md` Section 3.6/9): the schema stays multi-capable (unchanged, no cost to leave it that way), but `POST /broker-connections` rejects a second link attempt while an active one exists, returning `409 CONNECTION_ALREADY_EXISTS`. The optional `broker_connection_id` param below is kept as a defensive/forward-compatible pattern, not because it's needed today.

**Confirmed — MT5 connection method** (`04_System_Architecture.md` Section 3.6): the official `MetaTrader5` Python package, via a local Python service. `credentials` below has a concrete shape now rather than a placeholder.

| Method | Path | Purpose |
|---|---|---|
| POST | `/broker-connections` | Link a broker account (fails with `409` if one already exists) |
| GET | `/broker-connections` | Get the linked connection + status (empty array if none) |
| GET | `/broker-connections/:id` | Get connection status/detail |
| PATCH | `/broker-connections/:id` | Re-link / update credentials |
| DELETE | `/broker-connections/:id` | Disconnect |

`POST /broker-connections` request:
```json
{
  "broker_name": "mt5",
  "credentials": {
    "login": "string",
    "password": "string",
    "server": "string"
  }
}
```

Response — matches `broker_connections` columns directly:
```json
{
  "id": "...",
  "broker_name": "mt5",
  "connection_status": "connected | disconnected | error",
  "account_type": "demo | contest | real",
  "linked_at": "ISO-8601",
  "last_validated_at": "ISO-8601"
}
```

**`account_type` (added post-Phase-6, `08_Bot_Architecture.md` §13 / `09_Security.md` §11):** system-detected from the live MT5 terminal at validate time, never accepted as request input on `POST`/`PATCH` — there is no `account_type` field in the request body schema. Re-detected on every validate call, so it tracks whichever account the currently-stored credentials point at.

**Cardinality note (settled — see `04_System_Architecture.md` Section 3.6/9):** `05`'s schema is `users ──1:N──> broker_connections` and stays that way, but is application-enforced to one active connection per user for now. `GET /broker-connections` still returns an array (empty or single-item) rather than a single object, so the Frontend doesn't need rebuilding if multi-account is enabled later.

**Non-negotiable constraints (unchanged):**
- `credentials` accepted once, encrypted at rest, never echoed back — list/detail responses only ever contain `connection_status` and metadata, never credential material.
- No `deposit`/`withdraw`/`fund`/`transfer` endpoint anywhere in this document (Blueprint 5a / AI Rules 6b).
- `DELETE /broker-connections/:id` only removes the stored link — never initiates a withdrawal.

## 5. Dashboard (`FR-DASH-1`, `FR-DASH-2`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/dashboard/summary` | Aggregate view: connection status, portfolio snapshot, recent activity, key metrics |

Read-only server-side composition of Broker Connections + Trading + Portfolio + Analytics, so the Frontend isn't required to make 4 calls on initial load. Given single-account is confirmed for V1 (Section 4), this returns one summary object, not an array — simpler than the earlier draft assumed. Live updates after initial load come via WebSocket (Section 11), not polling.

## 6. Trading (`FR-TRADE-1` – `FR-TRADE-5`)

**Simplified now that single account per user is confirmed (Section 4):** `broker_connection_id` is resolved server-side from the authenticated user automatically — it's not a client-supplied param. The `409 AMBIGUOUS_BOT_INSTANCE` case from the earlier draft can't occur under this constraint and has been removed. If multi-account is enabled later (`12_Roadmap.md` Phase 10), an explicit `broker_connection_id` param would be reintroduced here — not before.

| Method | Path | Purpose |
|---|---|---|
| POST | `/trading/session/start` | Start automated trading for a given connection's bot instance |
| POST | `/trading/session/stop` | Stop automated trading |
| GET | `/trading/session` | Current bot status + tier + strategy mode |
| GET | `/trading/positions` | Open positions (`trades` where `status = open`) |
| GET | `/trading/orders` | Pending orders |
| GET | `/trading/history` | Closed trade history (paginated) |
| POST | `/trading/manual-orders` | Place a manual trade (`FR-TRADE-5`) |
| GET | `/trading/decision-log` | Bot decision/audit trail (new — see Section 16.5) |

`GET /trading/session` response — matches `bot_instances` columns directly, and is backed by the `bot:{bot_instance_id}:status` Redis cache per `05` Section 2 / System Architecture Section 5 for fast reads without hitting Postgres on every poll:
```json
{
  "bot_instance_id": "...",
  "status": "running | stopped | error",
  "active_strategy_mode": "STRATEGY_A | STRATEGY_B | HALTED",
  "current_tier": 0,
  "active_trading_balance": 0.00,
  "peak_equity": 0.00,
  "bootstrap_phase": true,
  "bootstrap_risk_ceiling_pct": 0.70
}
```

**`bootstrap_phase` / `bootstrap_risk_ceiling_pct` — added during Frontend Increment 5.6.** `current_tier` stays `0`/undefined-in-effect for the entire sub-$50 bootstrap phase (`08_Bot_Architecture.md` Section 3a) — displaying "Tier 0" during bootstrap would misreport it as the real Tier 0 of the standard matrix. `bootstrap_phase = active_trading_balance < 50`; `bootstrap_risk_ceiling_pct = bootstrapRiskPct(active_trading_balance)` (the same tested pure function `bot/apirs/src/tierMatrix.js` uses for real position sizing) when in bootstrap phase, else `null`. Computed server-side in `bot-status.cache.js` — the Frontend does not re-implement the Section 3a formula.

`GET /trading/positions` / `/orders` / `/history` response items — matches `trades` columns directly:
```json
{
  "id": "...",
  "direction": "BUY | SELL",
  "entry_price": 0.0,
  "stop_price": 0.0,
  "target_price": 0.0,
  "exit_price": null,
  "lot_size": 0.0,
  "final_applied_position_risk": 0.0,
  "status": "open | closed",
  "opened_at": "ISO-8601",
  "closed_at": null,
  "pnl": null
}
```

**`GET /trading/orders` returns `[]` by design, not as an unfinished endpoint.** The bot's execution model (`08_Bot_Architecture.md` Module 7, position sizing keyed on entry/stop distance) only ever places immediate market orders with an attached `stop_price`/`target_price` — never a resting limit/stop order awaiting a trigger price. There is consequently no "pending, not yet filled" state for this system to hold, and no `orders` table in `05_Database_Design.md`. The endpoint stays in this contract for shape-completeness against a future resting-order feature, but is not expected to ever return data under the current execution model — revisit only if that model changes.

**Schema gap now resolved** (`05_Database_Design.md` Section 1.2): `trades.origin enum('bot','manual')` distinguishes bot-originated trades from `FR-TRADE-5` manual orders — both still route through the same `bot_instance_id`/execution path, this only records who decided it.

`GET /trading/decision-log` (new) — direct paginated read of `bot_decision_log`, satisfying `FR-BOT-6`/`NFR-6` and the Vision's "watch it work" transparency goal, which wasn't exposed to the Frontend at all in the first draft:
```json
{
  "id": "...",
  "timestamp": "ISO-8601",
  "decision_type": "strategy_switch | profit_lock | macro_circuit_breaker | micro_circuit_breaker | trade_approved | trade_rejected",
  "triggering_condition": "human-readable reason",
  "details": { "...": "full environment dictionary snapshot, per Bot Architecture §10" }
}
```

`POST /trading/manual-orders` still routes through Backend → Trading Engine → Broker — "manual" describes who decided the trade, not a different code path.

## 7. AI Assistant (`FR-AI-1`, `FR-AI-2`)

**Restructured from a flat message list into nested conversations, to match `ai_assistant_conversations`/`ai_assistant_messages`' 1:N shape in `05`** — see Section 16.4.

| Method | Path | Purpose |
|---|---|---|
| POST | `/assistant/conversations` | Start a new conversation |
| GET | `/assistant/conversations` | List conversations (paginated) |
| POST | `/assistant/conversations/:id/messages` | Send a message, get a response |
| GET | `/assistant/conversations/:id/messages` | Message history for a conversation (paginated) |
| GET | `/assistant/insights` | Contextual insights (anomaly flags etc.) surfaced without an explicit prompt — not tied to a conversation |

Per System Architecture Section 6, this is strictly separate from the Bot-internal AI (Bot Architecture Modules 2–4) — no continuous loop, no path into APIRS or trade execution. Until `FR-AI-2` is confirmed, this contract treats the Assistant as read-only/advisory: nothing here calls `POST /trading/*`. If it's later authorized to act, it would call the same `/trading/*` endpoints a human would, not a private shortcut, and this doc would need an explicit update.

## 8. Portfolio (`FR-PORT-1`, `FR-PORT-2`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/portfolio/holdings` | Current holdings — computed from open `trades` at query time |
| GET | `/portfolio/performance?range=` | Historical performance over a selectable range |

**Settled — derived, not stored** (`05_Database_Design.md` Section 4): no `holdings` table. Net position per instrument is computed from open `trades` rows on each request, avoiding a second source of truth that could drift from `trades`.

## 9. Analytics (`FR-ANLY-1`, `FR-ANLY-2`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/analytics/trading-metrics` | Win rate, drawdown, P&L over time, etc. — computed from `trades` |
| GET | `/analytics/business-metrics` | Firm/consultant-level analytics, distinct from individual trading metrics |

Exact metric set is still open (SRS Section 8); shape is stable regardless (query-filterable by date range, returns a metrics object) since it's computed from `trades`/`bot_instances`, both of which are already defined.

## 10. Reports (`FR-REP-1`, `FR-REP-2`)

**Settled — synchronous generation, no `status` column** (`05_Database_Design.md` Section 4): given the self-hosted setup, an async job queue is extra infrastructure this doesn't need yet.

| Method | Path | Purpose |
|---|---|---|
| POST | `/reports` | Generate a report for a given period — returns the finished resource directly |
| GET | `/reports` | List previously generated reports |
| GET | `/reports/:id` | Get report metadata |
| GET | `/reports/:id/download` | Download the generated file |

`POST /reports` request — `period_start`/`period_end` as **date**, matching the `reports` table's column types:
```json
{ "period_start": "YYYY-MM-DD", "period_end": "YYYY-MM-DD", "format": "pdf | csv" }
```

No `report.ready` WebSocket event is needed — the synchronous response *is* the ready report. (Revisit only if report generation time becomes a real problem, per `05`'s note.)

## 11. Notifications & WebSocket Events (`FR-NOTIF-1` – `FR-NOTIF-3`, `NFR-3`)

REST:

| Method | Path | Purpose |
|---|---|---|
| GET | `/notifications` | List notifications (paginated) — matches `notifications` table |
| PATCH | `/notifications/:id` | Mark read/unread (`read_status`) |
| GET | `/notifications/preferences` | Get preferences |
| PATCH | `/notifications/preferences` | Update preferences (`settings.notification_preferences`) |

`notifications.type` enum in `05` is `('bot_start','bot_stop','connection_error','trading_error','strategy_switch', ...)` — open-ended. Recommend explicitly adding `'report_ready'` to that enum in `05` once the Reports open item (Section 10) settles on the async model, rather than relying on the `...` wildcard.

WebSocket: connection at `/ws` on login/dashboard load, authenticated via the same JWT issued by `/auth/login`. Fed by Redis pub/sub on the `bot-events:{bot_instance_id}` channel (`05` Section 2 / System Architecture Section 5) — this document specifies only the Frontend-facing event contract, not that internal transport.

Server → Frontend events:

| Event | Payload shape | Fires on |
|---|---|---|
| `connection.ready` | `{ user_id, bot_instance_id, channel }` | WS auth succeeded, subscription established — added during Phase 4 implementation; fits the existing `connection.*` namespace alongside `connection.error` below |
| `bot.status_changed` | `{ status, timestamp }` | Start/Stop/error (`FR-NOTIF-1`) |
| `trade.opened` / `trade.closed` | `trades` row shape (Section 6) | Trade execution |
| `equity.updated` | `{ active_trading_balance, peak_equity, timestamp }` | Near-real-time ticks while trading (`FR-DASH-2`) |
| `strategy.switched` | `{ from, to, reason, timestamp }` | `FR-NOTIF-3`, Bot Architecture Phase 5/6 |
| `connection.error` | `{ scope: "broker\|bot", message }` | `FR-NOTIF-2` |
| `report.ready` | `{ report_id }` | Contingent on Section 10's open item resolving in favor of async |

## 12. Settings (`FR-SET-1` – `FR-SET-3`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/settings/profile` | Get profile settings |
| PATCH | `/settings/profile` | Update profile settings |
| GET | `/settings/notifications` | Alias of `/notifications/preferences`, kept here for discoverability |

Broker connection management stays under `/broker-connections` (Section 4), not duplicated here.

Platform subscription/billing, if introduced, lives under a separate `/billing/*` namespace — kept structurally unconfused with `/broker-connections` per Blueprint 5a.

## 13. Admin (`FR-ADMIN-1`, `FR-ADMIN-2`)

**Added risk-tier management endpoints — see Section 16.8. This was a real gap in the first draft, not a naming issue: `05` Section 1.3 explicitly states `risk_tier_config` exists so tiers can be tuned "e.g. from the Admin module" without a deploy, and the first draft had no endpoint for it at all.**

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/users` | List user accounts |
| GET | `/admin/users/:id` | User detail |
| GET | `/admin/system-health` | System health snapshot |
| GET | `/admin/risk-tiers` | Read current `risk_tier_config` (all 8 tiers) |
| PATCH | `/admin/risk-tiers/:tier` | Update a tier's `step_size` / `base_risk` / `max_risk_ceiling` |
| GET | `/admin/candidate-strategies?status=` | List strategies in `candidate_strategies` (`05` Section 1.4), filterable by status |
| PATCH | `/admin/candidate-strategies/:id` | Mark `reviewed_by_admin`, or manually override status (e.g. force-`reject` a paper-testing strategy) |

Every `/admin/*` route requires `role: admin` on the JWT — enforced server-side, `403` on a non-admin token, never a filtered response.

**Every write under `/admin/*` (including `PATCH /admin/risk-tiers/:tier`) must write a row to `admin_audit_log`** (`admin_user_id`, `action`, `target_user_id` if applicable, `timestamp`) — this wasn't stated explicitly in the first draft even though the table existed for exactly this purpose.

## 14. Non-Functional Constraints on This Contract

- **`NFR-1` non-custodial:** no endpoint accepts, holds, or transfers user trading funds — permanent constraint on any future addition to this file.
- **`NFR-2` security boundary:** broker credentials never appear in any response body, including admin routes.
- **`NFR-3` real-time delivery:** Section 11 covers this; REST for on-demand queries/actions, WebSocket for live state.
- **`NFR-6` auditability:** now covered on two fronts — `GET /trading/decision-log` (bot decisions) and the `admin_audit_log` write requirement (Section 13, admin actions). The first draft only implicitly covered the former.
- Rate limiting: auth login default settled (5/15min/IP, Section 3) — other endpoints still unspecified per-endpoint (Section 15).

## 15. Open Questions

**Settled:**
- ~~WebSocket auth handshake~~ → JWT passed as a query param on the connection URL (`wss://.../ws?token=<jwt>`) — simplest option, matches what Section 11 already implied.
- ~~Per-endpoint rate limits~~ → general default: 60/min for `GET`, 10/min for state-changing methods, per `09_Security.md` Section 11. Auth login keeps its own tighter limit (Section 3).
- ~~`/reports/:id/download` mechanism~~ → streams the file directly from the backend. No signed-URL scheme needed — there's no separate object storage service in this setup (`05_Database_Design.md` Section 4: reports live on local disk on the same self-hosted machine).
- ~~`FR-AI-2` scope~~ → read-only/advisory for V1, as Section 7 already assumed. The Assistant does not call `/trading/*` and has no path to influence bot behavior. Revisit only if a real need for action-taking emerges.
- ~~SMTP provider for password-reset emails~~ → **Brevo — account created.** Free tier (~300 emails/day, comfortably enough for 5 users). Only remaining step is dropping the resulting SMTP credentials (host, port, user, API/SMTP key) into `.env` — an implementation task, not a docs decision. The dev-placeholder logging (Section 3) stays in place in code until that wiring is actually done.

**Still open — user-dependent, not a design decision:**
- MFA endpoint(s), once `FR-AUTH-5` scope is confirmed (deliberately deferred, not blocking).
- Cloudflare Tunnel domain/hostname — a free Quick Tunnel covers Phase 1 verification; once a real domain is purchased, this needs updating with the actual value.

## 16. Reconciliation Notes — Changes Made After Reviewing `05_Database_Design.md`

For traceability, since AI Rules Section 9 asks that changes be explained rather than silently applied:

1. **Naming:** `/broker-accounts` → `/broker-connections`, `broker_type` → `broker_name`, generic `status` → `connection_status` in the linking response — all to match the `broker_connections` table exactly instead of parallel invented terms.
2. **Cardinality:** `05`'s `users ──1:N──> broker_connections` means multi-account is schema-supported even though PRD 3.2/Vision assume one. At the time of this revision, resolved only *for the Trading endpoints* with an optional `broker_connection_id` param — **superseded since by a project-wide decision: single account per user for V1, enforced at the application layer (Section 4)**, which simplified Section 6 further.
3. **`trades` has no bot-vs-manual distinction** — surfaced as a schema gap blocking clean implementation of `FR-TRADE-5`'s audit trail, not silently absorbed into the API.
4. **AI Assistant restructured** from flat messages to nested `conversations/:id/messages`, matching `ai_assistant_conversations`/`ai_assistant_messages`'s actual 1:N shape in `05`.
5. **Added `GET /trading/decision-log`**, previously missing entirely — `bot_decision_log` existed in `05` with no Frontend-facing read path, which undercuts the audit/transparency requirements it exists to serve.
6. **Portfolio holdings has no backing table** in `05` — flagged as needing a decision (derive vs. store) rather than assumed.
7. **Reports correction:** removed `?format=` from download (format is fixed at creation per schema) and flagged that the async `pending/ready/failed` model needs a `status` column added to `05`, or should be dropped in favor of synchronous generation.
8. **Added `/admin/risk-tiers` endpoints** — `05` Section 1.3 built `risk_tier_config` specifically for Admin-driven tuning; the first draft's Admin section didn't expose it at all. Also made explicit that admin writes must log to `admin_audit_log`.

---

*Next: these open items (Section 15) either get resolved as `05_Database_Design.md` amendments (holdings, reports status, trades.origin) or get carried forward into `07_UI_UX_Guide.md` / `09_Security.md` as needed. Recommend amending `05` first, since several of `06`'s response shapes are currently blocked on it.*