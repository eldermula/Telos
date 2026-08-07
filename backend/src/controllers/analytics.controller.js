'use strict';

const analyticsService = require('../services/analytics.service');

async function getTradingMetrics(req, res, next) {
  try {
    const data = await analyticsService.getTradingMetrics(req.user.id, req.query.range);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function getBusinessMetrics(req, res, next) {
  try {
    const data = await analyticsService.getBusinessMetrics(req.user.id);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

module.exports = { getTradingMetrics, getBusinessMetrics };
