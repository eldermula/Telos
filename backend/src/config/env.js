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
 * M5 PAPER-ONLY EXPERIMENT real-dispatch Layer 1 (docs/14_M5_Forex_Paper_Experiment.md)
 * — independent kill switch from forex REAL_TRADING_ENABLED and
 * SYNTHETIC_REAL_TRADING_ENABLED. Exact-string 'true' only; default off
 * everywhere, including production. This is the master switch for the
 * separate m5-real-dispatch.js/m5-real-harness.js modules only — it has
 * no effect on the M5 paper harness (m5-paper-harness.js), which cannot
 * place real orders regardless of any flag (see that file's header).
 */
const M5_REAL_TRADING_ENABLED = process.env.M5_REAL_TRADING_ENABLED === 'true';

/**
 * XAUUSD VWAP p90 LIVE strategy Layer 1 (docs/17_XAU_VWAP_Live_Strategy.md)
 * — independent kill switch from forex / synthetic / M5 real flags.
 * Exact-string 'true' only; default off. Master switch for
 * xau-vwap-live-dispatch.js / xau-vwap-live-harness.js only.
 */
const XAU_VWAP_LIVE_TRADING_ENABLED = process.env.XAU_VWAP_LIVE_TRADING_ENABLED === 'true';

/**
 * Option 2 E.3 — hard lot-size ceiling for real orders, independent of
 * APIRS risk-%. Approved default 1.00 (raised from 0.01 after Deriv
 * re-verification — still below broker volume_max of 20 FX / 10 XAU).
 */
const REAL_MAX_LOT = Number(process.env.REAL_MAX_LOT) || 1;

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
  M5_REAL_TRADING_ENABLED,
  XAU_VWAP_LIVE_TRADING_ENABLED,
  REAL_MAX_LOT,
  REAL_CONNECTION_MAX_AGE_HOURS,
  NEWS_LLM_ENABLED,
  CRYPTO_NEWS_LLM_ENABLED,
  isProduction: NODE_ENV === 'production',
};
