'use strict';

const express = require('express');
const controller = require('../controllers/analytics.controller');
const { authenticate } = require('../middleware/authenticate');

const router = express.Router();

router.use(authenticate);

router.get('/trading-metrics', controller.getTradingMetrics);
router.get('/business-metrics', controller.getBusinessMetrics);

module.exports = router;
