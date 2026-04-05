import type { AiAnalysisPanelEntry } from '@/components/ui/AiAnalysisPanel';
import { getToken, getUser } from '@/lib/services/auth';

const STORAGE_PREFIX = 'tfi:matchesAiResults:v1:';
const MAX_ENTRIES = 30;
const MAX_JSON_CHARS = 3_500_000;

function storageKey(): string {
  const uid = getUser(getToken())?.userId;
  return `${STORAGE_PREFIX}${uid && uid.length > 0 ? uid : 'anon'}`;
}

function serializeMap(map: Map<string, AiAnalysisPanelEntry>): string {
  return JSON.stringify({
    v: 1 as const,
    entries: Array.from(map.entries()),
  });
}

function trimByEntryCount(map: Map<string, AiAnalysisPanelEntry>): Map<string, AiAnalysisPanelEntry> {
  if (map.size <= MAX_ENTRIES) return map;
  const entries = Array.from(map.entries());
  return new Map(entries.slice(-MAX_ENTRIES));
}

function trimByJsonSize(map: Map<string, AiAnalysisPanelEntry>): Map<string, AiAnalysisPanelEntry> {
  let m = trimByEntryCount(map);
  let json = serializeMap(m);
  while (json.length > MAX_JSON_CHARS && m.size > 1) {
    const firstKey = m.keys().next().value;
    if (firstKey === undefined) break;
    m = new Map(m);
    m.delete(firstKey);
    json = serializeMap(m);
  }
  return m;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function looksLikeEntry(x: unknown): x is AiAnalysisPanelEntry {
  if (!isRecord(x)) return false;
  if (typeof x.matchId !== 'string' || typeof x.matchDisplay !== 'string') return false;
  if (!isRecord(x.result)) return false;
  const r = x.result as Record<string, unknown>;
  // Pipeline result always has matchId; success may be absent in older persisted payloads
  if (typeof r.matchId !== 'string') return false;
  if ('success' in r && typeof r.success !== 'boolean') return false;
  return true;
}

export function loadMatchesAiResultsFromStorage(): Map<string, AiAnalysisPanelEntry> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed.v !== 1 || !Array.isArray(parsed.entries)) return null;
    const out = new Map<string, AiAnalysisPanelEntry>();
    for (const row of parsed.entries) {
      if (!Array.isArray(row) || row.length !== 2) continue;
      const [id, entry] = row;
      if (typeof id !== 'string' || !looksLikeEntry(entry)) continue;
      out.set(id, entry);
    }
    return out.size > 0 ? out : null;
  } catch {
    return null;
  }
}

export function saveMatchesAiResultsToStorage(map: Map<string, AiAnalysisPanelEntry>): void {
  if (typeof window === 'undefined') return;
  try {
    const trimmed = trimByJsonSize(map);
    const json = serializeMap(trimmed);
    localStorage.setItem(storageKey(), json);
  } catch {
    // QuotaExceeded or private mode
  }
}