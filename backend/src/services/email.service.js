const nodemailer = require('nodemailer');
const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_FROM,
  PASSWORD_RESET_BASE_URL,
  NODE_ENV,
} = require('../config/env');

let transporter = null;

function getTransporter() {
  if (!SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

/**
 * FR-AUTH-4 — send password reset email.
 * Until SMTP is configured, logs the reset link (dev placeholder per 06 Section 3).
 */
async function sendPasswordResetEmail(email, token) {
  const resetLink = `${PASSWORD_RESET_BASE_URL}?token=${encodeURIComponent(token)}`;

  const transport = getTransporter();
  if (!transport) {
    console.log('[password-reset] SMTP not configured — reset link (dev):', {
      email,
      resetLink,
    });
    return;
  }

  await transport.sendMail({
    from: SMTP_FROM,
    to: email,
    subject: 'Telos password reset',
    text: `Reset your Telos password using this link (expires soon):\n\n${resetLink}\n`,
  });

  if (NODE_ENV !== 'production') {
    console.log('[password-reset] email sent to', email);
  }
}

module.exports = { sendPasswordResetEmail };
