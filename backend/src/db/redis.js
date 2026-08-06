const Redis = require('ioredis');
const { REDIS_URL } = require('../config/env');

const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

redis.on('error', (err) => {
  console.error('[redis]', err.message);
});

async function connectRedis() {
  if (redis.status === 'wait') {
    await redis.connect();
  }
}

module.exports = { redis, connectRedis };
