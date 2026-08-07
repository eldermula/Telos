'use strict';

const express = require('express');
const { z } = require('zod');
const accessGateService = require('../services/access-gate.service');
const { rateLimit } = require('../middleware/rate-limit');
const { AppError } = require('../utils/app-error');
const { ACCESS_GATE_COOKIE_NAME } = require('../config/env');

const router = express.Router();

const verifySchema = z.object({
  attempt: z.string().min(1).max(4000),
});

router.get('/status', (req, res) => {
  // Always reachable without a cookie — the frontend needs this to know
  // whether to show the gate. Reveals nothing about the phrase.
  const configured = accessGateService.isGateConfigured();
  const unlocked = configured ? accessGateService.hasValidGateCookie(req) : true;
  res.status(200).json({
    configured,
    unlocked,
  });
});

router.post('/verify', rateLimit.preAuth(), async (req, res, next) => {
  try {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(422, 'VALIDATION_ERROR', 'Invalid request body', {
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    const token = accessGateService.verifyAttempt(parsed.data.attempt);
    res.cookie(ACCESS_GATE_COOKIE_NAME, token, accessGateService.cookieOptions());
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
