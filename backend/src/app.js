const express = require('express');
const cors = require('cors');
const { CORS_ORIGIN } = require('./config/env');
const healthRouter = require('./routes/health');
const authRouter = require('./routes/auth.routes');
const { errorHandler } = require('./middleware/error-handler');

const app = express();

app.set('trust proxy', 1);
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

app.use(healthRouter);
app.use('/api/v1/auth', authRouter);

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
