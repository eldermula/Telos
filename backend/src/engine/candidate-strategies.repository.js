'use strict';

const { pool } = require('../db/pool');

/**
 * 05_Database_Design.md Section 1.4 / 08_Bot_Architecture.md Section
 * 11's paper-trading gate: Selection (Module 4) only ever draws from
 * `status = 'active'` — `proposed`/`paper_testing` strategies exist
 * for the Discovery/Admin workflow (Section 9.4) but aren't eligible
 * to actually fire live, and `rejected` ones are kept for history,
 * not deleted.
 */
async function listActiveStrategies() {
  const result = await pool.query(
    `SELECT id, name, rule_set, description, source, status
     FROM candidate_strategies
     WHERE status = 'active'`
  );
  return result.rows;
}

module.exports = { listActiveStrategies };
