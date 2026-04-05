import type { AppConfig } from '@/types';
import { internalApiUrl } from '@/lib/internal-api';
import { getToken } from '@/lib/services/auth';

export interface ServerParsedAiResult {
  decision_kind?: 'ai_push' | 'condition_only' | 'no_bet';
  should_push?: boolean;
  ai_should_push?: boolean;
  system_should_bet?: boolean;
  final_should_bet?: boolean;
  selection?: string;
  bet_market?: string;
  confidence?: number;
  reasoning_en?: string;
  reasoning_vi?: string;
  warnings?: string[];
  value_percent?: number;
  risk_level?: string;
  stake_percent?: number;
  condition_triggered_suggestion?: string;
  custom_condition_matched?: boolean;
  custom_condition_status?: 'none' | 'evaluated' | 'parse_error';
  custom_condition_summary_en?: string;
  custom_condition_summary_vi?: string;
  custom_condition_reason_en?: string;
  custom_condition_reason_vi?: string;
  condition_triggered_reasoning_en?: string;
  condition_triggered_reasoning_vi?: string;
  condition_triggered_confidence?: number;
  condition_triggered_stake?: number;
  condition_triggered_should_push?: boolean;
  follow_up_answer_en?: string;
  follow_up_answer_vi?: string;
}

export interface ServerMatchPipelineResult {
  matchId: string;
  matchDisplay?: string;
  homeName?: string;
  awayName?: string;
  league?: string;
  minute?: number | string;
  score?: string;
  status?: string;
  success: boolean;
  decisionKind: 'ai_push' | 'condition_only' | 'no_bet';
  shouldPush: boolean;
  selection: string;
  confidence: number;
  saved: boolean;
  notified: boolean;
  error?: string;
  debug?: {
    analysisMode?: string;
    promptVersion?: string;
    promptDataLevel?: 'basic-only' | 'advanced-upgraded';
    prematchAvailability?: 'full' | 'partial' | 'minimal' | 'none';
    prematchNoisePenalty?: number | null;
    prematchStrength?: 'strong' | 'moderate' | 'weak' | 'none';
    statsSource?: string;
    evidenceMode?: string;
    totalLatencyMs?: number;
    advisoryOnly?: boolean;
    parsed?: ServerParsedAiResult;
  };
}

export interface AskAiFollowUpMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface LiveMonitorTarget {
  matchId: string;
  matchDisplay: string;
  league: string;
  status: string | null;
  minute: number | null;
  score: string;
  live: boolean;
  mode: string;
  priority: number;
  customConditions: string;
  recommendedCondition: string;
  lastChecked: string | null;
  totalChecks: number;
  candidate: boolean;
  candidateReason: string;
  baseline: 'none' | 'recommendation' | 'snapshot';
}

export interface LiveMonitorStatusResponse {
  job: {
    name: 'check-live-trigger';
    intervalMs: number;
    enabled: boolean;
    running: boolean;
    lastRun: string | null;
    lastError: string | null;
    runCount: number;
  };
  progress: {
    step: string;
    message: string;
    percent: number;
    startedAt: string;
    completedAt: string | null;
    error: string | null;
  } | null;
  monitoring: {
    activeWatchCount: number;
    liveWatchCount: number;
    candidateCount: number;
    targets: LiveMonitorTarget[];
  };
  summary: {
    liveCount: number;
    candidateCount: number;
    processed: number;
    savedRecommendations: number;
    pushedNotifications: number;
    errors: number;
  } | null;
  results: ServerMatchPipelineResult[];
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function apiUrl(config: AppConfig, path: string): string {
  return internalApiUrl(path, config);
}

async function parseJsonResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchLiveMonitorStatus(config: AppConfig): Promise<LiveMonitorStatusResponse> {
  const res = await fetch(apiUrl(config, '/api/live-monitor/status'), {
    headers: { Accept: 'application/json', ...authHeaders() },
    credentials: 'include',
  });
  return parseJsonResponse<LiveMonitorStatusResponse>(res);
}

export async function analyzeMatchWithServerPipeline(
  config: AppConfig,
  matchId: string,
  options: { question?: string; history?: AskAiFollowUpMessage[] } = {},
): Promise<ServerMatchPipelineResult> {
  const res = await fetch(apiUrl(config, `/api/live-monitor/matches/${encodeURIComponent(matchId)}/analyze`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    credentials: 'include',
    body: JSON.stringify({
      question: typeof options.question === 'string' && options.question.trim() ? options.question.trim() : undefined,
      history: Array.isArray(options.history) ? options.history : undefined,
    }),
  });
  const payload = await parseJsonResponse<{ result: ServerMatchPipelineResult }>(res);
  return payload.result;
}

export function getParsedAiResult(result: ServerMatchPipelineResult): ServerParsedAiResult | null {
  const parsed = result.debug?.parsed;
  return parsed && typeof parsed === 'object' ? parsed : null;
}
