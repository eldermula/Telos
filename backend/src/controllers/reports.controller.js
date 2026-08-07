'use strict';

const path = require('path');
const fs = require('fs');
const { z } = require('zod');
const reportsService = require('../services/reports.service');
const { parsePagination } = require('../utils/pagination');
const { parseUuid } = require('../utils/parse-uuid');
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

const createReportSchema = z.object({
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  format: z.enum(['pdf', 'csv']),
});

async function create(req, res, next) {
  try {
    const body = parseBody(createReportSchema, req.body);
    const data = await reportsService.createReport(req.user.id, body);
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
}

async function list(req, res, next) {
  try {
    const pagination = parsePagination(req.query);
    const data = await reportsService.listReports(req.user.id, pagination);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const id = parseUuid(req.params.id, 'report id');
    const data = await reportsService.getReport(req.user.id, id);
    const { file_path: _ignored, ...publicReport } = data;
    res.status(200).json(publicReport);
  } catch (err) {
    next(err);
  }
}

async function download(req, res, next) {
  try {
    const id = parseUuid(req.params.id, 'report id');
    const report = await reportsService.getReportForDownload(req.user.id, id);
    const filename = path.basename(report.file_path);
    res.setHeader(
      'Content-Type',
      report.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/octet-stream'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    fs.createReadStream(report.file_path).pipe(res);
  } catch (err) {
    next(err);
  }
}

module.exports = { create, list, getOne, download };
