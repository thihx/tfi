import { config } from '../config.js';
import { getRedisClient } from './redis.js';

export const FOOTBALL_API_CIRCUIT_KEY = 'football-api:daily-limit-until';
export const FOOTBALL_API_SKIP_REASON = 'football_api_daily_limit' as const;

export type FootballApiSkipReason = typeof FOOTBALL_API_SKIP_REASON;

export interface FootballApiJobSkipResult {
  skipped: true;
  skipReason: FootballApiSkipReason;
  openUntil: string;
}

export class FootballApiDailyLimitError extends Error {
  readonly code = FOOTBALL_API_SKIP_REASON;
  readonly openUntil: string;

  constructor(openUntil: string, message = 'Football API daily request limit reached') {
    super(`${message} (football_api_daily_limit until ${openUntil})`);
    this.name = 'FootballApiDailyLimitError';
    this.openUntil = openUntil;
  }
}

let memoryOpenUntilMs: number | null = null;

export function getNextUtcMidnightMs(now = Date.now()): number {
  const current = new Date(now);
  return Date.UTC(
    current.getUTCFullYear(),
    current.getUTCMonth(),
    current.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  );
}

export function isFootballApiDailyLimitMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('request limit for the day')
    || normalized.includes('reached the request limit')
    || normalized.includes('"requests"')
      && normalized.includes('limit');
}

function parseOpenUntilMs(raw: string | null | undefined): number | null {
  if (raw == null || raw === '') return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= Date.now()) return null;
  return parsed;
}

function readMemoryOpenUntilMs(): number | null {
  if (memoryOpenUntilMs == null || memoryOpenUntilMs <= Date.now()) {
    memoryOpenUntilMs = null;
    return null;
  }
  return memoryOpenUntilMs;
}

function writeMemoryOpenUntilMs(untilMs: number): void {
  memoryOpenUntilMs = untilMs;
}

export function resetFootballApiCircuitForTests(): void {
  memoryOpenUntilMs = null;
}

export async function openFootballApiCircuitUntil(untilMs: number): Promise<string> {
  const openUntil = new Date(untilMs).toISOString();
  writeMemoryOpenUntilMs(untilMs);

  if (!config.footballApiCircuitEnabled) {
    return openUntil;
  }

  const ttlMs = Math.max(1_000, untilMs - Date.now());
  try {
    const redis = getRedisClient();
    await redis.set(FOOTBALL_API_CIRCUIT_KEY, String(untilMs), 'PX', ttlMs + 5_000);
  } catch (err) {
    console.warn('[football-api-circuit] Redis unavailable, using in-memory circuit only:', err instanceof Error ? err.message : err);
  }

  console.warn(`[football-api-circuit] Circuit open until ${openUntil}`);
  return openUntil;
}

export async function openFootballApiCircuitUntilNextUtcMidnight(now = Date.now()): Promise<string> {
  return openFootballApiCircuitUntil(getNextUtcMidnightMs(now));
}

export async function getFootballApiCircuitOpenUntilMs(): Promise<number | null> {
  const memoryUntil = readMemoryOpenUntilMs();
  if (memoryUntil != null) return memoryUntil;

  try {
    const redis = getRedisClient();
    const raw = await redis.get(FOOTBALL_API_CIRCUIT_KEY);
    const parsed = parseOpenUntilMs(raw);
    if (parsed != null) {
      writeMemoryOpenUntilMs(parsed);
      return parsed;
    }
  } catch {
    // ignore — fall back to memory-only state
  }

  return null;
}

export async function isFootballApiCircuitOpen(): Promise<boolean> {
  if (!config.footballApiCircuitEnabled) return false;
  return (await getFootballApiCircuitOpenUntilMs()) != null;
}

export async function assertFootballApiAvailable(): Promise<void> {
  if (!config.footballApiCircuitEnabled) return;
  const openUntilMs = await getFootballApiCircuitOpenUntilMs();
  if (openUntilMs != null) {
    throw new FootballApiDailyLimitError(new Date(openUntilMs).toISOString());
  }
}

export async function recordFootballApiDailyLimitFromError(err: unknown): Promise<boolean> {
  if (!config.footballApiCircuitEnabled) return false;
  const message = err instanceof Error ? err.message : String(err);
  if (!isFootballApiDailyLimitMessage(message)) return false;
  await openFootballApiCircuitUntilNextUtcMidnight();
  return true;
}

export async function skipIfFootballApiCircuitOpen(): Promise<FootballApiJobSkipResult | null> {
  const openUntilMs = await getFootballApiCircuitOpenUntilMs();
  if (openUntilMs == null) return null;
  return {
    skipped: true,
    skipReason: FOOTBALL_API_SKIP_REASON,
    openUntil: new Date(openUntilMs).toISOString(),
  };
}

export function extractFootballApiDailyLimitError(err: unknown): FootballApiDailyLimitError | null {
  if (err instanceof FootballApiDailyLimitError) return err;
  if (!(err instanceof Error)) return null;
  if (!isFootballApiDailyLimitMessage(err.message)) return null;
  const match = err.message.match(/until ([0-9T:\-.]+Z)/);
  const openUntil = match?.[1] ?? new Date(getNextUtcMidnightMs()).toISOString();
  return new FootballApiDailyLimitError(openUntil, 'Football API daily request limit reached');
}
