// ============================================================
// Redis Client — singleton ioredis instance
// Adapted from c:\vocs\src\lib\redis.ts
// ============================================================

import Redis from 'ioredis';
import { config } from '../config.js';

let redisClient: Redis | null = null;

const KEY_PREFIX = 'tfi:';

export function getRedisClient(): Redis {
  if (!redisClient) {
    const url = config.redisUrl;
    if (url) {
      redisClient = new Redis(url, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        keyPrefix: KEY_PREFIX,
        tls: url.startsWith('rediss://') ? {} : undefined,
      });

      redisClient.on('error', (err) => {
        console.error('[Redis] Connection error:', err.message);
      });

      redisClient.on('reconnecting', (ms: number) => {
        console.log(`[Redis] Reconnecting in ${ms}ms...`);
      });
    } else {
      throw new Error('REDIS_URL not configured');
    }
  }
  return redisClient;
}

export function getKeyPrefix(): string {
  return KEY_PREFIX;
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
