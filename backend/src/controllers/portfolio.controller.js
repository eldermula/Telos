'use strict';

const portfolioService = require('../services/portfolio.service');
const { parseRangeQuery } = require('../utils/query-enums');

async function getHoldings(req, res, next) {
  try {
    const data = await portfolioService.getHoldings(req.user.id);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function getPerformance(req, res, next) {
  try {
    const range = parseRangeQuery(req.query);
    const data = await portfolioService.getPerformance(req.user.id, range);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

module.exports = { getHoldings, getPerformance };
