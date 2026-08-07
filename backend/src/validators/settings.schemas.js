'use strict';

const { z } = require('zod');
const { PREFERENCE_KEYS } = require('../services/settings.service');

const preferenceShape = Object.fromEntries(
  PREFERENCE_KEYS.map((key) => [key, z.boolean()])
);

const updateProfileSchema = z
  .object({
    email: z.string().email().max(320).optional(),
    current_password: z.string().min(1).max(128).optional(),
    new_password: z.string().min(8).max(128).optional(),
  })
  .refine((data) => data.email !== undefined || data.new_password !== undefined, {
    message: 'At least one of email or new_password is required',
  });

const updateNotificationPreferencesSchema = z.object({
  preferences: z.object(preferenceShape).partial().refine(
    (obj) => Object.keys(obj).length > 0,
    { message: 'preferences must include at least one known key' }
  ),
});

module.exports = {
  updateProfileSchema,
  updateNotificationPreferencesSchema,
};
