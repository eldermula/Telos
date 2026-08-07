'use strict';

const express = require('express');
const controller = require('../controllers/portfolio.controller');
const { authenticate } = require('../middleware/authenticate');
const { rateLimit } = require('../middleware/rate-limit');

const router = express.Router();

router.use(authenticate);

router.get('/holdings', rateLimit.read(), controller.getHoldings);
router.get('/performance', rateLimit.read(), controller.getPerformance);

module.exports = router;
