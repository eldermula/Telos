'use strict';

const express = require('express');
const controller = require('../controllers/assistant.controller');
const { authenticate } = require('../middleware/authenticate');
const { rateLimit } = require('../middleware/rate-limit');

const router = express.Router();

router.use(authenticate);

router.post('/conversations', rateLimit.write(), controller.createConversation);
router.get('/conversations', rateLimit.read(), controller.listConversations);
router.get('/conversations/:id/messages', rateLimit.read(), controller.listMessages);
router.post('/conversations/:id/messages', rateLimit.write(), controller.postMessage);
router.get('/insights', rateLimit.read(), controller.getInsights);

module.exports = router;
