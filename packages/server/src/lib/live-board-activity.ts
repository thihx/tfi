import { getRedisClient } from './redis.js';

const PUBLIC_LIVE_BOARD_ACTIVE_KEY = 'matches-live-board:active';
const PUBLIC_LIVE_BOARD_ACTIVE_TTL_MS = 20_000;

export async function markPublicLiveBoardActive(now = Date.now()): Promise<void> {
  await getRedisClient().set(
    PUBLIC_LIVE_BOARD_ACTIVE_KEY,
    String(now),
    'PX',
    PUBLIC_LIVE_BOARD_ACTIVE_TTL_MS,
  );
}

export async function isPublicLiveBoardActive(): Promise<boolean> {
  try {
    const raw = await getRedisClient().get(PUBLIC_LIVE_BOARD_ACTIVE_KEY);
    return raw != null;
  } catch (err) {
    console.warn('[liveBoardActivity] Redis unavailable, disabling public live refresh', err);
    return false;
  }
}
