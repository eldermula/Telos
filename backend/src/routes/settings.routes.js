'use strict';

const express = require('express');
const controller = require('../controllers/settings.controller');
const { authenticate } = require('../middleware/authenticate');
const { rateLimit } = require('../middleware/rate-limit');

const router = express.Router();

router.use(authenticate);

router.get('/profile', rateLimit.read(), controller.getProfile);
router.patch('/profile', rateLimit.write(), controller.updateProfile);
router.get('/notifications', rateLimit.read(), controller.getNotificationPreferences);
router.patch('/notifications', rateLimit.write(), controller.updateNotificationPreferences);

module.exports = router;
