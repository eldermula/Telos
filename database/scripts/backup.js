'use strict';

/**
 * Telos encrypted Postgres backup — Phase 8.2
 *
 * Settled destination (`05_Database_Design.md` §4 / `09_Security.md` §5/§11):
 * scheduled encrypted `pg_dump` exports, pushed to a **private GitHub repo
 * separate from this code repo**.
 *
 * Why the dump itself is encrypted (not just field-level encryption of
 * `encrypted_credentials`):
 *   - Broker credentials stay ciphertext inside any dump (field-level AES
 *     already satisfies `09` §5's "must remain encrypted in the backup").
 *   - Wrapping the whole dump adds a second layer so non-credential rows
 *     (users, trades, decision log) aren't plaintext to anyone with GitHub
 *     access alone. One compromised private-repo collaborator shouldn't
 *     equal a cleartext Postgres dump.
 *
 * Usage (from repo root):
 *   node database/scripts/backup.js
 *
 * Required env (in `backend/.env`, never committed):
 *   BACKUP_ENCRYPTION_KEY  — base64 of 32 random bytes (same shape as
 *                            BROKER_CREDENTIALS_KEY; keep them DIFFERENT)
 *   BACKUP_REPO_DIR        — absolute path to a local clone of the private
 *                            backup repo (must already exist + have a remote)
 *
 * Optional:
 *   BACKUP_RETENTION_COUNT — how many .sql.enc files to keep (default 14)
 *   BACKUP_SKIP_PUSH=1     — write + commit locally, don't `git push`
 *   BACKUP_DOCKER_SERVICE  — compose service name (default `postgres`)
 *
 * Restore (separate helper):
 *   node database/scripts/restore-backup.js path/to/file.sql.enc > dump.sql
 *   # then: docker compose exec -T postgres psql -U telos -d telos < dump.sql
 *
 * Schedule: Windows Task Scheduler daily — see docs/OPS.md.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const os = require('os');

const backendModules = path.join(__dirname, '..', '..', 'backend', 'node_modules');
require(path.join(backendModules, 'dotenv')).config({
  path: path.join(__dirname, '..', '..', 'backend', '.env'),
});

const REPO_ROOT = path.join(__dirname, '..', '..');
const BACKUP_ENCRYPTION_KEY = process.env.BACKUP_ENCRYPTION_KEY || '';
const BACKUP_REPO_DIR = process.env.BACKUP_REPO_DIR || '';
const BACKUP_RETENTION_COUNT = Number(process.env.BACKUP_RETENTION_COUNT) || 14;
const BACKUP_SKIP_PUSH = process.env.BACKUP_SKIP_PUSH === '1';
const BACKUP_DOCKER_SERVICE = process.env.BACKUP_DOCKER_SERVICE || 'postgres';

function fail(msg) {
  console.error(`[backup] ${msg}`);
  process.exit(1);
}

function getKey() {
  if (!BACKUP_ENCRYPTION_KEY) {
    fail('BACKUP_ENCRYPTION_KEY is not set in backend/.env');
  }
  let key;
  try {
    key = Buffer.from(BACKUP_ENCRYPTION_KEY, 'base64');
  } catch {
    fail('BACKUP_ENCRYPTION_KEY is not valid base64');
  }
  if (key.length !== 32) {
    fail('BACKUP_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256)');
  }
  return key;
}

/**
 * Wire format (same shape as credential-crypto.service.js):
 * [12-byte IV][16-byte auth tag][ciphertext]
 */
function encryptDump(plaintextBuf, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintextBuf), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    encoding: 'buffer',
    maxBuffer: 512 * 1024 * 1024,
    ...opts,
  });
  if (result.error) {
    fail(`${cmd} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = (result.stderr || Buffer.alloc(0)).toString('utf8').trim();
    fail(`${cmd} ${args.join(' ')} exited ${result.status}${stderr ? `: ${stderr}` : ''}`);
  }
  return result;
}

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function pruneOldBackups(dir, keepCount) {
  const files = fs
    .readdirSync(dir)
    .filter((name) => /^telos-\d{8}T\d{6}Z\.sql\.enc$/.test(name))
    .sort()
    .reverse();
  const toDelete = files.slice(keepCount);
  for (const name of toDelete) {
    fs.unlinkSync(path.join(dir, name));
    console.log(`[backup] pruned ${name}`);
  }
  return toDelete.length;
}

function main() {
  if (!BACKUP_REPO_DIR) {
    fail('BACKUP_REPO_DIR is not set — point it at a local clone of the private backup repo');
  }
  if (!fs.existsSync(BACKUP_REPO_DIR)) {
    fail(`BACKUP_REPO_DIR does not exist: ${BACKUP_REPO_DIR}`);
  }
  if (!fs.existsSync(path.join(BACKUP_REPO_DIR, '.git'))) {
    fail(`BACKUP_REPO_DIR is not a git repo: ${BACKUP_REPO_DIR}`);
  }

  const key = getKey();
  const ts = stamp();
  const outName = `telos-${ts}.sql.enc`;
  const outPath = path.join(BACKUP_REPO_DIR, outName);
  const tmpPlain = path.join(os.tmpdir(), `telos-backup-${ts}.sql`);

  console.log(`[backup] dumping via docker compose service "${BACKUP_DOCKER_SERVICE}"…`);
  // Plain SQL (not custom -Fc) so openssl/node decryption yields a
  // readable restore stream. Content includes already-ciphertext
  // broker_connections.encrypted_credentials BYTEA — field-level
  // encryption is preserved by construction.
  const dump = run(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      BACKUP_DOCKER_SERVICE,
      'pg_dump',
      '-U',
      'telos',
      '-d',
      'telos',
      '--no-owner',
      '--no-acl',
    ],
    { cwd: REPO_ROOT }
  );

  fs.writeFileSync(tmpPlain, dump.stdout);
  console.log(`[backup] plain dump ${dump.stdout.length} bytes (temp, will delete)`);

  const ciphertext = encryptDump(dump.stdout, key);
  fs.writeFileSync(outPath, ciphertext);
  fs.unlinkSync(tmpPlain);
  console.log(`[backup] wrote ${outName} (${ciphertext.length} bytes, AES-256-GCM)`);

  pruneOldBackups(BACKUP_REPO_DIR, BACKUP_RETENTION_COUNT);

  run('git', ['-C', BACKUP_REPO_DIR, 'add', '-A']);
  const status = run('git', ['-C', BACKUP_REPO_DIR, 'status', '--porcelain']);
  if (!status.stdout.toString('utf8').trim()) {
    console.log('[backup] nothing new to commit (identical to last?) — done');
    return;
  }
  // Identity for the commit only — does not write to git config. Override
  // via BACKUP_GIT_NAME / BACKUP_GIT_EMAIL if you want a real address.
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: process.env.BACKUP_GIT_NAME || 'telos-backup',
    GIT_AUTHOR_EMAIL: process.env.BACKUP_GIT_EMAIL || 'backup@telos.local',
    GIT_COMMITTER_NAME: process.env.BACKUP_GIT_NAME || 'telos-backup',
    GIT_COMMITTER_EMAIL: process.env.BACKUP_GIT_EMAIL || 'backup@telos.local',
  };
  run(
    'git',
    ['-C', BACKUP_REPO_DIR, 'commit', '-m', `telos backup ${ts}`],
    { env: gitEnv }
  );
  console.log(`[backup] committed ${outName}`);

  if (BACKUP_SKIP_PUSH) {
    console.log('[backup] BACKUP_SKIP_PUSH=1 — skipping git push');
  } else {
    run('git', ['-C', BACKUP_REPO_DIR, 'push']);
    console.log('[backup] pushed to remote');
  }

  console.log('BACKUP_PASS');
}

main();
