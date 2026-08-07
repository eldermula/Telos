const express = require('express');
const controller = require('../controllers/broker-connections.controller');
const { authenticate } = require('../middleware/authenticate');
const { rateLimit } = require('../middleware/rate-limit');

const router = express.Router();

router.use(authenticate);

router.get('/', rateLimit.read(), controller.list);
router.post('/', rateLimit.write(), controller.create);
router.get('/:id', rateLimit.read(), controller.getById);
router.patch('/:id', rateLimit.write(), controller.patch);
router.delete('/:id', rateLimit.write(), controller.remove);

module.exports = router;
