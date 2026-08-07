const http = require('http');
const app = require('./app');
const { PORT } = require('./config/env');
const { connectRedis } = require('./db/redis');
const { attachWebSocketServer } = require('./ws/websocket-server');
const { assertGateConfigAtStartup } = require('./services/access-gate.service');

async function start() {
  assertGateConfigAtStartup();
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
