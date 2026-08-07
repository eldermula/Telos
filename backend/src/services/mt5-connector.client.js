const { MT5_CONNECTOR_URL } = require('../config/env');
const { AppError } = require('../utils/app-error');

/**
 * Calls the local Python MT5 connector to validate credentials against
 * the running terminal (04 System Architecture Section 3.6).
 */
async function validateBrokerCredentials(credentials) {
  let response;
  try {
    response = await fetch(`${MT5_CONNECTOR_URL}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: credentials.login,
        password: credentials.password,
        server: credentials.server,
      }),
    });
  } catch (err) {
    throw new AppError(
      503,
      'BROKER_CONNECTOR_UNAVAILABLE',
      'MT5 connector is unreachable. Ensure the Python service and MT5 terminal are running.',
      { reason: err.message }
    );
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new AppError(
      502,
      'BROKER_CONNECTION_FAILED',
      'MT5 connector returned an invalid response'
    );
  }

  if (!response.ok || !body.ok) {
    throw new AppError(
      422,
      'BROKER_CONNECTION_FAILED',
      body.message || 'Failed to validate broker connection'
    );
  }

  return {
    connection_status: body.connection_status || 'connected',
    account_login: body.account_login,
    // 08_Bot_Architecture.md §13 / 09_Security.md §11 — detected by the
    // connector from the live terminal (mt5.account_info().trade_mode),
    // never user-supplied.
    account_type: body.account_type,
  };
}

/**
 * 4.6a — order execution capability (Bot Architecture Module 7).
 * Manually-triggered only — not called from BotRuntime's automatic tick
 * loop (12_Roadmap.md Phase 4 / 4.6b explicitly deferred).
 */

async function connectorRequest(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(`${MT5_CONNECTOR_URL}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new AppError(
      503,
      'BROKER_CONNECTOR_UNAVAILABLE',
      'MT5 connector is unreachable. Ensure the Python service and MT5 terminal are running.',
      { reason: err.message }
    );
  }

  let respBody;
  try {
    respBody = await response.json();
  } catch {
    throw new AppError(502, 'MT5_CONNECTOR_INVALID_RESPONSE', 'MT5 connector returned an invalid response');
  }
  return { status: response.status, ok: response.ok, body: respBody };
}

async function getSymbolInfo(symbol) {
  const { ok, body } = await connectorRequest(`/symbol-info?symbol=${encodeURIComponent(symbol)}`);
  if (!ok || !body.ok) {
    throw new AppError(422, 'MT5_SYMBOL_INFO_FAILED', body.message || 'Failed to fetch symbol info');
  }
  return body;
}

/**
 * 08_Bot_Architecture.md Section 9.0/9.2 — historical OHLC bars for
 * Module 2's ADX/ATR calculations. `timeframe` and `count` mirror the
 * connector's own defaults (M15 / 100 bars) if not supplied.
 */
async function getRates(symbol, { timeframe = 'M15', count = 100 } = {}) {
  const qs = new URLSearchParams({ symbol, timeframe, count: String(count) }).toString();
  const { ok, body } = await connectorRequest(`/rates?${qs}`);
  if (!ok || !body.ok) {
    throw new AppError(422, 'MT5_RATES_FAILED', body.message || 'Failed to fetch rates');
  }
  return body;
}

async function getPositions(symbol) {
  const qs = symbol ? `?symbol=${encodeURIComponent(symbol)}` : '';
  const { ok, body } = await connectorRequest(`/positions${qs}`);
  if (!ok || !body.ok) {
    throw new AppError(422, 'MT5_POSITIONS_FAILED', body.message || 'Failed to list positions');
  }
  return body.positions;
}

async function placeOrder({ symbol, direction, volume, sl, tp }) {
  const { ok, body } = await connectorRequest('/order/place', {
    method: 'POST',
    body: { symbol, direction, volume, sl, tp },
  });
  if (!ok || !body.ok) {
    throw new AppError(422, 'MT5_ORDER_PLACE_FAILED', body.message || 'Failed to place order', {
      retcode: body.retcode,
    });
  }
  return body;
}

async function closeOrder(ticket) {
  const { ok, body } = await connectorRequest('/order/close', {
    method: 'POST',
    body: { ticket },
  });
  if (!ok || !body.ok) {
    throw new AppError(422, 'MT5_ORDER_CLOSE_FAILED', body.message || 'Failed to close order', {
      retcode: body.retcode,
    });
  }
  return body;
}

module.exports = {
  validateBrokerCredentials,
  getSymbolInfo,
  getRates,
  getPositions,
  placeOrder,
  closeOrder,
};
