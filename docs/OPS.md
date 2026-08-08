# Telos — Operations (Phase 8)

Operational runbook for the self-hosted stack (`04_System_Architecture.md` §8).
This is the place for "how to keep it running," not product design.

---

## 1. Encrypted Postgres backups (Phase 8.2)

Settled in `05_Database_Design.md` §4 / `09_Security.md` §5: daily encrypted
`pg_dump` → **private GitHub repo separate from this code repo**.

### One-time setup

1. Create a **private** empty GitHub repo (e.g. `eldermula/telos-backups`).
   Do **not** put this under the Telos code repo.
2. Clone it somewhere the backup Task Scheduler can reach, e.g.
   `C:\Users\USER\Desktop\Projects\telos-backups`.
3. Generate a backup encryption key **distinct from** `BROKER_CREDENTIALS_KEY`:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

4. Add to `backend/.env` (never commit):

   ```
   BACKUP_ENCRYPTION_KEY=<the-base64-above>
   BACKUP_REPO_DIR=C:\Users\USER\Desktop\Projects\telos-backups
   # optional:
   # BACKUP_RETENTION_COUNT=14
   # BACKUP_SKIP_PUSH=1
   ```

5. Confirm git push works non-interactively from that clone (GitHub Desktop
   auth, or a fine-scoped PAT with `contents:write` on the backup repo only).

### Run once by hand

From the Telos repo root (Docker Postgres must be up):

```bash
node database/scripts/backup.js
```

Expect `BACKUP_PASS`. A `telos-YYYYMMDDTHHMMSSZ.sql.enc` file appears in
`BACKUP_REPO_DIR`, gets committed, and (unless `BACKUP_SKIP_PUSH=1`) pushed.

### Decrypt / restore (manual, after review)

```bash
node database/scripts/restore-backup.js path\to\telos-….sql.enc --out restore.sql
# Review restore.sql, then load into a target DB — e.g.:
# Get-Content restore.sql | docker compose exec -T postgres psql -U telos -d telos
```

Broker credentials inside the dump remain field-level ciphertext; decrypting
the `.sql.enc` wrapper does **not** reveal plaintext MT5 passwords without
also having `BROKER_CREDENTIALS_KEY`.

### Schedule (Windows Task Scheduler)

1. Open Task Scheduler → Create Task.
2. Trigger: Daily, pick a quiet hour (e.g. 03:00 local).
3. Action → Start a program:
   - Program: `node`
   - Arguments: `database\scripts\backup.js`
   - Start in: `C:\Users\USER\Desktop\Projects\forextradebot`
4. Use the same Windows user that can reach Docker Desktop and the backup
   repo's git credentials.
5. Settings: "Run task as soon as possible after a scheduled start is missed."

Smoke-test the scheduled task with "Run" once and confirm a new commit lands
in the private backup repo.

---

## 2. Uptime monitoring (Phase 8.4)

The Backend already exposes a lightweight liveness probe:

- `GET /health` → `{ "status": "ok" }` (root, outside `/api/v1`)
- Deeper Postgres+Redis check: `GET /api/v1/admin/system-health` (admin JWT)

External monitoring should hit **`GET /health`** through the Cloudflare
Tunnel URL — not the admin endpoint (no JWT in a free monitor) and not a
deep dependency check (a Redis blip shouldn't page you the same way a
dead Node process should).

### Recommended free setup (UptimeRobot)

No credit card required on the free tier:

1. Create an [UptimeRobot](https://uptimerobot.com/) account.
2. Add Monitor → **HTTP(s)**:
   - URL: `https://<your-cloudflare-tunnel-hostname>/health`
   - Interval: 5 minutes (free-tier default)
   - Alert when: keyword `ok` missing, or HTTP ≠ 200
3. Alert contact: your email (and optionally Telegram/Discord webhook).
4. Once the Tunnel hostname changes (Quick Tunnel → named domain), update
   the monitor URL.

Alternatives that also fit the $0 constraint: Better Stack (free forever
tier), or Cloudflare's own health checks if/when you're on a plan that
includes them. Pick one; don't run three.

### What this does / doesn't cover

- **Does:** notice the Backend process is down or unreachable via the Tunnel.
- **Doesn't:** notice MT5 terminal disconnects, hotspot drops that the Tunnel
  briefly survives, or Postgres itself being unhealthy while Node still
  answers `/health`. Use Admin → System Health and Notifications
  (`connection.error`) for those — already in place.

---

## 3. Cloudflare free-tier WAF (reminder)

`09_Security.md` §4 recommends enabling Cloudflare's free WAF / bot-fight
rules in front of the Tunnel. Dashboard-only — no code. Do it when the
named Tunnel hostname is stable.

---

## 4. Dependency alerts (Phase 8.3)

Handled in-repo:

- `.github/dependabot.yml` — weekly npm alerts for `backend/`, `frontend/`,
  and the bot packages.
- `.github/workflows/npm-audit.yml` — `npm audit --audit-level=high` on
  push/PR for the same directories.

Dependabot PRs still need a human review before merging, especially anything
that touches `express`, `jsonwebtoken`, `bcrypt`, or `pg`.

---

## 5. Git hooks (CHANGELOG truncate guard)

`docs/CHANGELOG.md` once landed empty mid-session. Commits are gated by:

```bash
# once per clone (from repo root)
git config core.hooksPath .githooks
```

`.githooks/pre-commit` runs `node scripts/check-changelog-size.js`, which
refuses the commit if CHANGELOG is empty or shrank by more than 50% vs HEAD.
Manual check: `node scripts/check-changelog-size.js`.

---

## 6. Module 3 LLM cost watch (first week after enable)

There is **no separate staging stack** — this self-hosted Backend is the
production API (`TelosBackend` → Tunnel → `api.telostrust.com`). Soft-launch
is: flip `NEWS_LLM_ENABLED=true` + set `ANTHROPIC_API_KEY` in `backend/.env`,
restart the Backend, and observe spend for a week before treating the path
as "safe to leave indefinitely."

### Daily check (first 7 days)

From the repo root (Backend machine, Redis up):

```bash
node backend/scripts/news-llm-usage.js
```

Record `current_month.estimated_cost_usd` (and `calls` / tokens). Also on
admin `GET /api/v1/admin/system-health` → `news_llm.usage`.

### What "real days" requires

Module 3 only bills when a **running bot** drives Selection →
`getNewsIntelligence()` on a cache miss **and** there are new (unseen)
headlines. If every bot is stopped, the usage script will correctly show
~$0 — that is not a cost proof, it is an idle system. Keep at least one
paper bot running during the watch week.

### Kill switch

Set `NEWS_LLM_ENABLED=false` (or remove it) in `backend/.env` and restart
`TelosBackend`. Stub classification resumes immediately; no code deploy.
