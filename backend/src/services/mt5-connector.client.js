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
  };
}

module.exports = { validateBrokerCredentials };
