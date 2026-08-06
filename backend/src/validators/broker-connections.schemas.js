const { z } = require('zod');

const credentialsSchema = z.object({
  login: z.union([z.string().min(1), z.number()]).transform(String),
  password: z.string().min(1).max(256),
  server: z.string().min(1).max(256),
});

const createBrokerConnectionSchema = z.object({
  broker_name: z.literal('mt5'),
  credentials: credentialsSchema,
});

const patchBrokerConnectionSchema = z.object({
  credentials: credentialsSchema,
});

module.exports = {
  createBrokerConnectionSchema,
  patchBrokerConnectionSchema,
};
