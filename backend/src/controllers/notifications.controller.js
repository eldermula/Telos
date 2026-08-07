'use strict';

const notificationsService = require('../services/notifications.service');
const settingsService = require('../services/settings.service');
const { parsePagination } = require('../utils/pagination');
const { parseUuid } = require('../utils/parse-uuid');
const { z } = require('zod');
const { AppError } = require('../utils/app-error');
const { updateNotificationPreferencesSchema } = require('../validators/settings.schemas');

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

const patchNotificationSchema = z.object({
  read_status: z.boolean(),
});

async function list(req, res, next) {
  try {
    const pagination = parsePagination(req.query);
    const data = await notificationsService.listNotifications(req.user.id, pagination);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function patch(req, res, next) {
  try {
    const body = parseBody(patchNotificationSchema, req.body);
    const id = parseUuid(req.params.id, 'notification id');
    const data = await notificationsService.updateReadStatus(
      req.user.id,
      id,
      body.read_status
    );
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function getPreferences(req, res, next) {
  try {
    const data = await settingsService.getNotificationPreferences(req.user.id);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function updatePreferences(req, res, next) {
  try {
    const body = parseBody(updateNotificationPreferencesSchema, req.body);
    const data = await settingsService.updateNotificationPreferences(
      req.user.id,
      body.preferences
    );
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  list,
  patch,
  getPreferences,
  updatePreferences,
};
