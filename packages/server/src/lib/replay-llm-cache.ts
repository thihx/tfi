import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { SettledReplayScenario } from './db-replay-scenarios.js';

export interface ReplayLlmCacheEntry {
  generatedAt: string;
  recommendationId: number;
  scenarioName: string;
  promptVersion: string;
  oddsMode: 'recorded' | 'live' | 'mock';
  aiText: string;
  prompt?: string | null;
  selection?: string | null;
}

function sanitizeFilePart(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'replay';
}

export function buildReplayLlmCachePath(
  cacheDir: string,
  scenario: Pick<SettledReplayScenario, 'name' | 'metadata'>,
  promptVersion: string,
  oddsMode: ReplayLlmCacheEntry['oddsMode'],
  /** e.g. settled-trace when prompt/policy differ from generic replay */
  variant?: string,
): string {
  const recommendationId = Number(scenario.metadata?.recommendationId ?? 0) || 0;
  const parts = [
    recommendationId || 'no-rec',
    sanitizeFilePart(scenario.name),
    sanitizeFilePart(promptVersion),
    sanitizeFilePart(oddsMode),
  ];
  const v = String(variant ?? '').trim();
  if (v) parts.push(sanitizeFilePart(v));
  const filename = parts.join('__') + '.json';
  return resolve(cacheDir, filename);
}

export function loadReplayLlmCache(cachePath: string): ReplayLlmCacheEntry | null {
  if (!existsSync(cachePath)) return null;
  try {
    return JSON.parse(readFileSync(cachePath, 'utf8')) as ReplayLlmCacheEntry;
  } catch {
    return null;
  }
}

export function saveReplayLlmCache(cachePath: string, entry: ReplayLlmCacheEntry): void {
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(entry, null, 2));
}
