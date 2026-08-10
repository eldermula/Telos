const http = require('http');
const app = require('./app');
const { PORT } = require('./config/env');
const { connectRedis } = require('./db/redis');
const { attachWebSocketServer } = require('./ws/websocket-server');
const { assertGateConfigAtStartup } = require('./services/access-gate.service');
const tradingEngine = require('./engine/trading-engine');
const cryptoTradingEngine = require('./engine/crypto-trading-engine');
const syntheticTradingEngine = require('./engine/synthetic-trading-engine');

async function start() {
  assertGateConfigAtStartup();
  await connectRedis();

  // Rehydrate any bots still marked running from before this process
  // started (crash/restart). Same initialize()/resume path as Start —
  // including E.7 real-ticket reconcile. Isolated per instance; does
  // not block listen if one bot fails.
  try {
    const rehydrated = await tradingEngine.rehydrateRunningRuntimes();
    const ok = rehydrated.filter((r) => r.ok).length;
    console.log(`[boot] rehydrated ${ok}/${rehydrated.length} running bot runtime(s)`);
  } catch (err) {
    console.error('[boot] rehydrateRunningRuntimes failed:', err.message);
  }

  // Crypto Increment E — paper crypto runtime only (separate crypto_status).
  try {
    const cryptoRehydrated = await cryptoTradingEngine.rehydrateCryptoRunningRuntimes();
    const ok = cryptoRehydrated.filter((r) => r.ok).length;
    console.log(`[boot] rehydrated ${ok}/${cryptoRehydrated.length} crypto paper runtime(s)`);
  } catch (err) {
    console.error('[boot] rehydrateCryptoRunningRuntimes failed:', err.message);
  }

  // Synthetics paper runtime (separate synthetic_status).
  try {
    const syntheticRehydrated =
      await syntheticTradingEngine.rehydrateSyntheticRunningRuntimes();
    const ok = syntheticRehydrated.filter((r) => r.ok).length;
    console.log(
      `[boot] rehydrated ${ok}/${syntheticRehydrated.length} synthetic paper runtime(s)`
    );
  } catch (err) {
    console.error('[boot] rehydrateSyntheticRunningRuntimes failed:', err.message);
  }

  const server = http.createServer(app);
  attachWebSocketServer(server);
  server.listen(PORT, () => {
    console.log(`Telos backend listening on port ${PORT}`);
    console.log(`WebSocket available at /ws?token=<jwt>`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});