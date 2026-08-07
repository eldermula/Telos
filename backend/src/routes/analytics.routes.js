'use strict';

const express = require('express');
const controller = require('../controllers/analytics.controller');
const { authenticate } = require('../middleware/authenticate');
const { rateLimit } = require('../middleware/rate-limit');

const router = express.Router();

router.use(authenticate);

router.get('/trading-metrics', rateLimit.read(), controller.getTradingMetrics);
router.get('/business-metrics', rateLimit.read(), controller.getBusinessMetrics);

module.exports = router;
