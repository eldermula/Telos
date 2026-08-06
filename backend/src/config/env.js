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
  isProduction: NODE_ENV === 'production',
};
