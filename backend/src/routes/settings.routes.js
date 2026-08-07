'use strict';

const express = require('express');
const controller = require('../controllers/settings.controller');
const { authenticate } = require('../middleware/authenticate');

const router = express.Router();

router.use(authenticate);

router.get('/profile', controller.getProfile);
router.patch('/profile', controller.updateProfile);
router.get('/notifications', controller.getNotificationPreferences);
router.patch('/notifications', controller.updateNotificationPreferences);

module.exports = router;
