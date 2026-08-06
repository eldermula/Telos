const app = require('./app');
const { PORT } = require('./config/env');
const { connectRedis } = require('./db/redis');

async function start() {
  await connectRedis();
  app.listen(PORT, () => {
    console.log(`Telos backend listening on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
