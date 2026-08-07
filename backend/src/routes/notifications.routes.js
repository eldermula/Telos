'use strict';

const express = require('express');
const controller = require('../controllers/notifications.controller');
const { authenticate } = require('../middleware/authenticate');

const router = express.Router();

router.use(authenticate);

router.get('/preferences', controller.getPreferences);
router.patch('/preferences', controller.updatePreferences);
router.get('/', controller.list);
router.patch('/:id', controller.patch);

module.exports = router;
