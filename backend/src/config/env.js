require('dotenv').config();

const PORT = Number(process.env.PORT) || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

const DATABASE_URL = process.env.DATABASE_URL || '';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const JWT_SECRET = process.env.JWT_SECRET || '';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

const PASSWORD_RESET_TTL_SECONDS = Number(process.env.PASSWORD_RESET_TTL_SECONDS) || 3600;
const PASSWORD_RESET_BASE_URL =
  process.env.PASSWORD_RESET_BASE_URL || 'http://localhost:5173/reset-password';

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || 'noreply@telos.local';

const BCRYPT_ROUNDS = 12;
const LOGIN_RATE_LIMIT_MAX = 5;
const LOGIN_RATE_LIMIT_WINDOW_SECONDS = 15 * 60;

/** Base64-encoded 32-byte AES-256 key for broker_connections.encrypted_credentials */
const BROKER_CREDENTIALS_KEY = process.env.BROKER_CREDENTIALS_KEY || '';

/** Local Python MT5 connector (04 System Architecture §3.6) */
const MT5_CONNECTOR_URL = process.env.MT5_CONNECTOR_URL || 'http://127.0.0.1:3100';

/** Local directory for synchronous report files (05 §4) */
const REPORTS_DIR =
  process.env.REPORTS_DIR || require('path').join(__dirname, '..', '..', 'storage', 'reports');

/**
 * Phase 7.8 — risk_tier_config live-read cache TTL. Matches Module 2's
 * 15-30s slow-path convention (market-intelligence.service.js's default
 * is 20s) rather than inventing a different cadence for tiers.
 */
const RISK_TIER_CONFIG_CACHE_TTL_SECONDS =
  Number(process.env.RISK_TIER_CONFIG_CACHE_TTL_SECONDS) || 20;

/**
 * Site-wide access gate (Phase 8.5 / 09_Security.md).
 * Both must be set for the gate to enforce; production refuses to start
 * without them. ACCESS_GATE_SECRET is independent of JWT_SECRET.
 */
const ACCESS_GATE_PHRASE = process.env.ACCESS_GATE_PHRASE || '';
const ACCESS_GATE_SECRET = process.env.ACCESS_GATE_SECRET || '';
const ACCESS_GATE_TTL_DAYS = Number(process.env.ACCESS_GATE_TTL_DAYS) || 30;
const ACCESS_GATE_COOKIE_NAME = process.env.ACCESS_GATE_COOKIE_NAME || 'telos_gate';

/**
 * Option 2 (real order placement) Layer 1 — the deploy-level kill
 * switch. Deliberately strict, exact-string parsing, not a general
 * truthy check: only the literal 'true' enables it. Any typo ('True',
 * '1', 'yes') or omission resolves to disabled — the safe-direction
 * foot-gun, since a mistake here should always land on "still off,"
 * never "accidentally on." See execution-mode.js / CHANGELOG.md.
 */
const REAL_TRADING_ENABLED = process.env.REAL_TRADING_ENABLED === 'true';

/**
 * Option 2 Increment E (E1 verification strategy) — non-production
 * dispatch bypass so the real-mode *methods* can be exercised against
 * a MetaQuotes-Demo account without real capital. Strict exact-string
 * `'true'` only, same parsing as REAL_TRADING_ENABLED.
 *
 * This flag controls dispatch only (which BotRuntime methods run). It
 * must NEVER alter `expectedAccountType` passed to placeOrder/
 * closeOrder — Layer 0 always sees the true detected account type
 * (`demo` under E1 testing). Production refuses to boot if this env
 * var is present at all (any value); see
 * assertRealTradingDemoBypassAtStartup.
 */
const REAL_TRADING_ALLOW_DEMO = process.env.REAL_TRADING_ALLOW_DEMO === 'true';

/**
 * Pure check so unit tests can cover every combination without
 * reloading this module. `allowDemoEnvPresent` is true when the env
 * var exists in the process environment at all — including empty
 * string or `'false'` — not merely when the parsed boolean is true.
 */
function assertRealTradingDemoBypassAllowed({ nodeEnv, allowDemoEnvPresent }) {
  if (nodeEnv === 'production' && allowDemoEnvPresent) {
    throw new Error(
      'REAL_TRADING_ALLOW_DEMO must not be set when NODE_ENV=production ' +
        '(E1 demo-dispatch bypass is non-production only; remove the ' +
        'variable entirely from the production environment)'
    );
  }
}

/**
 * Production boot tripwire — mandatory *absence* of
 * REAL_TRADING_ALLOW_DEMO (inverse of ACCESS_GATE_*'s mandatory
 * presence). Called from index.js alongside assertGateConfigAtStartup.
 */
function assertRealTradingDemoBypassAtStartup() {
  assertRealTradingDemoBypassAllowed({
    nodeEnv: NODE_ENV,
    allowDemoEnvPresent: process.env.REAL_TRADING_ALLOW_DEMO !== undefined,
  });
}

module.exports = {
  PORT,
  NODE_ENV,
  CORS_ORIGIN,
  DATABASE_URL,
  REDIS_URL,
  JWT_SECRET,
  JWT_EXPIRES_IN,
  PASSWORD_RESET_TTL_SECONDS,
  PASSWORD_RESET_BASE_URL,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_FROM,
  BCRYPT_ROUNDS,
  LOGIN_RATE_LIMIT_MAX,
  LOGIN_RATE_LIMIT_WINDOW_SECONDS,
  BROKER_CREDENTIALS_KEY,
  MT5_CONNECTOR_URL,
  REPORTS_DIR,
  RISK_TIER_CONFIG_CACHE_TTL_SECONDS,
  ACCESS_GATE_PHRASE,
  ACCESS_GATE_SECRET,
  ACCESS_GATE_TTL_DAYS,
  ACCESS_GATE_COOKIE_NAME,
  REAL_TRADING_ENABLED,
  REAL_TRADING_ALLOW_DEMO,
  assertRealTradingDemoBypassAllowed,
  assertRealTradingDemoBypassAtStartup,
  isProduction: NODE_ENV === 'production',
};
