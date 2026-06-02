import { config } from '../config.js';
import { getRedisClient } from './redis.js';
import { openFootballApiCircuitUntilNextUtcMidnight } from './football-api-circuit.js';

export type QuotaTier = 'normal' | 'elevated' | 'high' | 'critical';

export interface FootballApiQuotaStatus {
  count: number;
  limit: number;
  tier: QuotaTier;
  pct: number;
}

const LIVE_CRITICAL_JOBS = new Set([
  'fetch-matches',
  'refresh-live-matches',
  'check-live-trigger',
]);

const IMPORTANT_JOBS = new Set([
  'refresh-provider-insights',
]);

let memoryCount = 0;
let memoryDateKey = '';

function utcDateKey(now = new Date()): string {
  return now.toISOString().substring(0, 10);
}

function redisKey(dateKey: string): string {
  return `football-api:daily-count:${dateKey}`;
}

function ensureMemoryDateKey(dateKey: string): void {
  if (memoryDateKey !== dateKey) {
    memoryDateKey = dateKey;
    memoryCount = 0;
  }
}

export function computeQuotaTier(count: number, limit: number): QuotaTier {
  if (limit <= 0) return 'normal';
  const pct = (count / limit) * 100;
  if (pct >= config.footballApiCriticalPct) return 'critical';
  if (pct >= config.footballApiHighPct) return 'high';
  if (pct >= config.footballApiElevatedPct) return 'elevated';
  return 'normal';
}

export async function incrementFootballApiDailyCount(): Promise<number> {
  const dateKey = utcDateKey();
  ensureMemoryDateKey(dateKey);
  memoryCount++;

  try {
    const redis = getRedisClient();
    const key = redisKey(dateKey);
    const newCount = await redis.incr(key);
    if (newCount === 1) {
      await redis.expire(key, 25 * 60 * 60);
    }
    memoryCount = newCount;
    return newCount;
  } catch {
    return memoryCount;
  }
}

export async function getFootballApiDailyCount(): Promise<number> {
  const dateKey = utcDateKey();
  ensureMemoryDateKey(dateKey);

  try {
    const redis = getRedisClient();
    const raw = await redis.get(redisKey(dateKey));
    if (raw != null) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) {
        memoryCount = Math.max(memoryCount, parsed);
      }
    }
  } catch {
    // fall back to in-memory count
  }

  return memoryCount;
}

export async function getFootballApiQuotaTier(): Promise<QuotaTier> {
  const count = await getFootballApiDailyCount();
  return computeQuotaTier(count, config.footballApiDailyLimit);
}

export async function shouldThrottleJob(jobName: string): Promise<boolean> {
  if (LIVE_CRITICAL_JOBS.has(jobName)) return false;

  const tier = await getFootballApiQuotaTier();

  if (tier === 'critical') return true;
  if (tier === 'high') return !LIVE_CRITICAL_JOBS.has(jobName);
  if (tier === 'elevated') return !LIVE_CRITICAL_JOBS.has(jobName) && !IMPORTANT_JOBS.has(jobName);
  return false;
}

export async function checkAndTripCircuitAtCritical(): Promise<boolean> {
  const tier = await getFootballApiQuotaTier();
  if (tier === 'critical') {
    await openFootballApiCircuitUntilNextUtcMidnight();
    return true;
  }
  return false;
}

export async function getFootballApiQuotaStatus(): Promise<FootballApiQuotaStatus> {
  const count = await getFootballApiDailyCount();
  const limit = config.footballApiDailyLimit;
  const tier = computeQuotaTier(count, limit);
  const pct = limit > 0 ? Math.round((count / limit) * 1000) / 10 : 0;
  return { count, limit, tier, pct };
}

export function resetFootballApiQuotaForTests(): void {
  memoryCount = 0;
  memoryDateKey = '';
}
