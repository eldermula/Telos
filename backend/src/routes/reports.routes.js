'use strict';

const express = require('express');
const controller = require('../controllers/reports.controller');
const { authenticate } = require('../middleware/authenticate');
const { rateLimit } = require('../middleware/rate-limit');

const router = express.Router();

router.use(authenticate);

router.post('/', rateLimit.write(), controller.create);
router.get('/', rateLimit.read(), controller.list);
router.get('/:id/download', rateLimit.read(), controller.download);
router.get('/:id', rateLimit.read(), controller.getOne);

module.exports = router;
