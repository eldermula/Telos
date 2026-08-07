const express = require('express');
const cors = require('cors');
const { CORS_ORIGIN } = require('./config/env');
const healthRouter = require('./routes/health');
const authRouter = require('./routes/auth.routes');
const brokerConnectionsRouter = require('./routes/broker-connections.routes');
const tradingRouter = require('./routes/trading.routes');
const settingsRouter = require('./routes/settings.routes');
const notificationsRouter = require('./routes/notifications.routes');
const portfolioRouter = require('./routes/portfolio.routes');
const analyticsRouter = require('./routes/analytics.routes');
const { errorHandler } = require('./middleware/error-handler');

const app = express();

app.set('trust proxy', 1);
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

app.use(healthRouter);
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/broker-connections', brokerConnectionsRouter);
app.use('/api/v1/trading', tradingRouter);
app.use('/api/v1/settings', settingsRouter);
app.use('/api/v1/notifications', notificationsRouter);
app.use('/api/v1/portfolio', portfolioRouter);
app.use('/api/v1/analytics', analyticsRouter);

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
