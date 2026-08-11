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

// Synthetics Layer-2 demo confirm-live bypass — independently toggleable.
router.get(
  '/synthetic/demo-confirm-status',
  rateLimit.read({ max: 20 }),
  controller.getSyntheticDemoConfirmStatus
);
router.post(
  '/synthetic/demo-confirm-enable',
  rateLimit.write({ max: 5 }),
  controller.enableSyntheticDemoConfirm
);
router.post(
  '/synthetic/demo-confirm-disable',
  rateLimit.write({ max: 5 }),
  controller.disableSyntheticDemoConfirm
);

// Synthetics manual test-dispatch/close gate — independently toggleable.
router.get(
  '/synthetic/demo-manual-trade-status',
  rateLimit.read({ max: 20 }),
  controller.getSyntheticDemoManualTradeStatus
);
router.post(
  '/synthetic/demo-manual-trade-enable',
  rateLimit.write({ max: 5 }),
  controller.enableSyntheticDemoManualTrade
);
router.post(
  '/synthetic/demo-manual-trade-disable',
  rateLimit.write({ max: 5 }),
  controller.disableSyntheticDemoManualTrade
);

// Forex Layer-3 demo-dispatch bypass — time-limited testing toggle.
router.get(
  '/forex/demo-dispatch-status',
  rateLimit.read({ max: 20 }),
  controller.getForexDemoDispatchStatus
);
router.post(
  '/forex/demo-dispatch-enable',
  rateLimit.write({ max: 5 }),
  controller.enableForexDemoDispatch
);
router.post(
  '/forex/demo-dispatch-disable',
  rateLimit.write({ max: 5 }),
  controller.disableForexDemoDispatch
);

// Forex Layer-2 demo confirm-live bypass — independently toggleable.
router.get(
  '/forex/demo-confirm-status',
  rateLimit.read({ max: 20 }),
  controller.getForexDemoConfirmStatus
);
router.post(
  '/forex/demo-confirm-enable',
  rateLimit.write({ max: 5 }),
  controller.enableForexDemoConfirm
);
router.post(
  '/forex/demo-confirm-disable',
  rateLimit.write({ max: 5 }),
  controller.disableForexDemoConfirm
);

// Forex manual test-dispatch/close gate — independently toggleable.
router.get(
  '/forex/demo-manual-trade-status',
  rateLimit.read({ max: 20 }),
  controller.getForexDemoManualTradeStatus
);
router.post(
  '/forex/demo-manual-trade-enable',
  rateLimit.write({ max: 5 }),
  controller.enableForexDemoManualTrade
);
router.post(
  '/forex/demo-manual-trade-disable',
  rateLimit.write({ max: 5 }),
  controller.disableForexDemoManualTrade
);

// M5 PAPER-ONLY EXPERIMENT (docs/14_M5_Forex_Paper_Experiment.md) — an
// isolated, in-memory, admin-only paper simulation. Never reaches real
// dispatch; see backend/src/engine/m5-paper-harness.js's file header.
// Deliberately NOT nested under /forex/* or reachable from the normal
// Trading page flow at all.
router.get(
  '/experimental/m5-paper-status',
  rateLimit.read({ max: 20 }),
  controller.getM5PaperStatus
);
router.post(
  '/experimental/m5-paper-start',
  rateLimit.write({ max: 5 }),
  controller.startM5PaperSession
);
router.post(
  '/experimental/m5-paper-stop',
  rateLimit.write({ max: 5 }),
  controller.stopM5PaperSession
);

// M1 PAPER-ONLY EXPERIMENT (docs/15_M1_Forex_Paper_Experiment.md) — same
// isolation pattern as m5-paper-*: in-memory, admin-only, never reaches
// real dispatch. Deliberately NOT nested under /forex/* or reachable from
// the normal Trading page flow.
router.get(
  '/experimental/m1-paper-status',
  rateLimit.read({ max: 20 }),
  controller.getM1PaperStatus
);
router.post(
  '/experimental/m1-paper-start',
  rateLimit.write({ max: 5 }),
  controller.startM1PaperSession
);
router.post(
  '/experimental/m1-paper-stop',
  rateLimit.write({ max: 5 }),
  controller.stopM1PaperSession
);

// M5 real-dispatch (UNPROVEN LIVE, docs/14_M5_Forex_Paper_Experiment.md) — a
// SEPARATE tool from m5-paper-* above. Can place real orders once Layer 0-3
// (below) are all armed. Admin-only, testing-only, never reachable from the
// Trading page or any normal user flow. See m5-real-harness.js's header.
router.get(
  '/experimental/m5-real-status',
  rateLimit.read({ max: 20 }),
  controller.getM5RealStatus
);
router.post(
  '/experimental/m5-real-start',
  rateLimit.write({ max: 5 }),
  controller.startM5RealSession
);
router.post(
  '/experimental/m5-real-stop',
  rateLimit.write({ max: 5 }),
  controller.stopM5RealSession
);
// Layer 2 — M5-specific confirm-live, independent of forex's
// /trading/session/confirm-live. Requires the M5 real session to be
// stopped first (same precondition forex's confirmLiveTrading uses).
router.post(
  '/experimental/m5-real-confirm-live',
  rateLimit.write({ max: 5 }),
  controller.confirmM5RealLiveTrading
);
// Layer 3 — M5 demo real-dispatch bypass, independent of
// forex_demo_dispatch_config / synthetic_demo_dispatch_config.
router.get(
  '/experimental/m5-real-demo-dispatch-status',
  rateLimit.read({ max: 20 }),
  controller.getM5RealDispatchStatus
);
router.post(
  '/experimental/m5-real-demo-dispatch-enable',
  rateLimit.write({ max: 5 }),
  controller.enableM5RealDispatch
);
router.post(
  '/experimental/m5-real-demo-dispatch-disable',
  rateLimit.write({ max: 5 }),
  controller.disableM5RealDispatch
);
// Layer 2b — M5 demo confirm-live bypass (allows confirm-live to succeed
// on a demo account for testing), independently toggleable from Layer 3.
router.get(
  '/experimental/m5-real-demo-confirm-status',
  rateLimit.read({ max: 20 }),
  controller.getM5RealConfirmStatus
);
router.post(
  '/experimental/m5-real-demo-confirm-enable',
  rateLimit.write({ max: 5 }),
  controller.enableM5RealConfirm
);
router.post(
  '/experimental/m5-real-demo-confirm-disable',
  rateLimit.write({ max: 5 }),
  controller.disableM5RealConfirm
);

module.exports = router;
