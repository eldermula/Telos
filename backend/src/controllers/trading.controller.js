'use strict';

const tradingService = require('../services/trading.service');
const { parsePagination } = require('../utils/pagination');

async function getSession(req, res, next) {
  try {
    const data = await tradingService.getSession(req.user.id);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function startSession(req, res, next) {
  try {
    const data = await tradingService.startSession(req.user.id);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function stopSession(req, res, next) {
  try {
    const data = await tradingService.stopSession(req.user.id);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function getPositions(req, res, next) {
  try {
    const data = await tradingService.getPositions(req.user.id);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function getOrders(req, res, next) {
  try {
    const data = await tradingService.getOrders(req.user.id);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function getHistory(req, res, next) {
  try {
    const pagination = parsePagination(req.query);
    const data = await tradingService.getHistory(req.user.id, pagination);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function getDecisionLog(req, res, next) {
  try {
    const pagination = parsePagination(req.query);
    const data = await tradingService.getDecisionLog(req.user.id, pagination);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getSession,
  startSession,
  stopSession,
  getPositions,
  getOrders,
  getHistory,
  getDecisionLog,
};
