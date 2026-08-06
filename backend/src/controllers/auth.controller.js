const authService = require('../services/auth.service');
const {
  signupSchema,
  loginSchema,
  passwordResetRequestSchema,
  passwordResetConfirmSchema,
} = require('../validators/auth.schemas');
const { AppError } = require('../utils/app-error');

function parseBody(schema, body) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Invalid request body', {
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    });
  }
  return parsed.data;
}

async function signup(req, res, next) {
  try {
    const data = parseBody(signupSchema, req.body);
    const result = await authService.signup(data);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const data = parseBody(loginSchema, req.body);
    const result = await authService.login(data);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    await authService.logout(req.user.id, req.user.jti, req.user.exp);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

async function passwordResetRequest(req, res, next) {
  try {
    const data = parseBody(passwordResetRequestSchema, req.body);
    const result = await authService.requestPasswordReset(data.email);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function passwordResetConfirm(req, res, next) {
  try {
    const data = parseBody(passwordResetConfirmSchema, req.body);
    const result = await authService.confirmPasswordReset(data);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function me(req, res, next) {
  try {
    const result = await authService.getMe(req.user.id);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  signup,
  login,
  logout,
  passwordResetRequest,
  passwordResetConfirm,
  me,
};
