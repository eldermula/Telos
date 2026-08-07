'use strict';

const settingsService = require('../services/settings.service');
const {
  updateProfileSchema,
  updateNotificationPreferencesSchema,
} = require('../validators/settings.schemas');
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

async function getProfile(req, res, next) {
  try {
    const data = await settingsService.getProfile(req.user.id);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function updateProfile(req, res, next) {
  try {
    const data = parseBody(updateProfileSchema, req.body);
    const result = await settingsService.updateProfile(req.user.id, data);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function getNotificationPreferences(req, res, next) {
  try {
    const data = await settingsService.getNotificationPreferences(req.user.id);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function updateNotificationPreferences(req, res, next) {
  try {
    const data = parseBody(updateNotificationPreferencesSchema, req.body);
    const result = await settingsService.updateNotificationPreferences(
      req.user.id,
      data.preferences
    );
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getProfile,
  updateProfile,
  getNotificationPreferences,
  updateNotificationPreferences,
};
