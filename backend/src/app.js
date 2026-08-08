const express = require('express');
const cors = require('cors');
const { CORS_ORIGIN } = require('./config/env');
const healthRouter = require('./routes/health');
const accessGateRouter = require('./routes/access-gate.routes');
const authRouter = require('./routes/auth.routes');
const brokerConnectionsRouter = require('./routes/broker-connections.routes');
const tradingRouter = require('./routes/trading.routes');
const cryptoBotRouter = require('./routes/crypto-bot.routes');
const syntheticBotRouter = require('./routes/synthetic-bot.routes');
const settingsRouter = require('./routes/settings.routes');
const notificationsRouter = require('./routes/notifications.routes');
const portfolioRouter = require('./routes/portfolio.routes');
const analyticsRouter = require('./routes/analytics.routes');
const reportsRouter = require('./routes/reports.routes');
const adminRouter = require('./routes/admin.routes');
const assistantRouter = require('./routes/assistant.routes');
const { requireAccessGate } = require('./middleware/require-access-gate');
const { errorHandler } = require('./middleware/error-handler');

const app = express();

app.set('trust proxy', 1);
// credentials: true — required for the access-gate httpOnly cookie to
// round-trip cross-origin (Vercel frontend → Tunnel API). Origin stays
// a single configured value, never a wildcard (09 §4).
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json());

app.use(healthRouter);

// Gate endpoints mount BEFORE the requireAccessGate middleware so
// verify/status stay reachable without a cookie. GET /health above
// is outside /api/v1 and is never gated (uptime — Phase 8.4).
app.use('/api/v1/access-gate', accessGateRouter);
app.use('/api/v1', requireAccessGate);

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/broker-connections', brokerConnectionsRouter);
app.use('/api/v1/trading', tradingRouter);
app.use('/api/v1/bot/crypto', cryptoBotRouter);
app.use('/api/v1/bot/synthetic', syntheticBotRouter);
app.use('/api/v1/settings', settingsRouter);
app.use('/api/v1/notifications', notificationsRouter);
app.use('/api/v1/portfolio', portfolioRouter);
app.use('/api/v1/analytics', analyticsRouter);
app.use('/api/v1/reports', reportsRouter);
app.use('/api/v1/admin', adminRouter);
app.use('/api/v1/assistant', assistantRouter);

app.use((req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'Route not found',
      details: {},
    },
  });
});

app.use(errorHandler);

module.exports = app;
