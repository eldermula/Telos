#!/usr/bin/env node
'use strict';

/**
 * Refuse to proceed if docs/CHANGELOG.md shrank by more than 50% vs
 * HEAD (or is empty while HEAD had content). Catches silent truncates
 * before they land in a commit — see Option 2 E.5 incident.
 *
 * Usage:
 *   node scripts/check-changelog-size.js
 * Exit 0 = ok, exit 1 = blocked.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const REL = 'docs/CHANGELOG.md';
const ABS = path.join(ROOT, REL);
const MAX_DROP_RATIO = 0.5;

function resolveGitBin() {
  if (process.env.GIT_BIN) return process.env.GIT_BIN;
  const candidates = [
    'git',
    'C:\\Program Files\\Git\\cmd\\git.exe',
    'C:\\Program Files\\Git\\bin\\git.exe',
    path.join(
      process.env.LOCALAPPDATA || '',
      'GitHubDesktop',
      'app-3.6.3',
      'resources',
      'app',
      'git',
      'cmd',
      'git.exe'
    ),
  ];
  for (const bin of candidates) {
    if (!bin) continue;
    try {
      execFileSync(bin, ['--version'], { stdio: 'ignore' });
      return bin;
    } catch {
      // try next
    }
  }
  return null;
}

function headSizeBytes() {
  const git = resolveGitBin();
  if (!git) return null;
  try {
    const out = execFileSync(git, ['show', `HEAD:${REL}`], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 20 * 1024 * 1024,
    });
    return Buffer.byteLength(out);
  } catch {
    // No HEAD or file not in HEAD yet — nothing to compare against.
    return null;
  }
}

function main() {
  if (!fs.existsSync(ABS)) {
    console.error(`[check-changelog-size] missing ${REL}`);
    process.exit(1);
  }

  const current = fs.statSync(ABS).size;
  const previous = headSizeBytes();

  if (previous == null) {
    if (current === 0) {
      console.error(`[check-changelog-size] ${REL} is empty (no HEAD baseline)`);
      process.exit(1);
    }
    console.log(`[check-changelog-size] ok (${current} bytes, no HEAD baseline)`);
    process.exit(0);
  }

  if (current === 0 && previous > 0) {
    console.error(
      `[check-changelog-size] BLOCKED: ${REL} is empty (was ${previous} bytes at HEAD)`
    );
    process.exit(1);
  }

  if (previous > 0 && current < previous * (1 - MAX_DROP_RATIO)) {
    const dropPct = (((previous - current) / previous) * 100).toFixed(1);
    console.error(
      `[check-changelog-size] BLOCKED: ${REL} shrank ${dropPct}% ` +
        `(${previous} → ${current} bytes; threshold ${MAX_DROP_RATIO * 100}%)`
    );
    process.exit(1);
  }

  console.log(`[check-changelog-size] ok (${current} bytes; HEAD ${previous})`);
  process.exit(0);
}

main();
