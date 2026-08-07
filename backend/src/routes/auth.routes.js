const express = require('express');
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/authenticate');
const { rateLimitLogin } = require('../middleware/rate-limit-login');
const { rateLimit } = require('../middleware/rate-limit');

const router = express.Router();

// Signup and both password-reset routes are pre-auth, IP-keyed, and
// tightened to match login's brute-force posture (09_Security.md §7) —
// mass fake-account creation for signup, guessable reset tokens and
// SMTP-quota exhaustion (Brevo free tier) for password-reset.
router.post('/signup', rateLimit.preAuth(), authController.signup);
router.post('/login', rateLimitLogin, authController.login);
router.post('/logout', authenticate, rateLimit.write(), authController.logout);
router.post('/password-reset/request', rateLimit.preAuth(), authController.passwordResetRequest);
router.post('/password-reset/confirm', rateLimit.preAuth(), authController.passwordResetConfirm);
router.get('/me', authenticate, rateLimit.read(), authController.me);

module.exports = router;
