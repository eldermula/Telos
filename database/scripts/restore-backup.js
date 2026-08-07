'use strict';

/**
 * Decrypt a Telos `.sql.enc` backup produced by `database/scripts/backup.js`
 * to stdout (or to --out path). Does not run the restore into Postgres —
 * pipe or load the resulting SQL yourself after reviewing it.
 *
 * Usage:
 *   node database/scripts/restore-backup.js path/to/telos-….sql.enc > restore.sql
 *   node database/scripts/restore-backup.js path/to/telos-….sql.enc --out restore.sql
 *
 * Requires BACKUP_ENCRYPTION_KEY in backend/.env (same key used to encrypt).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const backendModules = path.join(__dirname, '..', '..', 'backend', 'node_modules');
require(path.join(backendModules, 'dotenv')).config({
  path: path.join(__dirname, '..', '..', 'backend', '.env'),
});

const BACKUP_ENCRYPTION_KEY = process.env.BACKUP_ENCRYPTION_KEY || '';

function fail(msg) {
  console.error(`[restore-backup] ${msg}`);
  process.exit(1);
}

function getKey() {
  if (!BACKUP_ENCRYPTION_KEY) fail('BACKUP_ENCRYPTION_KEY is not set');
  let key;
  try {
    key = Buffer.from(BACKUP_ENCRYPTION_KEY, 'base64');
  } catch {
    fail('BACKUP_ENCRYPTION_KEY is not valid base64');
  }
  if (key.length !== 32) fail('BACKUP_ENCRYPTION_KEY must decode to 32 bytes');
  return key;
}

function decrypt(blob, key) {
  if (blob.length < 12 + 16 + 1) fail('file too short to be a valid .sql.enc');
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const encrypted = blob.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

function main() {
  const args = process.argv.slice(2);
  const inPath = args.find((a) => !a.startsWith('--'));
  if (!inPath) fail('usage: node database/scripts/restore-backup.js <file.sql.enc> [--out path]');
  const outIdx = args.indexOf('--out');
  const outPath = outIdx >= 0 ? args[outIdx + 1] : null;
  if (outIdx >= 0 && !outPath) fail('--out requires a path');

  const plain = decrypt(fs.readFileSync(inPath), getKey());
  if (outPath) {
    fs.writeFileSync(outPath, plain);
    console.error(`[restore-backup] wrote ${outPath} (${plain.length} bytes)`);
  } else {
    process.stdout.write(plain);
  }
}

main();
