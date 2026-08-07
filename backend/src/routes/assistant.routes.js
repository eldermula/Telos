'use strict';

const express = require('express');
const controller = require('../controllers/assistant.controller');
const { authenticate } = require('../middleware/authenticate');

const router = express.Router();

router.use(authenticate);

router.post('/conversations', controller.createConversation);
router.get('/conversations', controller.listConversations);
router.get('/conversations/:id/messages', controller.listMessages);
router.post('/conversations/:id/messages', controller.postMessage);
router.get('/insights', controller.getInsights);

module.exports = router;
