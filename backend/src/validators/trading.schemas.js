'use strict';

const { z } = require('zod');

const confirmLiveTradingSchema = z.object({
  confirmationPhrase: z.string().min(1).max(200),
});

const syntheticTestDispatchRealSchema = z.object({
  symbol: z.string().min(1).max(64),
  direction: z.enum(['BUY', 'SELL', 'buy', 'sell']),
});

const syntheticTestCloseRealSchema = z.object({
  tradeId: z.string().uuid(),
});

module.exports = {
  confirmLiveTradingSchema,
  syntheticTestDispatchRealSchema,
  syntheticTestCloseRealSchema,
};
