'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Client } = require('pg');
const { decryptCredentials } = require('../src/services/credential-crypto.service');

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query(
    `SELECT u.email, bc.id, bc.broker_name, bc.account_type, bc.encrypted_credentials
     FROM users u JOIN broker_connections bc ON bc.user_id = u.id
     WHERE u.email = $1`,
    ['syn_confirm_browser@telos.test']
  );
  const row = r.rows[0];
  if (!row) throw new Error('no broker connection');
  const creds = decryptCredentials(row.encrypted_credentials);
  console.log(
    JSON.stringify(
      {
        email: row.email,
        broker_connection_id: row.id,
        db_account_type: row.account_type,
        expected_login: String(creds.login),
        server: creds.server,
      },
      null,
      2
    )
  );
  const ai = await fetch(
    (process.env.MT5_CONNECTOR_URL || 'http://127.0.0.1:3100') + '/account-info'
  ).then((x) => x.json());
  console.log('ATTACHED', JSON.stringify(ai));
  console.log('MATCH', String(ai.login) === String(creds.login));
  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
