'use strict';

const express = require('express');
const controller = require('../controllers/trading.controller');
const { authenticate } = require('../middleware/authenticate');

const router = express.Router();

router.use(authenticate);

router.get('/session', controller.getSession);
router.post('/session/start', controller.startSession);
router.post('/session/stop', controller.stopSession);
router.get('/positions', controller.getPositions);
router.get('/orders', controller.getOrders);
router.get('/history', controller.getHistory);
router.get('/decision-log', controller.getDecisionLog);

module.exports = router;
