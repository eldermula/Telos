'use strict';

/**
 * Crypto Increment D — read-only /symbol-info probe for BTCUSD/ETHUSD.
 * Never calls placeOrder/closeOrder.
 *
 *   node backend/scripts/probe-crypto-symbol-info-d.js
 */

const path = require('path');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', '.env'),
});

const { getSymbolInfo } = require('../src/services/mt5-connector.client');
const {
  CRYPTO_SYMBOLS,
  normalizeCryptoContractSpec,
} = require('../src/engine/crypto-contract-specs');

async function main() {
  const results = [];
  for (const symbol of CRYPTO_SYMBOLS) {
    try {
      const info = await getSymbolInfo(symbol);
      const normalized = normalizeCryptoContractSpec({ ...info, symbol });
      results.push({
        symbol,
        ok: true,
        trade_contract_size: info.trade_contract_size ?? null,
        volume_min: info.volume_min,
        volume_step: info.volume_step,
        volume_max: info.volume_max,
        sizingReady: normalized.sizingReady,
        reason: normalized.reason || null,
        trade_mode_full: info.trade_mode_full,
      });
    } catch (err) {
      results.push({
        symbol,
        ok: false,
        error: err && err.message ? err.message : String(err),
      });
    }
  }
  console.log(JSON.stringify({ results }, null, 2));
  const anyOk = results.some((r) => r.ok);
  if (!anyOk) {
    console.log(
      'CRYPTO_SPECS_D_PROBE_SKIP — connector/MT5 unavailable or symbols not in Market Watch (expected on some demos). Unit tests still cover normalizeCryptoContractSpec.'
    );
    return;
  }
  console.log('CRYPTO_SPECS_D_PROBE_DONE');
}

main().catch((err) => {
  console.error('CRYPTO_SPECS_D_PROBE_FAIL', err);
  process.exitCode = 1;
});
