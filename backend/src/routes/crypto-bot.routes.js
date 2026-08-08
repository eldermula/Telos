'use strict';

const express = require('express');
const controller = require('../controllers/crypto-bot.controller');
const { authenticate } = require('../middleware/authenticate');
const { rateLimit } = require('../middleware/rate-limit');

const router = express.Router();

router.use(authenticate);

router.get('/session', rateLimit.read(), controller.getCryptoSession);
router.post('/start', rateLimit.write({ max: 5 }), controller.startCrypto);
router.post('/stop', rateLimit.write({ max: 5 }), controller.stopCrypto);

module.exports = router;
