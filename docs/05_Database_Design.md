# 05 — Database Design — Telos

> Read `MASTER_PROJECT_BLUEPRINT.md`, `03_Software_Requirements_Specification.md`, `04_System_Architecture.md`, and `08_Bot_Architecture.md` first. This document defines the PostgreSQL schema and Redis usage referenced in `04_System_Architecture.md` Section 3.5.

**Working assumption (flagged):** this schema assumes **one Bot instance per user per linked broker account**. `04_System_Architecture.md` Section 9 leaves the horizontal-scaling model as an open item — if Telos moves to a multi-tenant Bot service instead, `bot_instances` below stays the same shape, but how it's *processed* changes. Revisit this schema if that decision lands differently.

---

## 1. PostgreSQL — Durable Storage

**Migration tooling — settled (Phase 1 planning):** raw SQL files run by a small Node script, no ORM. Full rationale in `06_API_Specification.md` Section 3a.

### 1.1 Entity Relationship Overview

```
users ──1:1──> settings
  │
  ├──1:N──> broker_connections ──1:1──> bot_instances ──1:N──> trades
  │                                            │
  │                                            └──1:N──> bot_decision_log
  ├──1:N──> notifications
  ├──1:N──> reports
  ├──1:N──> ai_assistant_conversations ──1:N──> ai_assistant_messages
  └──(role=admin)──1:N──> admin_audit_log
```

### 1.2 Table Definitions

**`users`**
| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | |
| email | text, unique | |
| password_hash | text | never store plaintext (`FR-AUTH-1`) |
| role | enum('user','admin') | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**`broker_connections`**
| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | |
| user_id | UUID (FK → users) | |
| broker_name | text | which broker/MT5 endpoint (`FR-ONB-1`) |
| encrypted_credentials | bytea | field-level encrypted, never plaintext (`NFR-2`) |
| connection_status | enum('connected','disconnected','error') | `FR-ONB-4` |
| linked_at | timestamptz | |
| last_validated_at | timestamptz | |

**`bot_instances`**
| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | |
| user_id | UUID (FK → users) | |
| broker_connection_id | UUID (FK → broker_connections) | |
| status | enum('running','stopped','error') | `FR-TRADE-3` |
| active_strategy_mode | enum('STRATEGY_A','STRATEGY_B','HALTED') | Bot Architecture §2, §10 (Strategy B) |
| initial_balance | numeric | Bot Architecture §2 |
| active_trading_balance | numeric | Bot Architecture §2 (renamed from `current_balance`) |
| peak_equity | numeric | Bot Architecture §6 |
| current_tier | int (0–7) | Bot Architecture §3 |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**`trades`**
| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | |
| bot_instance_id | UUID (FK → bot_instances) | |
| origin | enum('bot','manual') | distinguishes bot-originated trades from `FR-TRADE-5` manual orders — both still route through the same `bot_instance_id`/execution path, this only records who decided it |
| direction | enum('BUY','SELL') | from Bot Architecture §9 Module 4 output |
| entry_price | numeric | |
| stop_price | numeric | |
| target_price | numeric | |
| exit_price | numeric, nullable | null while open |
| lot_size | numeric | set by Execution Engine (Module 7) |
| final_applied_position_risk | numeric | logged for audit, ties to `NFR-6` |
| status | enum('open','closed') | |
| opened_at | timestamptz | |
| closed_at | timestamptz, nullable | |
| pnl | numeric, nullable | |

**`bot_decision_log`** — satisfies `FR-BOT-6` / `NFR-6` (auditability)
| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | |
| bot_instance_id | UUID (FK → bot_instances) | |
| timestamp | timestamptz | |
| decision_type | enum('strategy_switch','profit_lock','macro_circuit_breaker','micro_circuit_breaker','trade_approved','trade_rejected') | |
| triggering_condition | text | human-readable reason |
| details | jsonb | full environment dictionary snapshot, per Bot Architecture §10, that produced this decision |

**`notifications`**
| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | |
| user_id | UUID (FK → users) | |
| type | enum('bot_start','bot_stop','connection_error','trading_error','strategy_switch', ...) | `FR-NOTIF-1`–`FR-NOTIF-3` |
| message | text | |
| read_status | boolean | |
| created_at | timestamptz | |

**`reports`**
| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | |
| user_id | UUID (FK → users) | |
| period_start | date | |
| period_end | date | |
| format | enum('pdf','csv') | pending confirmation, `FR-REP-2` |
| file_path | text | |
| generated_at | timestamptz | |

**`settings`**
| Column | Type | Notes |
|---|---|---|
| user_id | UUID (PK, FK → users) | |
| notification_preferences | jsonb | `FR-SET-3` |
| updated_at | timestamptz | |

**`ai_assistant_conversations`** / **`ai_assistant_messages`**
| Column | Type | Notes |
|---|---|---|
| conversation.id | UUID (PK) | |
| conversation.user_id | UUID (FK → users) | |
| conversation.created_at | timestamptz | |
| message.id | UUID (PK) | |
| message.conversation_id | UUID (FK) | |
| message.role | enum('user','assistant') | |
| message.content | text | |
| message.created_at | timestamptz | |

Scope note: this table only serves the user-facing AI Assistant (`FR-AI-1`), not the Bot's internal AI calls (Bot Architecture §9 Modules 2–4), which are not conversational and don't need this shape — kept fully separate per `04_System_Architecture.md` Section 6.

**`admin_audit_log`**
| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | |
| admin_user_id | UUID (FK → users) | |
| action | text | |
| target_user_id | UUID, nullable | |
| timestamp | timestamptz | |

### 1.3 `risk_tier_config` — Settled: Configurable Table

The Tier 0–7 matrix in `08_Bot_Architecture.md` Section 3 lives in this table rather than being hardcoded, so tier thresholds/risk ceilings can be tuned (e.g. from the Admin module) without a code deploy — chosen because the risk system is still under active iteration.

| Column | Type | Notes |
|---|---|---|
| tier | int (PK, 0–7) | |
| completed_blocks_min | int | |
| step_size | numeric | |
| base_risk | numeric | |
| max_risk_ceiling | numeric | |

### 1.4 `candidate_strategies` — New: Strategy Discovery & Validation

Tracks every strategy the Strategy Engine (`08_Bot_Architecture.md` Module 4/Section 9.4) can draw from — both the initial hand-picked pool and anything the AI discovery process proposes later. Nothing reaches `active` without passing the `FR-BOT-8` paper-trading gate.

| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | |
| name | text | e.g. "MA Crossover", "RSI Mean Reversion" |
| rule_set | jsonb | structured entry/exit conditions, market regime fit |
| description | text | plain-language summary |
| source | enum(`manual`, `ai_discovered`) | |
| status | enum(`proposed`, `paper_testing`, `active`, `rejected`) | |
| paper_trading_results | jsonb, nullable | P&L, win rate, trade count from the `FR-BOT-8` validation window |
| discovered_at | timestamptz | |
| activated_at | timestamptz, nullable | |
| reviewed_by_admin | boolean, default false | ties to the Admin visibility requirement in `08_Bot_Architecture.md` Section 9.4 — a person should see what's proposed, not just what's live |

## 2. Redis — Fast-Changing / Ephemeral State

| Key pattern | Purpose |
|---|---|
| `bot:{bot_instance_id}:status` | Cached live status (status, active_trading_balance, current tier, active_strategy_mode) for fast Dashboard reads without hitting Postgres on every tick (`04_System_Architecture.md` §5) |
| `session:{user_id}` | Session/auth cache, JWT refresh/blacklist handling |
| `ratelimit:{user_id}:{endpoint}` | API rate-limiting counters |
| `bot-events:{bot_instance_id}` (pub/sub channel) | Fanout channel so multiple backend instances all receive the same Bot events for WebSocket broadcast (`04_System_Architecture.md` §5) |
| `password_reset:{token}` (TTL-bound) | Password reset tokens (`FR-AUTH-4`, `06_API_Specification.md` Section 3) — settled during Phase 1 planning |

Redis is not the source of truth for most of the above — every other value cached here has a durable counterpart in PostgreSQL (`bot_instances`, `trades`, `bot_decision_log`) that Redis is refreshed from. **`password_reset:{token}` is the one deliberate exception:** it has no Postgres counterpart by design, since a lost/expired reset token just means the user requests a new one — no data worth durably persisting. Worth remembering as an exception rather than assuming the principle above is absolute.

## 3. Encryption & Security Notes

- `broker_connections.encrypted_credentials` — field-level encryption (e.g. AES-256), decrypted only within the Backend API/Trading Engine boundary per `04_System_Architecture.md` Section 7.
- **Settled:** key management uses an environment-variable-based key — see Section 4 for the full rationale and tradeoff.

## 4. Open Items

**Settled:**
- ~~Key management / encryption approach~~ → the encryption key lives as an environment variable (`.env`, never committed, restrictive file permissions), loaded at backend startup. This is the simplest, free option — the honest tradeoff is that the key lives on the same machine as the encrypted data it protects, which a dedicated secrets manager/KMS would avoid. Given no budget for a paid KMS and the current 5-user scale, this is the right call for now — revisit in `12_Roadmap.md` Phase 10 once scale/budget justifies a proper secrets manager.
- ~~Backup/redundancy strategy~~ → scheduled encrypted `pg_dump` exports, pushed to a **private GitHub repo** (separate from the code repo) on a regular interval. This is genuinely the cheapest option available — free, and reuses infrastructure already in place rather than requiring a new account/service. At 5-user scale the data volume is small enough that this is practical; revisit if/when dump size becomes unwieldy for git.
- ~~`risk_tier_config` table vs. hardcoded~~ → configurable table (Section 1.3).
- ~~`bot_decision_log` retention~~ → full detail kept 6 months, then archived to local compressed JSON rather than deleted.
- ~~Report file storage location~~ → local disk on the self-hosted machine (per infrastructure decision — the same PC running the Backend API/Bot stores `reports.file_path` contents directly).
- ~~Report generation: sync vs. async~~ → **synchronous.** No `status` column added — given the self-hosted, resource-constrained setup (System Architecture §8), adding an async job queue is extra infrastructure for a report-generation task that doesn't need it yet. `POST /reports` (`06_API_Specification.md`) returns the finished resource directly. Revisit only if report generation time becomes a real problem.
- ~~Portfolio "current holdings" storage~~ → **derived, not stored.** No `holdings` table. `GET /portfolio/holdings` (`06_API_Specification.md`) computes net position per instrument from open `trades` rows at query time — avoids a second source of truth that could drift from `trades`, and there's no `trades` volume yet where the computation would be a performance problem.

---

*Next: `06_API_Specification.md` will define the REST endpoints and WebSocket events that read/write these tables.*