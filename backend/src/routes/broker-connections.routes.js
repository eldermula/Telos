const express = require('express');
const controller = require('../controllers/broker-connections.controller');
const { authenticate } = require('../middleware/authenticate');

const router = express.Router();

router.use(authenticate);

router.get('/', controller.list);
router.post('/', controller.create);
router.get('/:id', controller.getById);
router.patch('/:id', controller.patch);
router.delete('/:id', controller.remove);

module.exports = router;
