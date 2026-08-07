'use strict';

const express = require('express');
const controller = require('../controllers/portfolio.controller');
const { authenticate } = require('../middleware/authenticate');

const router = express.Router();

router.use(authenticate);

router.get('/holdings', controller.getHoldings);
router.get('/performance', controller.getPerformance);

module.exports = router;
