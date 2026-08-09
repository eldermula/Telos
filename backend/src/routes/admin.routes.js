'use strict';

const express = require('express');
const controller = require('../controllers/admin.controller');
const { authenticate } = require('../middleware/authenticate');
const { requireAdmin } = require('../middleware/require-admin');
const { rateLimit } = require('../middleware/rate-limit');

const router = express.Router();

router.use(authenticate);
router.use(requireAdmin);

// Tightened below the general default throughout — not because these
// routes are under-protected against unauthorized access (requireAdmin
// above already 403s anyone without role:admin), but to shrink the
// blast radius of a *compromised admin token*: GET routes here return
// cross-user PII no normal user's own-data GETs do, and the two PATCH
// routes reach live trading math (risk_tier_config, Phase 7.8/7.9) or
// which strategy is active — no legitimate admin workflow needs more
// than a handful of either per minute.
router.get('/users', rateLimit.read({ max: 20 }), controller.listUsers);
router.get('/users/:id', rateLimit.read({ max: 20 }), controller.getUser);
router.get('/system-health', rateLimit.read({ max: 20 }), controller.systemHealth);
router.get('/risk-tiers', rateLimit.read({ max: 20 }), controller.listRiskTiers);
router.patch('/risk-tiers/:tier', rateLimit.write({ max: 5 }), controller.patchRiskTier);
router.get('/candidate-strategies', rateLimit.read({ max: 20 }), controller.listCandidateStrategies);
router.patch('/candidate-strategies/:id', rateLimit.write({ max: 5 }), controller.patchCandidateStrategy);

// Synthetics Layer-3 demo-dispatch bypass — time-limited testing toggle.
router.get(
  '/synthetic/demo-dispatch-status',
  rateLimit.read({ max: 20 }),
  controller.getSyntheticDemoDispatchStatus
);
router.post(
  '/synthetic/demo-dispatch-enable',
  rateLimit.write({ max: 5 }),
  controller.enableSyntheticDemoDispatch
);
router.post(
  '/synthetic/demo-dispatch-disable',
  rateLimit.write({ max: 5 }),
  controller.disableSyntheticDemoDispatch
);

module.exports = router;
