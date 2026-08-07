'use strict';

const fs = require('fs');
const path = require('path');
const { pool } = require('../db/pool');
const { AppError } = require('../utils/app-error');
const { REPORTS_DIR } = require('../config/env');
const tradingEngine = require('../engine/trading-engine');
const { toMeta } = require('../utils/pagination');

function ensureReportsDir() {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

/** DATE columns arrive as JS Date at local midnight; serialize as YYYY-MM-DD. */
function toDateOnly(value) {
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
}

function toPublicReport(row) {
  return {
    id: row.id,
    period_start: toDateOnly(row.period_start),
    period_end: toDateOnly(row.period_end),
    format: row.format,
    generated_at: row.generated_at,
  };
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

async function generateCsv(userId, periodStart, periodEnd) {
  let instance;
  try {
    instance = await tradingEngine.ensureBotInstance(userId);
  } catch (err) {
    if (err instanceof AppError && err.code === 'NO_BROKER_CONNECTION') {
      return [
        'id,symbol,direction,entry_price,exit_price,lot_size,pnl,opened_at,closed_at',
        '',
      ].join('\n');
    }
    throw err;
  }

  const result = await pool.query(
    `SELECT id, symbol, direction, entry_price, exit_price, lot_size, pnl, opened_at, closed_at
     FROM trades
     WHERE bot_instance_id = $1
       AND status = 'closed'
       AND closed_at::date >= $2::date
       AND closed_at::date <= $3::date
     ORDER BY closed_at ASC`,
    [instance.id, periodStart, periodEnd]
  );

  const header =
    'id,symbol,direction,entry_price,exit_price,lot_size,pnl,opened_at,closed_at';
  const lines = result.rows.map((row) =>
    [
      row.id,
      row.symbol,
      row.direction,
      row.entry_price,
      row.exit_price,
      row.lot_size,
      row.pnl,
      row.opened_at ? new Date(row.opened_at).toISOString() : '',
      row.closed_at ? new Date(row.closed_at).toISOString() : '',
    ]
      .map(csvEscape)
      .join(',')
  );
  return [header, ...lines].join('\n') + '\n';
}

async function createReport(userId, { period_start, period_end, format }) {
  if (format === 'pdf') {
    // FLAG: PDF needs a library (new dependency). CSV ships first.
    throw new AppError(
      422,
      'PDF_NOT_IMPLEMENTED',
      'PDF report generation is pending a library decision. Use format=csv for now.'
    );
  }
  if (format !== 'csv') {
    throw new AppError(422, 'VALIDATION_ERROR', `Unsupported report format '${format}'`);
  }
  if (period_start > period_end) {
    throw new AppError(422, 'VALIDATION_ERROR', 'period_start must be on or before period_end');
  }

  ensureReportsDir();
  const csv = await generateCsv(userId, period_start, period_end);
  const fileName = `${userId}_${period_start}_${period_end}_${Date.now()}.csv`;
  const filePath = path.join(REPORTS_DIR, fileName);
  fs.writeFileSync(filePath, csv, 'utf8');

  const result = await pool.query(
    `INSERT INTO reports (user_id, period_start, period_end, format, file_path)
     VALUES ($1, $2::date, $3::date, $4, $5)
     RETURNING id, period_start, period_end, format, generated_at, file_path`,
    [userId, period_start, period_end, format, filePath]
  );
  return toPublicReport(result.rows[0]);
}

async function listReports(userId, { limit = 25, offset = 0, page = 1 } = {}) {
  const [rows, count] = await Promise.all([
    pool.query(
      `SELECT id, period_start, period_end, format, generated_at
       FROM reports
       WHERE user_id = $1
       ORDER BY generated_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    ),
    pool.query(`SELECT count(*)::int AS n FROM reports WHERE user_id = $1`, [userId]),
  ]);
  return {
    data: rows.rows.map(toPublicReport),
    meta: toMeta({ page, limit }, count.rows[0].n),
  };
}

async function getReport(userId, reportId) {
  const result = await pool.query(
    `SELECT id, period_start, period_end, format, generated_at, file_path
     FROM reports
     WHERE id = $1 AND user_id = $2`,
    [reportId, userId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new AppError(404, 'NOT_FOUND', 'Report not found');
  }
  return { ...toPublicReport(row), file_path: row.file_path };
}

async function getReportForDownload(userId, reportId) {
  const report = await getReport(userId, reportId);
  if (!fs.existsSync(report.file_path)) {
    throw new AppError(404, 'REPORT_FILE_MISSING', 'Report file is missing on disk');
  }
  return report;
}

module.exports = {
  createReport,
  listReports,
  getReport,
  getReportForDownload,
  toPublicReport,
};
