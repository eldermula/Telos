'use strict';

const portfolioService = require('../services/portfolio.service');

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
    const data = await portfolioService.getPerformance(req.user.id, req.query.range);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

module.exports = { getHoldings, getPerformance };
