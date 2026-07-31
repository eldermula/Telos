const express = require('express');
const cors = require('cors');
const { CORS_ORIGIN } = require('./config/env');
const healthRouter = require('./routes/health');
const { errorHandler } = require('./middleware/error-handler');

const app = express();

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

app.use(healthRouter);

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
