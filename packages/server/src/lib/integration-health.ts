// ============================================================
// Integration Health — probe all external services
// ============================================================

import { query } from '../db/pool.js';
import { config } from '../config.js';

export type IntegrationStatus = 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'NOT_CONFIGURED';

export interface IntegrationProbeResult {
  id: string;
  label: string;
  description: string;
  status: IntegrationStatus;
  latencyMs: number;
  message?: string;
  checkedAt: string;
}

export interface IntegrationHealthSnapshot {
  overall: IntegrationStatus;
  checkedAt: string;
  durationMs: number;
  services: IntegrationProbeResult[];
}

// ── Helpers ──────────────────────────────────────────────────

function isConfigured(...vars: string[]): boolean {
  return vars.every((v) => v && v.trim().length > 0);
}

async function withTimeout<T>(promise: Promise<T>, ms = 8_000): Promise<T> {
  let timerId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timerId));
}

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; latencyMs: number }> {
  const start = Date.now();
  const result = await fn();
  return { result, latencyMs: Date.now() - start };
}

function makeResult(
  id: string,
  label: string,
  description: string,
  status: IntegrationStatus,
  latencyMs: number,
  message?: string,
): IntegrationProbeResult {
  return { id, label, description, status, latencyMs, message, checkedAt: new Date().toISOString() };
}

// ── Probes ───────────────────────────────────────────────────

async function probePostgres(): Promise<IntegrationProbeResult> {
  const ID = 'postgresql';
  const LABEL = 'PostgreSQL Database';
  const DESC = 'Primary data store (pg pool)';
  try {
    const { latencyMs } = await timed(() => withTimeout(query('SELECT 1')));
    return makeResult(ID, LABEL, DESC, 'HEALTHY', latencyMs);
  } catch (err: unknown) {
    return makeResult(ID, LABEL, DESC, 'DOWN', 0, (err as Error).message);
  }
}

async function probeRedis(): Promise<IntegrationProbeResult> {
  const ID = 'redis';
  const LABEL = 'Redis Cache';
  const DESC = 'Job locking & progress tracking';
  if (!isConfigured(config.redisUrl)) {
    return makeResult(ID, LABEL, DESC, 'NOT_CONFIGURED', 0, 'REDIS_URL not set');
  }
  try {
    // Lazy import to avoid crashing if Redis not configured
    const { getRedisClient } = await import('./redis.js');
    const client = getRedisClient();
    const { result: pong, latencyMs } = await timed(() => withTimeout(client.ping()));
    if (pong === 'PONG') return makeResult(ID, LABEL, DESC, 'HEALTHY', latencyMs);
    return makeResult(ID, LABEL, DESC, 'DEGRADED', latencyMs, `Unexpected PING response: ${pong}`);
  } catch (err: unknown) {
    return makeResult(ID, LABEL, DESC, 'DOWN', 0, (err as Error).message);
  }
}

async function probeFootballApi(): Promise<IntegrationProbeResult> {
  const ID = 'football-api';
  const LABEL = 'Football API (API-Sports)';
  const DESC = 'Live match fixtures, stats & odds';
  if (!isConfigured(config.footballApiKey)) {
    return makeResult(ID, LABEL, DESC, 'NOT_CONFIGURED', 0, 'FOOTBALL_API_KEY not set');
  }
  try {
    const { result: res, latencyMs } = await timed(() =>
      withTimeout(
        fetch(`${config.footballApiBaseUrl}/status`, {
          headers: { 'x-apisports-key': config.footballApiKey },
        }),
      ),
    );
    if (res.ok) {
      const data = await res.json() as { response?: { account?: { requests?: { current?: number; limit_day?: number } } } };
      const req = data?.response?.account?.requests;
      const msg = req ? `Requests today: ${req.current ?? '?'}/${req.limit_day ?? '?'}` : undefined;
      return makeResult(ID, LABEL, DESC, 'HEALTHY', latencyMs, msg);
    }
    return makeResult(ID, LABEL, DESC, 'DEGRADED', latencyMs, `HTTP ${res.status}`);
  } catch (err: unknown) {
    return makeResult(ID, LABEL, DESC, 'DOWN', 0, (err as Error).message);
  }
}

async function probeOddsApi(): Promise<IntegrationProbeResult> {
  const ID = 'odds-api';
  const LABEL = 'The Odds API';
  const DESC = 'Fallback odds source';
  if (!isConfigured(config.theOddsApiKey)) {
    return makeResult(ID, LABEL, DESC, 'NOT_CONFIGURED', 0, 'THE_ODDS_API_KEY not set');
  }
  try {
    const { result: res, latencyMs } = await timed(() =>
      withTimeout(
        fetch(`${config.theOddsApiBaseUrl}/sports?apiKey=${config.theOddsApiKey}&all=false`),
      ),
    );
    if (res.ok) return makeResult(ID, LABEL, DESC, 'HEALTHY', latencyMs);
    if (res.status === 401) return makeResult(ID, LABEL, DESC, 'DOWN', latencyMs, 'Invalid API key');
    return makeResult(ID, LABEL, DESC, 'DEGRADED', latencyMs, `HTTP ${res.status}`);
  } catch (err: unknown) {
    return makeResult(ID, LABEL, DESC, 'DOWN', 0, (err as Error).message);
  }
}

async function probeGemini(): Promise<IntegrationProbeResult> {
  const ID = 'gemini';
  const LABEL = 'Google Gemini AI';
  const DESC = 'AI analysis & recommendations';
  if (!isConfigured(config.geminiApiKey)) {
    return makeResult(ID, LABEL, DESC, 'NOT_CONFIGURED', 0, 'GEMINI_API_KEY not set');
  }
  try {
    // List models — lightweight, no token consumption
    const { result: res, latencyMs } = await timed(() =>
      withTimeout(
        fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${config.geminiApiKey}&pageSize=1`,
        ),
      ),
    );
    if (res.ok) return makeResult(ID, LABEL, DESC, 'HEALTHY', latencyMs);
    if (res.status === 400 || res.status === 403) {
      return makeResult(ID, LABEL, DESC, 'DOWN', latencyMs, `Auth error HTTP ${res.status}`);
    }
    return makeResult(ID, LABEL, DESC, 'DEGRADED', latencyMs, `HTTP ${res.status}`);
  } catch (err: unknown) {
    return makeResult(ID, LABEL, DESC, 'DOWN', 0, (err as Error).message);
  }
}

async function probeTelegram(): Promise<IntegrationProbeResult> {
  const ID = 'telegram';
  const LABEL = 'Telegram Bot';
  const DESC = 'Match & pipeline notifications';
  if (!isConfigured(config.telegramBotToken)) {
    return makeResult(ID, LABEL, DESC, 'NOT_CONFIGURED', 0, 'TELEGRAM_BOT_TOKEN not set');
  }
  try {
    const { result: res, latencyMs } = await timed(() =>
      withTimeout(
        fetch(`https://api.telegram.org/bot${config.telegramBotToken}/getMe`),
      ),
    );
    const data = await res.json() as { ok: boolean; result?: { username?: string } };
    if (data.ok) {
      return makeResult(ID, LABEL, DESC, 'HEALTHY', latencyMs, `Bot: @${data.result?.username ?? '?'}`);
    }
    return makeResult(ID, LABEL, DESC, 'DOWN', latencyMs, 'Bot token invalid');
  } catch (err: unknown) {
    return makeResult(ID, LABEL, DESC, 'DOWN', 0, (err as Error).message);
  }
}

async function probeGoogleOAuth(): Promise<IntegrationProbeResult> {
  const ID = 'google-oauth';
  const LABEL = 'Google OAuth';
  const DESC = 'User authentication';
  if (!isConfigured(config.googleClientId, config.googleClientSecret)) {
    return makeResult(ID, LABEL, DESC, 'NOT_CONFIGURED', 0, 'GOOGLE_CLIENT_ID/SECRET not set');
  }
  try {
    // Reachability check — just hit the discovery endpoint (no auth needed)
    const { result: res, latencyMs } = await timed(() =>
      withTimeout(
        fetch('https://accounts.google.com/.well-known/openid-configuration'),
      ),
    );
    if (res.ok) return makeResult(ID, LABEL, DESC, 'HEALTHY', latencyMs, 'Endpoint reachable');
    return makeResult(ID, LABEL, DESC, 'DEGRADED', latencyMs, `HTTP ${res.status}`);
  } catch (err: unknown) {
    return makeResult(ID, LABEL, DESC, 'DOWN', 0, (err as Error).message);
  }
}

// ── Aggregate status ─────────────────────────────────────────

function deriveOverallStatus(services: IntegrationProbeResult[]): IntegrationStatus {
  const active = services.filter((s) => s.status !== 'NOT_CONFIGURED');
  if (active.some((s) => s.status === 'DOWN')) return 'DOWN';
  if (active.some((s) => s.status === 'DEGRADED')) return 'DEGRADED';
  if (active.length === 0) return 'NOT_CONFIGURED';
  return 'HEALTHY';
}

// ── Public API ───────────────────────────────────────────────

export async function checkAllIntegrations(): Promise<IntegrationHealthSnapshot> {
  const start = Date.now();
  const services = await Promise.all([
    probePostgres(),
    probeRedis(),
    probeFootballApi(),
    probeOddsApi(),
    probeGemini(),
    probeTelegram(),
    probeGoogleOAuth(),
  ]);
  return {
    overall: deriveOverallStatus(services),
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - start,
    services,
  };
}

export async function checkSingleIntegration(id: string): Promise<IntegrationProbeResult | null> {
  const map: Record<string, () => Promise<IntegrationProbeResult>> = {
    postgresql:   probePostgres,
    redis:        probeRedis,
    'football-api': probeFootballApi,
    'odds-api':   probeOddsApi,
    gemini:       probeGemini,
    telegram:     probeTelegram,
    'google-oauth': probeGoogleOAuth,
  };
  return map[id] ? map[id]() : null;
}
