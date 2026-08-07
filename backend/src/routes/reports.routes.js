'use strict';

const express = require('express');
const controller = require('../controllers/reports.controller');
const { authenticate } = require('../middleware/authenticate');

const router = express.Router();

router.use(authenticate);

router.post('/', controller.create);
router.get('/', controller.list);
router.get('/:id/download', controller.download);
router.get('/:id', controller.getOne);

module.exports = router;
