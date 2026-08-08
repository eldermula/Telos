'use strict';

const analyticsService = require('../services/analytics.service');
const { parseRangeQuery } = require('../utils/query-enums');

async function getTradingMetrics(req, res, next) {
  try {
    const range = parseRangeQuery(req.query);
    const data = await analyticsService.getTradingMetrics(req.user.id, range);
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
