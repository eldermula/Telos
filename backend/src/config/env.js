require('dotenv').config();

const PORT = Number(process.env.PORT) || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

module.exports = {
  PORT,
  NODE_ENV,
  CORS_ORIGIN,
  isProduction: NODE_ENV === 'production',
};
