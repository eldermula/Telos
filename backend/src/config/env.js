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
 * Synthetics real-dispatch Layer 1 — independent kill switch from
 * forex REAL_TRADING_ENABLED. Exact-string 'true' only; default off.
 */
const SYNTHETIC_REAL_TRADING_ENABLED =
  process.env.SYNTHETIC_REAL_TRADING_ENABLED === 'true';

/**
 * Synthetics Layer 2 confirm-live demo bypass — testing only.
 * Exact-string 'true' only; default off. When set, POST
 * /bot/synthetic/confirm-live may succeed against a demo
 * broker_connections.account_type (Deriv-Demo walkthroughs).
 * Must be off before any real-account rollout. Production refuses
 * to boot if this env var is present at all (any value).
 */
const SYNTHETIC_ALLOW_DEMO_CONFIRM =
  process.env.SYNTHETIC_ALLOW_DEMO_CONFIRM === 'true';

/**
 * Synthetics testing-only — manual real-order test dispatch.
 * Exact-string 'true' only; default off. Gates
 * POST /bot/synthetic/test-dispatch-real, which bypasses strategy
 * selection only and still runs stop/target, clampLotSize, placeOrder,
 * DB insert, and monitoring through the normal real path. Production
 * refuses to boot if this env var is present at all.
 */
const SYNTHETIC_ALLOW_MANUAL_TEST_TRADE =
  process.env.SYNTHETIC_ALLOW_MANUAL_TEST_TRADE === 'true';

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
 * Option 2 E.3 — hard lot-size ceiling for real orders, independent of
 * APIRS risk-%. Approved default 0.01 (one micro lot) for first proofs.
 */
const REAL_MAX_LOT = Number(process.env.REAL_MAX_LOT) || 0.01;

/**
 * Option 2 E.3 — max age of broker_connections.last_validated_at before
 * a real order is refused. Approved default: 24 hours.
 */
const REAL_CONNECTION_MAX_AGE_HOURS =
  Number(process.env.REAL_CONNECTION_MAX_AGE_HOURS) || 24;

/**
 * Module 3 — real Claude headline classification kill switch.
 * Exact-string 'true' only (same foot-gun direction as REAL_TRADING_ENABLED).
 * Default off everywhere, including production.
 */
const NEWS_LLM_ENABLED = process.env.NEWS_LLM_ENABLED === 'true';

/**
 * Crypto Increment B — parallel crypto headline Claude kill switch.
 * Exact-string 'true' only. Default off. Independent of NEWS_LLM_ENABLED
 * so forex soft-launch monitoring is never coupled to crypto LLM spend.
 */
const CRYPTO_NEWS_LLM_ENABLED = process.env.CRYPTO_NEWS_LLM_ENABLED === 'true';

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
  assertSyntheticDemoConfirmBypassAllowed({
    nodeEnv: NODE_ENV,
    allowDemoEnvPresent: process.env.SYNTHETIC_ALLOW_DEMO_CONFIRM !== undefined,
  });
  assertSyntheticManualTestTradeBypassAllowed({
    nodeEnv: NODE_ENV,
    allowDemoEnvPresent: process.env.SYNTHETIC_ALLOW_MANUAL_TEST_TRADE !== undefined,
  });
}

/**
 * Same production foot-gun as REAL_TRADING_ALLOW_DEMO: the variable
 * must be entirely absent under NODE_ENV=production.
 */
function assertSyntheticDemoConfirmBypassAllowed({ nodeEnv, allowDemoEnvPresent }) {
  if (nodeEnv === 'production' && allowDemoEnvPresent) {
    throw new Error(
      'SYNTHETIC_ALLOW_DEMO_CONFIRM must not be set when NODE_ENV=production ' +
        '(synthetics demo confirm-live bypass is testing-only; remove the ' +
        'variable entirely before real-account rollout)'
    );
  }
}

/**
 * Production foot-gun for manual test-dispatch — must be entirely
 * absent under NODE_ENV=production.
 */
function assertSyntheticManualTestTradeBypassAllowed({
  nodeEnv,
  allowDemoEnvPresent,
}) {
  if (nodeEnv === 'production' && allowDemoEnvPresent) {
    throw new Error(
      'SYNTHETIC_ALLOW_MANUAL_TEST_TRADE must not be set when NODE_ENV=production ' +
        '(manual synthetics real test-dispatch is testing-only; remove the ' +
        'variable entirely before real-account rollout)'
    );
  }
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
  SYNTHETIC_REAL_TRADING_ENABLED,
  SYNTHETIC_ALLOW_DEMO_CONFIRM,
  SYNTHETIC_ALLOW_MANUAL_TEST_TRADE,
  REAL_TRADING_ALLOW_DEMO,
  REAL_MAX_LOT,
  REAL_CONNECTION_MAX_AGE_HOURS,
  NEWS_LLM_ENABLED,
  CRYPTO_NEWS_LLM_ENABLED,
  assertRealTradingDemoBypassAllowed,
  assertRealTradingDemoBypassAtStartup,
  assertSyntheticDemoConfirmBypassAllowed,
  assertSyntheticManualTestTradeBypassAllowed,
  isProduction: NODE_ENV === 'production',
};
