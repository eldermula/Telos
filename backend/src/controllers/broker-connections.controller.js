const brokerConnectionsService = require('../services/broker-connections.service');
const {
  createBrokerConnectionSchema,
  patchBrokerConnectionSchema,
} = require('../validators/broker-connections.schemas');
const { AppError } = require('../utils/app-error');
const { z } = require('zod');

const idSchema = z.string().uuid();

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

function parseId(id) {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Invalid connection id');
  }
  return parsed.data;
}

async function list(req, res, next) {
  try {
    const data = await brokerConnectionsService.listConnections(req.user.id);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function getById(req, res, next) {
  try {
    const id = parseId(req.params.id);
    const data = await brokerConnectionsService.getConnection(req.user.id, id);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const body = parseBody(createBrokerConnectionSchema, req.body);
    const data = await brokerConnectionsService.createConnection(req.user.id, body);
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
}

async function patch(req, res, next) {
  try {
    const id = parseId(req.params.id);
    const body = parseBody(patchBrokerConnectionSchema, req.body);
    const data = await brokerConnectionsService.updateConnection(req.user.id, id, body);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const id = parseId(req.params.id);
    await brokerConnectionsService.deleteConnection(req.user.id, id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { list, getById, create, patch, remove };
