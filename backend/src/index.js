const http = require('http');
const app = require('./app');
const { PORT, assertRealTradingDemoBypassAtStartup } = require('./config/env');
const { connectRedis } = require('./db/redis');
const { attachWebSocketServer } = require('./ws/websocket-server');
const { assertGateConfigAtStartup } = require('./services/access-gate.service');

async function start() {
  assertGateConfigAtStartup();
  // Option 2 E.0 — refuse to boot a production stack if the E1
  // demo-dispatch bypass env var is present at all (any value).
  assertRealTradingDemoBypassAtStartup();
  await connectRedis();
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
