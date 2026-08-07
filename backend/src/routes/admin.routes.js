'use strict';

const express = require('express');
const controller = require('../controllers/admin.controller');
const { authenticate } = require('../middleware/authenticate');
const { requireAdmin } = require('../middleware/require-admin');

const router = express.Router();

router.use(authenticate);
router.use(requireAdmin);

router.get('/users', controller.listUsers);
router.get('/users/:id', controller.getUser);
router.get('/system-health', controller.systemHealth);
router.get('/risk-tiers', controller.listRiskTiers);
router.patch('/risk-tiers/:tier', controller.patchRiskTier);
router.get('/candidate-strategies', controller.listCandidateStrategies);
router.patch('/candidate-strategies/:id', controller.patchCandidateStrategy);

module.exports = router;
