'use strict';

/**
 * TEMP diagnostic only — gated by DIAG_TIMING=1.
 * Request-scoped stage marks for plumbing overhead analysis.
 */

let enabled = false;
let t0 = 0;
const stages = [];
const connectorCalls = [];

function isEnabled() {
  return process.env.DIAG_TIMING === '1';
}

function begin(label) {
  enabled = isEnabled();
  stages.length = 0;
  connectorCalls.length = 0;
  t0 = Date.now();
  if (enabled) mark(label || 'begin');
}

function mark(name, extra) {
  if (!enabled) return;
  const entry = { name, ms_from_start: Date.now() - t0 };
  if (extra && typeof extra === 'object') Object.assign(entry, extra);
  stages.push(entry);
  console.warn('[DIAG_TIMING]', JSON.stringify(entry));
}

function recordConnector(path, method, httpMs, connectorDiag) {
  if (!enabled) return;
  const entry = {
    path,
    method,
    http_ms: httpMs,
    connector_diag: connectorDiag || null,
  };
  connectorCalls.push(entry);
  mark(`connector ${method} ${path}`, { http_ms: httpMs, connector_diag: connectorDiag || null });
}

function snapshot() {
  if (!enabled) return null;
  return {
    total_ms: Date.now() - t0,
    stages: stages.slice(),
    connector_calls: connectorCalls.slice(),
  };
}

module.exports = {
  isEnabled,
  begin,
  mark,
  recordConnector,
  snapshot,
};
