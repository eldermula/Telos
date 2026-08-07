'use strict';

const express = require('express');
const controller = require('../controllers/notifications.controller');
const { authenticate } = require('../middleware/authenticate');
const { rateLimit } = require('../middleware/rate-limit');

const router = express.Router();

router.use(authenticate);

router.get('/preferences', rateLimit.read(), controller.getPreferences);
router.patch('/preferences', rateLimit.write(), controller.updatePreferences);
router.get('/', rateLimit.read(), controller.list);
router.patch('/:id', rateLimit.write(), controller.patch);

module.exports = router;
