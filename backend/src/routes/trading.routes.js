'use strict';

const express = require('express');
const controller = require('../controllers/trading.controller');
const { authenticate } = require('../middleware/authenticate');
const { rateLimit } = require('../middleware/rate-limit');

const router = express.Router();

router.use(authenticate);

router.get('/session', rateLimit.read(), controller.getSession);
// Option 2 D follow-up — live MT5 equity/balance for the Confirm Live
// modal. Read-class limiter; hits the local connector once per call
// (no cache — the whole point is a fresh number before arming).
router.get('/account-info', rateLimit.read(), controller.getAccountInfo);
// Tightened well below the general 10/min state-changing default —
// legitimate use is a human pressing Start/Stop a handful of times a
// day, never more than once every few seconds. Each call does real
// work (MT5 terminal connect/disconnect, bot_instances transition,
// WebSocket broadcast) on the resource-constrained self-hosted machine
// (04_System_Architecture.md §8) — a rapid cycle, malicious or just a
// buggy frontend retry loop, has real operational cost here that most
// other state-changing endpoints don't share.
router.post('/session/start', rateLimit.write({ max: 5 }), controller.startSession);
router.post('/session/stop', rateLimit.write({ max: 5 }), controller.stopSession);
// Option 2 Increment D — same tightened class as start/stop, same
// reasoning: legitimate use is a human confirming once before a Start,
// never a rapid-fire loop.
router.post('/session/confirm-live', rateLimit.write({ max: 5 }), controller.confirmLive);
router.get('/positions', rateLimit.read(), controller.getPositions);
router.get('/orders', rateLimit.read(), controller.getOrders);
router.get('/history', rateLimit.read(), controller.getHistory);
router.get('/decision-log', rateLimit.read(), controller.getDecisionLog);

module.exports = router;
