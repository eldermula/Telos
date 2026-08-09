'use strict';

const express = require('express');
const controller = require('../controllers/synthetic-bot.controller');
const { authenticate } = require('../middleware/authenticate');
const { rateLimit } = require('../middleware/rate-limit');

const router = express.Router();

router.use(authenticate);

router.get('/session', rateLimit.read(), controller.getSyntheticSession);
router.post('/start', rateLimit.write({ max: 5 }), controller.startSynthetic);
router.post('/stop', rateLimit.write({ max: 5 }), controller.stopSynthetic);
router.post('/confirm-live', rateLimit.write({ max: 5 }), controller.confirmSyntheticLive);
router.post(
  '/test-dispatch-real',
  rateLimit.write({ max: 3 }),
  controller.testDispatchSyntheticReal
);
router.post(
  '/test-close-real',
  rateLimit.write({ max: 3 }),
  controller.testCloseSyntheticReal
);
router.post(
  '/positions/:tradeId/close',
  rateLimit.write({ max: 10 }),
  controller.closeSyntheticPosition
);

module.exports = router;
