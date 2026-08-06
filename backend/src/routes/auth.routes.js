const express = require('express');
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/authenticate');
const { rateLimitLogin } = require('../middleware/rate-limit-login');

const router = express.Router();

router.post('/signup', authController.signup);
router.post('/login', rateLimitLogin, authController.login);
router.post('/logout', authenticate, authController.logout);
router.post('/password-reset/request', authController.passwordResetRequest);
router.post('/password-reset/confirm', authController.passwordResetConfirm);
router.get('/me', authenticate, authController.me);

module.exports = router;
