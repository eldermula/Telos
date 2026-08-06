const { z } = require('zod');

const signupSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(128),
});

const passwordResetRequestSchema = z.object({
  email: z.string().email().max(320),
});

const passwordResetConfirmSchema = z.object({
  token: z.string().min(1).max(256),
  password: z.string().min(8).max(128),
});

module.exports = {
  signupSchema,
  loginSchema,
  passwordResetRequestSchema,
  passwordResetConfirmSchema,
};
