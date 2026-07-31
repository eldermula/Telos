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

MFA (`FR-AUTH-5`) remains out of scope for this contract version — not designed now to avoid guessing at a shape before requirements land.

## 4. Onboarding — Broker Connections (`FR-ONB-1` – `FR-ONB-6`)

**Renamed from the first draft's `/broker-accounts` to `/broker-connections`, and `broker_type` to `broker_name`, to match the `broker_connections` table in `05` exactly** — see Section 16.1.

The broker/MT5 connection *method* is still an open item (SRS Section 8, System Architecture Section 9) — that's unrelated to this naming fix and still unresolved. Endpoints stay broker-agnostic: `broker_name` is a free-form identifier validated server-side, and `credentials` shape is broker-specific.

| Method | Path | Purpose |
|---|---|---|
| POST | `/broker-connections` | Link a broker account |
| GET | `/broker-connections` | List linked broker connection(s) + status |
| GET | `/broker-connections/:id` | Get one connection's status/detail |
| PATCH | `/broker-connections/:id` | Re-link / update credentials |
| DELETE | `/broker-connections/:id` | Disconnect |

`POST /broker-connections` request:
```json
{
  "broker_name": "mt5 | <other-broker-key>",
  "credentials": { "// broker_name-specific shape, defined once brokers are confirmed": "" }
}
```

Response — matches `broker_connections` columns directly:
```json
{
  "id": "...",
  "broker_name": "mt5",
  "connection_status": "connected | disconnected | error",
  "linked_at": "ISO-8601",
  "last_validated_at": "ISO-8601"
}
```

**Cardinality note (new — see Section 16.2):** `05`'s ERD is `users ──1:N──> broker_connections`, i.e. a user can have more than one linked broker account, each with its own `bot_instance`. The PRD's core flow (Vision Section 5, PRD 3.2) was written assuming a single linked account. This document doesn't resolve that tension — it's flagged here and carried into Section 6 (Trading), where it actually matters for endpoint design. `GET /broker-connections` returning a list rather than a single object is deliberate, so the Frontend isn't rebuilt later if multi-account is confirmed.

**Non-negotiable constraints (unchanged):**
- `credentials` accepted once, encrypted at rest, never echoed back — list/detail responses only ever contain `connection_status` and metadata, never credential material.
- No `deposit`/`withdraw`/`fund`/`transfer` endpoint anywhere in this document (Blueprint 5a / AI Rules 6b).
- `DELETE /broker-connections/:id` only removes the stored link — never initiates a withdrawal.

## 5. Dashboard (`FR-DASH-1`, `FR-DASH-2`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/dashboard/summary` | Aggregate view: connection status, portfolio snapshot, recent activity, key metrics |

Read-only server-side composition of Broker Connections + Trading + Portfolio + Analytics, so the Frontend isn't required to make 4 calls on initial load. If a user has multiple `broker_connections`/`bot_instances` (Section 4 cardinality note), this endpoint returns a summary array keyed by `broker_connection_id` rather than assuming one. Live updates after initial load come via WebSocket (Section 11), not polling.

## 6. Trading (`FR-TRADE-1` – `FR-TRADE-5`)

Every endpoint below now accepts an optional `broker_connection_id` (query param on `GET`s, body field on `POST`s). **If the user has exactly one broker connection, it's inferred and the param can be omitted — this keeps the single-account flow from the Vision doc simple by default.** If a user has more than one, omitting it returns `409 AMBIGUOUS_BOT_INSTANCE` rather than silently guessing. This is the concrete resolution of the Section 4 cardinality note as far as this endpoint set is concerned.

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
  "peak_equity": 0.00
}
```

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

**Schema gap surfaced by this review (see Section 16.3):** the `trades` table has no column distinguishing a bot-originated trade from a manual one (`POST /trading/manual-orders`). As drafted, `FR-TRADE-5`'s manual trades and bot trades are indistinguishable in `trade history` and in `bot_decision_log`. Recommend adding `trades.origin enum('bot','manual')` to `05_Database_Design.md` before this endpoint is implemented — flagged here rather than worked around in the API layer, since the API can't invent data the schema doesn't store.

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
| GET | `/portfolio/holdings` | Current holdings |
| GET | `/portfolio/performance?range=` | Historical performance over a selectable range |

**Open item surfaced by this review (see Section 16.6):** `05_Database_Design.md` has no `holdings` table. `trades` gives history and open positions, but "current holdings" as a distinct concept (e.g. net position size per instrument) isn't durably stored anywhere. That means `GET /portfolio/holdings` either (a) computes holdings on the fly from open `trades` rows, or (b) requires a live pull from the broker via the Trading Engine on each request, which has different latency/caching implications than a Postgres read. Not resolved here — needs a decision before this endpoint is implemented, and `05` may need a `holdings` table or a documented "derived, not stored" decision.

## 9. Analytics (`FR-ANLY-1`, `FR-ANLY-2`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/analytics/trading-metrics` | Win rate, drawdown, P&L over time, etc. — computed from `trades` |
| GET | `/analytics/business-metrics` | Firm/consultant-level analytics, distinct from individual trading metrics |

Exact metric set is still open (SRS Section 8); shape is stable regardless (query-filterable by date range, returns a metrics object) since it's computed from `trades`/`bot_instances`, both of which are already defined.

## 10. Reports (`FR-REP-1`, `FR-REP-2`)

**Corrected from the first draft — see Section 16.7.**

| Method | Path | Purpose |
|---|---|---|
| POST | `/reports` | Generate a report for a given period |
| GET | `/reports` | List previously generated reports |
| GET | `/reports/:id` | Get report metadata |
| GET | `/reports/:id/download` | Download the generated file |

`POST /reports` request — `period_start`/`period_end` as **date**, not full timestamp, matching the `reports` table's column types:
```json
{ "period_start": "YYYY-MM-DD", "period_end": "YYYY-MM-DD", "format": "pdf | csv" }
```

**Correction:** the first draft put `?format=` on the download endpoint and treated generation as async with a `pending/ready/failed` status. `05`'s `reports` table has no `status` column and `format` is fixed at creation — so `?format=` on download was wrong (removed), and "async with status" isn't representable as written. Two ways to resolve, neither picked yet:
- Add a `status` column to `reports` in `05_Database_Design.md`, and keep the async model + `report.ready` WebSocket event (Section 11) as originally designed, **or**
- Treat generation as synchronous (small enough date ranges that it doesn't need async handling), in which case `POST /reports` just returns the finished resource and the `report.ready` event isn't needed.

Flagged in Section 15 as an open question rather than silently choosing one.

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

Every `/admin/*` route requires `role: admin` on the JWT — enforced server-side, `403` on a non-admin token, never a filtered response.

**Every write under `/admin/*` (including `PATCH /admin/risk-tiers/:tier`) must write a row to `admin_audit_log`** (`admin_user_id`, `action`, `target_user_id` if applicable, `timestamp`) — this wasn't stated explicitly in the first draft even though the table existed for exactly this purpose.

## 14. Non-Functional Constraints on This Contract

- **`NFR-1` non-custodial:** no endpoint accepts, holds, or transfers user trading funds — permanent constraint on any future addition to this file.
- **`NFR-2` security boundary:** broker credentials never appear in any response body, including admin routes.
- **`NFR-3` real-time delivery:** Section 11 covers this; REST for on-demand queries/actions, WebSocket for live state.
- **`NFR-6` auditability:** now covered on two fronts — `GET /trading/decision-log` (bot decisions) and the `admin_audit_log` write requirement (Section 13, admin actions). The first draft only implicitly covered the former.
- Rate limiting: still unspecified per-endpoint (Section 15).

## 15. Open Questions

- Exact WebSocket auth handshake mechanics (query param vs. auth frame vs. subprotocol).
- Per-endpoint rate limits.
- `broker_name` allowed values and each broker's `credentials` schema — blocked on the broker/MT5 decision (SRS Section 8 / System Architecture Section 9).
- MFA endpoint(s), once `FR-AUTH-5` scope is confirmed.
- **New:** Reports — add a `status` column to `05`'s `reports` table (async model) or confirm generation is synchronous (Section 10).
- **New:** Portfolio holdings — derive on the fly from `trades`, or add a `holdings` table to `05` (Section 8/16.6).
- **New:** `trades.origin` column (`'bot'|'manual'`) needed in `05` before `POST /trading/manual-orders` can be told apart from bot trades in history/audit (Section 6/16.3).
- Whether `/reports/:id/download` streams the file directly or returns a signed URL from `reports.file_path`.
- Final shape of `FR-AI-2` — if the Assistant gains action-taking ability, exact endpoint(s) need explicit sign-off.

## 16. Reconciliation Notes — Changes Made After Reviewing `05_Database_Design.md`

For traceability, since AI Rules Section 9 asks that changes be explained rather than silently applied:

1. **Naming:** `/broker-accounts` → `/broker-connections`, `broker_type` → `broker_name`, generic `status` → `connection_status` in the linking response — all to match the `broker_connections` table exactly instead of parallel invented terms.
2. **Cardinality:** `05`'s `users ──1:N──> broker_connections` means multi-account is schema-supported even though PRD 3.2/Vision assume one. Resolved *for the Trading endpoints specifically* with an optional `broker_connection_id` param (inferred when only one exists, `409` when ambiguous and omitted) — not resolved everywhere, and not a claim that multi-account is definitely in scope.
3. **`trades` has no bot-vs-manual distinction** — surfaced as a schema gap blocking clean implementation of `FR-TRADE-5`'s audit trail, not silently absorbed into the API.
4. **AI Assistant restructured** from flat messages to nested `conversations/:id/messages`, matching `ai_assistant_conversations`/`ai_assistant_messages`'s actual 1:N shape in `05`.
5. **Added `GET /trading/decision-log`**, previously missing entirely — `bot_decision_log` existed in `05` with no Frontend-facing read path, which undercuts the audit/transparency requirements it exists to serve.
6. **Portfolio holdings has no backing table** in `05` — flagged as needing a decision (derive vs. store) rather than assumed.
7. **Reports correction:** removed `?format=` from download (format is fixed at creation per schema) and flagged that the async `pending/ready/failed` model needs a `status` column added to `05`, or should be dropped in favor of synchronous generation.
8. **Added `/admin/risk-tiers` endpoints** — `05` Section 1.3 built `risk_tier_config` specifically for Admin-driven tuning; the first draft's Admin section didn't expose it at all. Also made explicit that admin writes must log to `admin_audit_log`.

---

*Next: these open items (Section 15) either get resolved as `05_Database_Design.md` amendments (holdings, reports status, trades.origin) or get carried forward into `07_UI_UX_Guide.md` / `09_Security.md` as needed. Recommend amending `05` first, since several of `06`'s response shapes are currently blocked on it.*