'use strict';

const { z } = require('zod');
const assistantService = require('../services/assistant.service');
const { parsePagination } = require('../utils/pagination');
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

const messageSchema = z.object({
  content: z.string().min(1).max(4000),
});

async function createConversation(req, res, next) {
  try {
    const data = await assistantService.createConversation(req.user.id);
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
}

async function listConversations(req, res, next) {
  try {
    const pagination = parsePagination(req.query);
    const data = await assistantService.listConversations(req.user.id, pagination);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function listMessages(req, res, next) {
  try {
    const pagination = parsePagination(req.query);
    const data = await assistantService.listMessages(
      req.user.id,
      req.params.id,
      pagination
    );
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function postMessage(req, res, next) {
  try {
    const body = parseBody(messageSchema, req.body);
    const data = await assistantService.postMessage(
      req.user.id,
      req.params.id,
      body.content
    );
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
}

async function getInsights(req, res, next) {
  try {
    const data = await assistantService.getInsights(req.user.id);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createConversation,
  listConversations,
  listMessages,
  postMessage,
  getInsights,
};
