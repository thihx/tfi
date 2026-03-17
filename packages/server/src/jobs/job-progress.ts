// ============================================================
// Job Progress Tracking — Redis-backed progress reporting
//
// Jobs call reportJobProgress() at key steps so the frontend
// can show real-time progress instead of just "Running...".
// Progress is stored in Redis hashes with auto-expiry.
// ============================================================

import { getRedisClient } from '../lib/redis.js';

export interface JobProgress {
  step: string;
  message: string;
  percent: number;
  startedAt: string;
  completedAt: string | null;
  result: string | null;
  error: string | null;
}

const progressKey = (name: string) => `job:progress:${name}`;

export async function reportJobProgress(
  name: string,
  step: string,
  message: string,
  percent: number,
): Promise<void> {
  try {
    const redis = getRedisClient();
    const data: Record<string, string> = {
      step,
      message,
      percent: String(Math.min(100, Math.max(0, Math.round(percent)))),
    };
    const existing = await redis.hget(progressKey(name), 'startedAt');
    if (!existing) {
      data.startedAt = new Date().toISOString();
    }
    await redis.hset(progressKey(name), data);
    await redis.expire(progressKey(name), 600);
  } catch {
    // ignore — progress is non-critical
  }
}

export async function completeJobProgress(
  name: string,
  result: unknown,
  error: string | null,
): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.hset(progressKey(name), {
      percent: '100',
      completedAt: new Date().toISOString(),
      result: result ? JSON.stringify(result) : '',
      error: error || '',
      message: error ? `Failed: ${error}` : 'Completed',
      step: 'done',
    });
    await redis.expire(progressKey(name), 300);
  } catch {
    // ignore
  }
}

export async function clearJobProgress(name: string): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.del(progressKey(name));
  } catch {
    // ignore
  }
}

export async function getJobProgress(name: string): Promise<JobProgress | null> {
  try {
    const redis = getRedisClient();
    const data = await redis.hgetall(progressKey(name));
    if (!data || !data.startedAt) return null;
    return {
      step: data.step || '',
      message: data.message || '',
      percent: Number(data.percent || 0),
      startedAt: data.startedAt,
      completedAt: data.completedAt || null,
      result: data.result || null,
      error: data.error || null,
    };
  } catch {
    return null;
  }
}
