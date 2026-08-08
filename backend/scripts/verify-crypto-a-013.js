require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  const client = await pool.connect();
  try {
    const open = await client.query(`
      SELECT t.id, t.bot_instance_id, t.user_id, t.symbol, t.direction,
             t.entry_price, t.stop_price, t.target_price, t.lot_size,
             t.final_applied_position_risk, t.origin
      FROM trades t
      WHERE t.status = 'open'
      LIMIT 1
    `);
    if (!open.rows[0]) throw new Error('no open trade to prove index against');
    const row = open.rows[0];

    await client.query('BEGIN');
    let rejected = false;
    let code = null;
    try {
      // Omit user_id and asset_class — triggers/defaults must fill them.
      await client.query(
        `INSERT INTO trades (
           bot_instance_id, origin, direction, entry_price, stop_price, target_price,
           lot_size, final_applied_position_risk, status, symbol, execution_mode
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'open',$9,'paper')`,
        [
          row.bot_instance_id,
          row.origin,
          row.direction,
          row.entry_price,
          row.stop_price,
          row.target_price,
          row.lot_size,
          row.final_applied_position_risk,
          row.symbol,
        ]
      );
    } catch (err) {
      rejected = true;
      code = err.code;
    }
    await client.query('ROLLBACK');

    if (!rejected || code !== '23505') {
      throw new Error(`expected 23505 on second open trade, got rejected=${rejected} code=${code}`);
    }
    console.log('INDEX_PROOF_PASS one_open_trade_per_user rejects duplicate open (23505)');

    // Trigger proof: insert closed trade without user_id/asset_class, then delete.
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO trades (
         bot_instance_id, origin, direction, entry_price, stop_price, target_price,
         lot_size, final_applied_position_risk, status, symbol, execution_mode
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'closed',$9,'paper')
       RETURNING user_id, asset_class`,
      [
        row.bot_instance_id,
        row.origin,
        row.direction,
        row.entry_price,
        row.stop_price,
        row.target_price,
        row.lot_size,
        row.final_applied_position_risk,
        row.symbol,
      ]
    );
    const got = ins.rows[0];
    if (String(got.user_id) !== String(row.user_id)) {
      throw new Error(`user_id trigger mismatch: ${got.user_id} vs ${row.user_id}`);
    }
    if (got.asset_class !== 'forex_gold') {
      throw new Error(`asset_class default mismatch: ${got.asset_class}`);
    }
    await client.query('ROLLBACK');
    console.log('TRIGGER_PROOF_PASS trades.user_id filled from bot_instance; asset_class default forex_gold');

    // broker_id trigger: dry-run insert + rollback for a user with no connection...
    // safer: call the function logic by inserting into a temp scenario.
    // Use a user that already has broker_id=mt5 — insert should hit unique index 23505 if we try same broker_id.
    const bc = await pool.query(`SELECT user_id, broker_name FROM broker_connections LIMIT 1`);
    const u = bc.rows[0];
    await client.query('BEGIN');
    let bcRejected = false;
    let bcCode = null;
    try {
      await client.query(
        `INSERT INTO broker_connections
           (user_id, broker_name, encrypted_credentials, connection_status, account_type)
         VALUES ($1, $2, decode('00','hex'), 'disconnected', 'demo')`,
        [u.user_id, u.broker_name]
      );
    } catch (err) {
      bcRejected = true;
      bcCode = err.code;
    }
    await client.query('ROLLBACK');
    if (!bcRejected || bcCode !== '23505') {
      throw new Error(`expected 23505 on duplicate (user_id,broker_id), got ${bcCode}`);
    }
    console.log('BROKER_UNIQUE_PROOF_PASS UNIQUE(user_id,broker_id) rejects duplicate slug (23505)');

    console.log('CRYPTO_A_SCHEMA_VERIFY_PASS');
  } finally {
    client.release();
    await pool.end();
  }
})().catch((e) => {
  console.error('CRYPTO_A_SCHEMA_VERIFY_FAIL', e);
  process.exit(1);
});