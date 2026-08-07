'use strict';

const { z } = require('zod');

const confirmLiveTradingSchema = z.object({
  confirmationPhrase: z.string().min(1).max(200),
});

module.exports = {
  confirmLiveTradingSchema,
};
