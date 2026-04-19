// ============================================================
// Strategic Context Service - Gemini + Google Search Grounding
//
// Strategic context v2 goals:
// - Keep legacy flat aliases for existing UI/runtime consumers
// - Add structured quantitative priors useful for betting
// - Persist bilingual EN/VI qualitative notes
// - Capture trusted-source metadata from grounded search results
// ============================================================

import { config } from '../config.js';
import { generateGeminiContent as requestGeminiContent } from './gemini.js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  classifyStrategicSourceDomain,
  type StrategicSearchQuality,
  type StrategicSourceTrustTier,
  type StrategicSourceType,
} from '../config/strategic-source-policy.js';

const REQUEST_TIMEOUT_MS = 90_000;
const STRUCTURE_REQUEST_TIMEOUT_MS = 45_000;
const QUANT_EXTRACTION_TIMEOUT_MS = 28_000;

const NO_DATA = 'No data found';
const NO_DATA_VI = 'Không tìm thấy dữ liệu';

export type StrategicCompetitionType =
  | 'domestic_league'
  | 'domestic_cup'
  | 'european'
  | 'international'
  | 'friendly'
  | '';

export type StrategicConditionScoreState =
  | 'any'
  | 'draw'
  | 'home_leading'
  | 'away_leading'
  | 'not_home_leading'
  | 'not_away_leading';
export type StrategicConditionGoalState =
  | 'any'
  | 'goals_lte_0'
  | 'goals_lte_1'
  | 'goals_lte_2'
  | 'goals_gte_1'
  | 'goals_gte_2'
  | 'goals_gte_3';
export interface StrategicContextNarrative {
  home_motivation: string;
  away_motivation: string;
  league_positions: string;
  fixture_congestion: string;
  home_fixture_congestion?: string;
  away_fixture_congestion?: string;
  rotation_risk: string;
  key_absences: string;
  home_key_absences?: string;
  away_key_absences?: string;
  h2h_narrative: string;
  summary: string;
}

export interface StrategicContextQuantitative {
  home_last5_points: number | null;
  away_last5_points: number | null;
  home_last5_goals_for: number | null;
  away_last5_goals_for: number | null;
  home_last5_goals_against: number | null;
  away_last5_goals_against: number | null;
  home_home_goals_avg: number | null;
  away_away_goals_avg: number | null;
  home_over_2_5_rate_last10: number | null;
  away_over_2_5_rate_last10: number | null;
  home_btts_rate_last10: number | null;
  away_btts_rate_last10: number | null;
  home_clean_sheet_rate_last10: number | null;
  away_clean_sheet_rate_last10: number | null;
  home_failed_to_score_rate_last10: number | null;
  away_failed_to_score_rate_last10: number | null;
}

export interface StrategicContextSource {
  title: string;
  url: string;
  domain: string;
  publisher: string;
  language: 'en' | 'vi' | 'unknown';
  source_type: StrategicSourceType;
  trust_tier: StrategicSourceTrustTier;
}

export interface StrategicContextSourceMeta {
  search_quality: StrategicSearchQuality;
  web_search_queries: string[];
  sources: StrategicContextSource[];
  trusted_source_count: number;
  rejected_source_count: number;
  rejected_domains: string[];
  prediction_fallback_used?: boolean;
}

export interface StrategicConditionBlueprint {
  alert_window_start: number | null;
  alert_window_end: number | null;
  preferred_score_state: StrategicConditionScoreState;
  preferred_goal_state: StrategicConditionGoalState;
  favoured_side: 'home' | 'away' | 'none';
  alert_rationale_en: string;
  alert_rationale_vi: string;
}

export interface StrategicContext extends StrategicContextNarrative {
  home_motivation_vi: string;
  away_motivation_vi: string;
  league_positions_vi: string;
  fixture_congestion_vi: string;
  home_fixture_congestion_vi?: string;
  away_fixture_congestion_vi?: string;
  rotation_risk_vi: string;
  key_absences_vi: string;
  home_key_absences_vi?: string;
  away_key_absences_vi?: string;
  h2h_narrative_vi: string;
  summary_vi: string;
  searched_at: string;
  version: 2;
  competition_type: StrategicCompetitionType;
  ai_condition: string;
  ai_condition_blueprint: StrategicConditionBlueprint | null;
  ai_condition_reason: string;
  ai_condition_reason_vi: string;
  qualitative: {
    en: StrategicContextNarrative;
    vi: StrategicContextNarrative;
  };
  quantitative: StrategicContextQuantitative;
  source_meta: StrategicContextSourceMeta;
}

export interface StrategicContextUsabilityOptions {
  topLeague?: boolean;
}

export interface StrategicContextFetchOptions extends StrategicContextUsabilityOptions {
  leagueCountry?: string | null;
  rescueMode?: boolean;
  /** Extra grounded attempt focused on recovering numeric priors (internal). */
  quantitativeGroundingPass?: boolean;
  highPriority?: boolean;
  favoriteLeague?: boolean;
}

const EMPTY_NARRATIVE: StrategicContextNarrative = {
  home_motivation: '',
  away_motivation: '',
  league_positions: '',
  fixture_congestion: '',
  home_fixture_congestion: '',
  away_fixture_congestion: '',
  rotation_risk: '',
  key_absences: '',
  home_key_absences: '',
  away_key_absences: '',
  h2h_narrative: '',
  summary: NO_DATA,
};

const EMPTY_QUANTITATIVE: StrategicContextQuantitative = {
  home_last5_points: null,
  away_last5_points: null,
  home_last5_goals_for: null,
  away_last5_goals_for: null,
  home_last5_goals_against: null,
  away_last5_goals_against: null,
  home_home_goals_avg: null,
  away_away_goals_avg: null,
  home_over_2_5_rate_last10: null,
  away_over_2_5_rate_last10: null,
  home_btts_rate_last10: null,
  away_btts_rate_last10: null,
  home_clean_sheet_rate_last10: null,
  away_clean_sheet_rate_last10: null,
  home_failed_to_score_rate_last10: null,
  away_failed_to_score_rate_last10: null,
};

interface StrategicGroundingMetadata {
  queries: string[];
  sources: StrategicContextSource[];
}

interface DraftFallbackPayload {
  competitionType: StrategicCompetitionType;
  qualitativeEn: Partial<StrategicContextNarrative>;
  quantitative: Partial<StrategicContextQuantitative>;
  blueprint: StrategicConditionBlueprint | null;
  reportedQueries: string[];
  reportedDomains: string[];
}

function isStrategicDebugArtifactsEnabled(): boolean {
  const raw = String(process.env['STRATEGIC_CONTEXT_DEBUG_ARTIFACTS'] ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function slugifyForFileName(value: string): string {
  return cleanText(value, 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'unknown';
}

async function writeStrategicDebugArtifact(
  payload: Record<string, unknown>,
  homeTeam: string,
  awayTeam: string,
): Promise<void> {
  if (!isStrategicDebugArtifactsEnabled()) return;
  try {
    const dir = path.resolve(process.cwd(), 'tmp', 'strategic-context-debug');
    await mkdir(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const file = `${ts}-${slugifyForFileName(homeTeam)}-vs-${slugifyForFileName(awayTeam)}.json`;
    await writeFile(path.join(dir, file), JSON.stringify(payload, null, 2), { encoding: 'utf8' });
  } catch {
    // best-effort debug only
  }
}

function cleanText(value: unknown, fallback = ''): string {
  const text = typeof value === 'string' ? value : value == null ? '' : String(value);
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

/** Strip placeholder strings models sometimes emit for missing rationale. */
function sanitizeAiConditionReason(value: unknown): string {
  const t = cleanText(value);
  if (!t) return '';
  const lower = t.toLowerCase();
  if (lower === 'null' || lower === 'undefined' || lower === '(null)') return '';
  return t;
}

function parseDraftKeyValueLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toUpperCase();
    const value = line.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

function cleanNarrativeField(value: unknown): string {
  const text = cleanText(value, NO_DATA);
  return text || NO_DATA;
}

function isNoDataText(value: unknown): boolean {
  const text = cleanText(value).toLowerCase();
  return !text || text === NO_DATA.toLowerCase() || text.startsWith('no data');
}

function normalizeCompetitionType(value: unknown): StrategicCompetitionType {
  const raw = cleanText(value).replace(/["']/g, '').toLowerCase();
  if (
    raw === 'domestic_league'
    || raw === 'domestic_cup'
    || raw === 'european'
    || raw === 'international'
    || raw === 'friendly'
  ) {
    return raw;
  }
  return '';
}

function toNullableNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  const normalized = value
    .trim()
    .replace(/%/g, '')
    .replace(/,/g, '.')
    .replace(/[^\d.\-]/g, '');
  if (!normalized) return null;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function toNullableInteger(value: unknown): number | null {
  const num = toNullableNumber(value);
  if (num == null) return null;
  return Number.isInteger(num) ? num : Math.round(num);
}

function normalizeScoreState(value: unknown): StrategicConditionScoreState {
  const raw = cleanText(value).toLowerCase();
  if (
    raw === 'draw'
    || raw === 'home_leading'
    || raw === 'away_leading'
    || raw === 'not_home_leading'
    || raw === 'not_away_leading'
    || raw === 'any'
  ) {
    return raw;
  }
  return 'any';
}

function normalizeGoalState(value: unknown): StrategicConditionGoalState {
  const raw = cleanText(value).toLowerCase();
  if (
    raw === 'goals_lte_0'
    || raw === 'goals_lte_1'
    || raw === 'goals_lte_2'
    || raw === 'goals_gte_1'
    || raw === 'goals_gte_2'
    || raw === 'goals_gte_3'
    || raw === 'any'
  ) {
    return raw;
  }
  return 'any';
}

function normalizeFavouredSide(value: unknown): 'home' | 'away' | 'none' {
  const raw = cleanText(value).toLowerCase();
  if (raw === 'home' || raw === 'away' || raw === 'none') return raw;
  return 'none';
}

function buildGoalStateAtom(state: StrategicConditionGoalState): string | null {
  switch (state) {
    case 'goals_lte_0':
      return '(Total goals <= 0)';
    case 'goals_lte_1':
      return '(Total goals <= 1)';
    case 'goals_lte_2':
      return '(Total goals <= 2)';
    case 'goals_gte_1':
      return '(Total goals >= 1)';
    case 'goals_gte_2':
      return '(Total goals >= 2)';
    case 'goals_gte_3':
      return '(Total goals >= 3)';
    default:
      return null;
  }
}

function buildScoreStateAtom(state: StrategicConditionScoreState): string | null {
  switch (state) {
    case 'draw':
      return '(Draw)';
    case 'home_leading':
      return '(Home leading)';
    case 'away_leading':
      return '(Away leading)';
    case 'not_home_leading':
      return '(NOT Home leading)';
    case 'not_away_leading':
      return '(NOT Away leading)';
    default:
      return null;
  }
}

function hasSpecificConditionSignal(condition: string): boolean {
  const normalized = cleanText(condition);
  if (!normalized) return false;
  return /(Total goals\s*[<>]=?\s*\d+|Home leading|Away leading|\bDraw\b|NOT Home leading|NOT Away leading)/i.test(normalized);
}

function isMinuteOnlyCondition(condition: string): boolean {
  const normalized = cleanText(condition);
  if (!normalized) return true;
  const hasMinute = /\(Minute\s*[<>]=?\s*\d+\)/i.test(normalized);
  return hasMinute && !hasSpecificConditionSignal(normalized);
}

function normalizeConditionBlueprint(raw: unknown): StrategicConditionBlueprint | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  return {
    alert_window_start: toNullableInteger(obj.alert_window_start),
    alert_window_end: toNullableInteger(obj.alert_window_end),
    preferred_score_state: normalizeScoreState(obj.preferred_score_state),
    preferred_goal_state: normalizeGoalState(obj.preferred_goal_state),
    favoured_side: normalizeFavouredSide(obj.favoured_side),
    alert_rationale_en: cleanText(obj.alert_rationale_en),
    alert_rationale_vi: cleanText(obj.alert_rationale_vi),
  };
}

function averageNumbers(...values: Array<number | null | undefined>): number | null {
  const filtered = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (filtered.length === 0) return null;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function normalizeRate01(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value > 1.5) return Math.max(0, Math.min(1, value / 100));
  return Math.max(0, Math.min(1, value));
}

function finalizeQuantitativeRates01(quantitative: StrategicContextQuantitative): StrategicContextQuantitative {
  return {
    ...quantitative,
    home_over_2_5_rate_last10: normalizeRate01(quantitative.home_over_2_5_rate_last10),
    away_over_2_5_rate_last10: normalizeRate01(quantitative.away_over_2_5_rate_last10),
    home_btts_rate_last10: normalizeRate01(quantitative.home_btts_rate_last10),
    away_btts_rate_last10: normalizeRate01(quantitative.away_btts_rate_last10),
    home_clean_sheet_rate_last10: normalizeRate01(quantitative.home_clean_sheet_rate_last10),
    away_clean_sheet_rate_last10: normalizeRate01(quantitative.away_clean_sheet_rate_last10),
    home_failed_to_score_rate_last10: normalizeRate01(quantitative.home_failed_to_score_rate_last10),
    away_failed_to_score_rate_last10: normalizeRate01(quantitative.away_failed_to_score_rate_last10),
  };
}

function mergeQuantitativePreferExisting(
  base: StrategicContextQuantitative,
  patch: StrategicContextQuantitative,
): StrategicContextQuantitative {
  const keys: (keyof StrategicContextQuantitative)[] = [
    'home_last5_points',
    'away_last5_points',
    'home_last5_goals_for',
    'away_last5_goals_for',
    'home_last5_goals_against',
    'away_last5_goals_against',
    'home_home_goals_avg',
    'away_away_goals_avg',
    'home_over_2_5_rate_last10',
    'away_over_2_5_rate_last10',
    'home_btts_rate_last10',
    'away_btts_rate_last10',
    'home_clean_sheet_rate_last10',
    'away_clean_sheet_rate_last10',
    'home_failed_to_score_rate_last10',
    'away_failed_to_score_rate_last10',
  ];
  const out: StrategicContextQuantitative = { ...base };
  const writable = out as unknown as Record<string, number | null>;
  const patchValues = patch as unknown as Record<string, number | null>;
  for (const key of keys) {
    const k = key as string;
    if (writable[k] == null && patchValues[k] != null) {
      writable[k] = patchValues[k]!;
    }
  }
  return finalizeQuantitativeRates01(out);
}

function isWindowValid(start: number | null, end: number | null): boolean {
  if (start == null || start < 1 || start > 90) return false;
  if (end != null && (end <= start || end > 95)) return false;
  return true;
}

function inferMinuteWindow(quantitative: StrategicContextQuantitative): { start: number; end: number } {
  const over25 = averageNumbers(
    normalizeRate01(quantitative.home_over_2_5_rate_last10),
    normalizeRate01(quantitative.away_over_2_5_rate_last10),
  );
  const btts = averageNumbers(
    normalizeRate01(quantitative.home_btts_rate_last10),
    normalizeRate01(quantitative.away_btts_rate_last10),
  );
  const goalsAvg = averageNumbers(quantitative.home_home_goals_avg, quantitative.away_away_goals_avg);
  const cleanSheet = averageNumbers(
    normalizeRate01(quantitative.home_clean_sheet_rate_last10),
    normalizeRate01(quantitative.away_clean_sheet_rate_last10),
  );
  const failedToScore = averageNumbers(
    normalizeRate01(quantitative.home_failed_to_score_rate_last10),
    normalizeRate01(quantitative.away_failed_to_score_rate_last10),
  );
  const avgGoalsForPerMatch = averageNumbers(
    quantitative.home_last5_goals_for != null ? quantitative.home_last5_goals_for / 5 : null,
    quantitative.away_last5_goals_for != null ? quantitative.away_last5_goals_for / 5 : null,
  );

  const openGameSignal = (over25 != null && over25 >= 0.62)
    || (btts != null && btts >= 0.62)
    || (goalsAvg != null && goalsAvg >= 3.0)
    || (avgGoalsForPerMatch != null && avgGoalsForPerMatch >= 1.5);
  const tightGameSignal = (cleanSheet != null && cleanSheet >= 0.38)
    || (failedToScore != null && failedToScore >= 0.33)
    || (goalsAvg != null && goalsAvg <= 2.1)
    || (avgGoalsForPerMatch != null && avgGoalsForPerMatch <= 1.0);

  if (openGameSignal && !tightGameSignal) return { start: 52, end: 82 };
  if (tightGameSignal && !openGameSignal) return { start: 64, end: 88 };
  return { start: 58, end: 84 };
}

function inferScoreStateFromQuantitative(quantitative: StrategicContextQuantitative): StrategicConditionScoreState {
  const hasPoints = quantitative.home_last5_points != null && quantitative.away_last5_points != null;
  const hasGoals = quantitative.home_last5_goals_for != null && quantitative.away_last5_goals_for != null;
  if (!hasPoints && !hasGoals) return 'any';
  const pointsDiff = (quantitative.home_last5_points ?? 0) - (quantitative.away_last5_points ?? 0);
  const goalsDiff = (quantitative.home_last5_goals_for ?? 0) - (quantitative.away_last5_goals_for ?? 0);
  const combined = pointsDiff + goalsDiff * 0.5;

  if (combined >= 4) return 'home_leading';
  if (combined <= -4) return 'away_leading';
  if (Math.abs(combined) <= 1.5) return 'draw';
  return combined > 0 ? 'not_away_leading' : 'not_home_leading';
}

function inferScoreStateFromNarrative(qualitative: StrategicContextNarrative): StrategicConditionScoreState {
  const leaguePositions = cleanText(qualitative.league_positions).toLowerCase();
  if (!leaguePositions || isNoDataText(leaguePositions)) return 'any';

  const homePosMatch = leaguePositions.match(/home[^0-9]{0,30}(\d{1,2})/i);
  const awayPosMatch = leaguePositions.match(/away[^0-9]{0,30}(\d{1,2})/i);
  const homePos = homePosMatch ? Number(homePosMatch[1]) : null;
  const awayPos = awayPosMatch ? Number(awayPosMatch[1]) : null;
  if (homePos != null && awayPos != null && Number.isFinite(homePos) && Number.isFinite(awayPos)) {
    const diff = awayPos - homePos;
    if (diff >= 5) return 'home_leading';
    if (diff <= -5) return 'away_leading';
    if (Math.abs(diff) <= 2) return 'draw';
    return diff > 0 ? 'not_away_leading' : 'not_home_leading';
  }

  return 'any';
}

function inferGoalStateFromQuantitative(quantitative: StrategicContextQuantitative): StrategicConditionGoalState {
  const over25 = averageNumbers(
    normalizeRate01(quantitative.home_over_2_5_rate_last10),
    normalizeRate01(quantitative.away_over_2_5_rate_last10),
  );
  const btts = averageNumbers(
    normalizeRate01(quantitative.home_btts_rate_last10),
    normalizeRate01(quantitative.away_btts_rate_last10),
  );
  const cleanSheet = averageNumbers(
    normalizeRate01(quantitative.home_clean_sheet_rate_last10),
    normalizeRate01(quantitative.away_clean_sheet_rate_last10),
  );
  const failedToScore = averageNumbers(
    normalizeRate01(quantitative.home_failed_to_score_rate_last10),
    normalizeRate01(quantitative.away_failed_to_score_rate_last10),
  );
  const goalsAvg = averageNumbers(quantitative.home_home_goals_avg, quantitative.away_away_goals_avg);
  const avgGoalsForPerMatch = averageNumbers(
    quantitative.home_last5_goals_for != null ? quantitative.home_last5_goals_for / 5 : null,
    quantitative.away_last5_goals_for != null ? quantitative.away_last5_goals_for / 5 : null,
  );

  const evidenceCount = [over25, btts, cleanSheet, failedToScore, goalsAvg, avgGoalsForPerMatch]
    .filter((value) => value != null).length;
  if (evidenceCount === 0) return 'any';

  const openGameSignal = (over25 != null && over25 >= 0.55)
    || (btts != null && btts >= 0.57)
    || (goalsAvg != null && goalsAvg >= 2.7)
    || (avgGoalsForPerMatch != null && avgGoalsForPerMatch >= 1.45);
  const tightGameSignal = (cleanSheet != null && cleanSheet >= 0.4)
    || (failedToScore != null && failedToScore >= 0.35)
    || (goalsAvg != null && goalsAvg <= 2.2)
    || (avgGoalsForPerMatch != null && avgGoalsForPerMatch <= 1.05);

  if (openGameSignal && !tightGameSignal) return 'goals_gte_2';
  if (tightGameSignal && !openGameSignal) return 'goals_lte_2';
  return 'any';
}

function inferGoalStateFromNarrative(qualitative: StrategicContextNarrative): StrategicConditionGoalState {
  const corpus = [
    qualitative.summary,
    qualitative.h2h_narrative,
    qualitative.fixture_congestion,
    qualitative.rotation_risk,
  ]
    .map((value) => cleanText(value).toLowerCase())
    .join(' ');
  if (!corpus || isNoDataText(corpus)) return 'any';

  if (/(high[- ]scoring|many goals|over 2\.5|btts|both teams to score|open game|attacking)/i.test(corpus)) {
    return 'goals_gte_2';
  }
  if (/(low[- ]scoring|under 2\.5|tight game|defensive|few goals|cagey)/i.test(corpus)) {
    return 'goals_lte_2';
  }
  return 'any';
}

function refineConditionBlueprint(
  blueprint: StrategicConditionBlueprint | null,
  quantitative: StrategicContextQuantitative,
  sourceMeta: StrategicContextSourceMeta,
  qualitative?: StrategicContextNarrative | null,
): StrategicConditionBlueprint | null {
  if (!blueprint) return null;

  const preferredScore = blueprint.preferred_score_state;
  const preferredGoal = blueprint.preferred_goal_state;
  const bothAny = preferredScore === 'any' && preferredGoal === 'any';
  const evidenceStrong = sourceMeta.trusted_source_count >= 2
    && (sourceMeta.search_quality === 'medium' || sourceMeta.search_quality === 'high');

  const result: StrategicConditionBlueprint = { ...blueprint };
  if (!isWindowValid(result.alert_window_start, result.alert_window_end)) {
    const inferred = inferMinuteWindow(quantitative);
    result.alert_window_start = inferred.start;
    result.alert_window_end = inferred.end;
  }

  if (bothAny && evidenceStrong) {
    const inferredGoal = inferGoalStateFromQuantitative(quantitative);
    const narrativeGoal = inferredGoal === 'any' && qualitative ? inferGoalStateFromNarrative(qualitative) : 'any';
    if (inferredGoal !== 'any') {
      result.preferred_goal_state = inferredGoal;
    } else if (narrativeGoal !== 'any') {
      result.preferred_goal_state = narrativeGoal;
    } else {
      const quantitativeScore = inferScoreStateFromQuantitative(quantitative);
      const narrativeScore = quantitativeScore === 'any' && qualitative ? inferScoreStateFromNarrative(qualitative) : 'any';
      result.preferred_score_state = quantitativeScore !== 'any' ? quantitativeScore : narrativeScore;
    }
  }

  if (result.favoured_side === 'none') {
    if (result.preferred_score_state === 'home_leading' || result.preferred_score_state === 'not_away_leading') {
      result.favoured_side = 'home';
    } else if (result.preferred_score_state === 'away_leading' || result.preferred_score_state === 'not_home_leading') {
      result.favoured_side = 'away';
    }
  }

  return result;
}

function parseReportedCsvLine(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function countDraftQuantitativeCoverage(quantitative: Partial<StrategicContextQuantitative> | null | undefined): number {
  if (!quantitative || typeof quantitative !== 'object') return 0;
  return Object.values(quantitative).filter((value) => value != null).length;
}

function extractDraftFallbackPayload(draftText: string): DraftFallbackPayload {
  const lines = parseDraftKeyValueLines(draftText);
  return {
    competitionType: normalizeCompetitionType(lines['COMPETITION_TYPE']),
    qualitativeEn: {
      home_motivation: cleanNarrativeField(lines['HOME_MOTIVATION']),
      away_motivation: cleanNarrativeField(lines['AWAY_MOTIVATION']),
      league_positions: cleanNarrativeField(lines['LEAGUE_POSITIONS']),
      fixture_congestion: cleanNarrativeField(lines['FIXTURE_CONGESTION']),
      home_fixture_congestion: cleanNarrativeField(lines['HOME_FIXTURE_CONGESTION']),
      away_fixture_congestion: cleanNarrativeField(lines['AWAY_FIXTURE_CONGESTION']),
      rotation_risk: cleanNarrativeField(lines['ROTATION_RISK']),
      key_absences: cleanNarrativeField(lines['KEY_ABSENCES']),
      home_key_absences: cleanNarrativeField(lines['HOME_KEY_ABSENCES']),
      away_key_absences: cleanNarrativeField(lines['AWAY_KEY_ABSENCES']),
      h2h_narrative: cleanNarrativeField(lines['H2H_NARRATIVE']),
      summary: cleanNarrativeField(lines['SUMMARY']),
    },
    quantitative: {
      home_last5_points: toNullableInteger(lines['HOME_LAST5_POINTS']),
      away_last5_points: toNullableInteger(lines['AWAY_LAST5_POINTS']),
      home_last5_goals_for: toNullableInteger(lines['HOME_LAST5_GOALS_FOR']),
      away_last5_goals_for: toNullableInteger(lines['AWAY_LAST5_GOALS_FOR']),
      home_last5_goals_against: toNullableInteger(lines['HOME_LAST5_GOALS_AGAINST']),
      away_last5_goals_against: toNullableInteger(lines['AWAY_LAST5_GOALS_AGAINST']),
      home_home_goals_avg: toNullableNumber(lines['HOME_HOME_GOALS_AVG']),
      away_away_goals_avg: toNullableNumber(lines['AWAY_AWAY_GOALS_AVG']),
      home_over_2_5_rate_last10: toNullableNumber(lines['HOME_OVER_2_5_RATE_LAST10']),
      away_over_2_5_rate_last10: toNullableNumber(lines['AWAY_OVER_2_5_RATE_LAST10']),
      home_btts_rate_last10: toNullableNumber(lines['HOME_BTTS_RATE_LAST10']),
      away_btts_rate_last10: toNullableNumber(lines['AWAY_BTTS_RATE_LAST10']),
      home_clean_sheet_rate_last10: toNullableNumber(lines['HOME_CLEAN_SHEET_RATE_LAST10']),
      away_clean_sheet_rate_last10: toNullableNumber(lines['AWAY_CLEAN_SHEET_RATE_LAST10']),
      home_failed_to_score_rate_last10: toNullableNumber(lines['HOME_FAILED_TO_SCORE_RATE_LAST10']),
      away_failed_to_score_rate_last10: toNullableNumber(lines['AWAY_FAILED_TO_SCORE_RATE_LAST10']),
    },
    blueprint: normalizeConditionBlueprint({
      alert_window_start: lines['ALERT_WINDOW_START'],
      alert_window_end: lines['ALERT_WINDOW_END'],
      preferred_score_state: lines['PREFERRED_SCORE_STATE'],
      preferred_goal_state: lines['PREFERRED_GOAL_STATE'],
      favoured_side: lines['FAVOURED_SIDE'],
      alert_rationale_en: lines['ALERT_RATIONALE'],
      alert_rationale_vi: '',
    }),
    reportedQueries: parseReportedCsvLine(lines['SEARCH_QUERIES']),
    reportedDomains: parseReportedCsvLine(lines['SOURCE_DOMAINS']).map((domain) => domain.toLowerCase()),
  };
}

export function buildMachineConditionFromBlueprint(blueprint: StrategicConditionBlueprint | null | undefined): string {
  if (!blueprint) return '';
  const start = blueprint.alert_window_start;
  const end = blueprint.alert_window_end;
  if (start == null || start < 1 || start > 90) return '';
  if (end != null && (end <= start || end > 95)) return '';

  const atoms: string[] = [`(Minute >= ${start})`];
  if (end != null) atoms.push(`(Minute <= ${end})`);

  const goalAtom = buildGoalStateAtom(blueprint.preferred_goal_state);
  const scoreAtom = buildScoreStateAtom(blueprint.preferred_score_state);
  if (goalAtom) atoms.push(goalAtom);
  if (scoreAtom) atoms.push(scoreAtom);

  if (atoms.length < 2 || atoms.length > 5) return '';
  return atoms.join(' AND ');
}

function normalizeNarrative(raw: unknown, summaryFallback = NO_DATA): StrategicContextNarrative {
  const obj = typeof raw === 'object' && raw ? raw as Record<string, unknown> : {};
  return {
    home_motivation: cleanNarrativeField(obj.home_motivation),
    away_motivation: cleanNarrativeField(obj.away_motivation),
    league_positions: cleanNarrativeField(obj.league_positions),
    fixture_congestion: cleanNarrativeField(obj.fixture_congestion),
    home_fixture_congestion: cleanNarrativeField(obj.home_fixture_congestion),
    away_fixture_congestion: cleanNarrativeField(obj.away_fixture_congestion),
    rotation_risk: cleanNarrativeField(obj.rotation_risk),
    key_absences: cleanNarrativeField(obj.key_absences),
    home_key_absences: cleanNarrativeField(obj.home_key_absences),
    away_key_absences: cleanNarrativeField(obj.away_key_absences),
    h2h_narrative: cleanNarrativeField(obj.h2h_narrative),
    summary: cleanNarrativeField(obj.summary ?? summaryFallback),
  };
}

function normalizeQuantitative(raw: unknown): StrategicContextQuantitative {
  const obj = typeof raw === 'object' && raw ? raw as Record<string, unknown> : {};
  return {
    home_last5_points: toNullableNumber(obj.home_last5_points),
    away_last5_points: toNullableNumber(obj.away_last5_points),
    home_last5_goals_for: toNullableNumber(obj.home_last5_goals_for),
    away_last5_goals_for: toNullableNumber(obj.away_last5_goals_for),
    home_last5_goals_against: toNullableNumber(obj.home_last5_goals_against),
    away_last5_goals_against: toNullableNumber(obj.away_last5_goals_against),
    home_home_goals_avg: toNullableNumber(obj.home_home_goals_avg),
    away_away_goals_avg: toNullableNumber(obj.away_away_goals_avg),
    home_over_2_5_rate_last10: toNullableNumber(obj.home_over_2_5_rate_last10),
    away_over_2_5_rate_last10: toNullableNumber(obj.away_over_2_5_rate_last10),
    home_btts_rate_last10: toNullableNumber(obj.home_btts_rate_last10),
    away_btts_rate_last10: toNullableNumber(obj.away_btts_rate_last10),
    home_clean_sheet_rate_last10: toNullableNumber(obj.home_clean_sheet_rate_last10),
    away_clean_sheet_rate_last10: toNullableNumber(obj.away_clean_sheet_rate_last10),
    home_failed_to_score_rate_last10: toNullableNumber(obj.home_failed_to_score_rate_last10),
    away_failed_to_score_rate_last10: toNullableNumber(obj.away_failed_to_score_rate_last10),
  };
}

export function countStrategicQuantitativeCoverage(quantitative: StrategicContextQuantitative | null | undefined): number {
  if (!quantitative) return 0;
  return Object.values(quantitative).filter((value) => value != null).length;
}

export function countStrategicNarrativeCoverage(ctx: Partial<StrategicContext> | null | undefined): number {
  if (!ctx || typeof ctx !== 'object') return 0;
  const narrativeRoot = typeof (ctx as Record<string, unknown>).qualitative === 'object' && (ctx as Record<string, unknown>).qualitative
    ? ((ctx as Record<string, unknown>).qualitative as Record<string, unknown>).en as Record<string, unknown> | undefined
    : undefined;
  const pick = (key: keyof StrategicContextNarrative): unknown => {
    const nested = narrativeRoot?.[key];
    return nested ?? (ctx as Record<string, unknown>)[key];
  };
  const narrative = [
    pick('home_motivation'),
    pick('away_motivation'),
    pick('league_positions'),
    pick('fixture_congestion'),
    pick('home_fixture_congestion'),
    pick('away_fixture_congestion'),
    pick('rotation_risk'),
    pick('key_absences'),
    pick('home_key_absences'),
    pick('away_key_absences'),
    pick('h2h_narrative'),
    pick('summary'),
  ];
  return narrative.filter((value) => {
    const text = cleanText(value);
    return !!text && !isNoDataText(text);
  }).length;
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function extractDomainHint(text: string): string {
  const normalized = cleanText(text).toLowerCase();
  if (!normalized) return '';
  const match = normalized.match(/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i);
  return match?.[1]?.replace(/^www\./, '') || '';
}

function normalizeGroundedSourceIdentity(url: string, title: string): { domain: string; publisher: string } {
  const urlDomain = extractDomain(url);
  const titleDomain = extractDomainHint(title);
  if (
    (urlDomain === 'vertexaisearch.cloud.google.com' || urlDomain.endsWith('.googleusercontent.com'))
    && titleDomain
  ) {
    return {
      domain: titleDomain,
      publisher: titleDomain,
    };
  }

  return {
    domain: urlDomain,
    publisher: urlDomain || titleDomain || 'unknown',
  };
}

function detectLanguage(domain: string, url: string): 'en' | 'vi' | 'unknown' {
  if (domain.endsWith('.vn') || /(?:^|[/?&])lang=vi(?:$|[&#])/i.test(url) || /\/vi(?:\/|$)/i.test(url)) {
    return 'vi';
  }
  if (domain) return 'en';
  return 'unknown';
}

function computeSearchQuality(sources: StrategicContextSource[]): StrategicSearchQuality {
  if (sources.length === 0) return 'unknown';
  const trusted = sources.filter((source) => source.trust_tier === 'tier_1' || source.trust_tier === 'tier_2');
  const tier1 = trusted.filter((source) => source.trust_tier === 'tier_1');
  if (tier1.length >= 1 && trusted.length >= 2) return 'high';
  if (tier1.length >= 1 || trusted.length >= 2) return 'medium';
  return 'low';
}

function extractCandidateText(data: Record<string, unknown>): string {
  const candidates = Array.isArray(data.candidates) ? data.candidates as Array<Record<string, unknown>> : [];
  const firstCandidate = candidates[0];
  const content = typeof firstCandidate?.content === 'object' && firstCandidate.content
    ? firstCandidate.content as Record<string, unknown>
    : null;
  const parts = Array.isArray(content?.parts) ? content.parts as Array<Record<string, unknown>> : [];
  const joined = parts
    .map((part) => typeof part.text === 'string' ? part.text : '')
    .filter(Boolean)
    .join('\n')
    .trim();
  return joined;
}

function extractGroundingMetadata(data: unknown): StrategicGroundingMetadata {
  const root = typeof data === 'object' && data ? data as Record<string, unknown> : {};
  const candidates = Array.isArray(root.candidates) ? root.candidates as Array<Record<string, unknown>> : [];
  const urls = new Set<string>();
  const sources: StrategicContextSource[] = [];
  const queries = new Set<string>();

  for (const candidate of candidates) {
    const grounding = typeof candidate.groundingMetadata === 'object' && candidate.groundingMetadata
      ? candidate.groundingMetadata as Record<string, unknown>
      : null;
    if (!grounding) continue;

    const groundingChunks = Array.isArray(grounding.groundingChunks) ? grounding.groundingChunks as Array<Record<string, unknown>> : [];
    for (const chunk of groundingChunks) {
      const web = typeof chunk.web === 'object' && chunk.web ? chunk.web as Record<string, unknown> : null;
      const url = cleanText(web?.uri);
      if (!url || urls.has(url)) continue;
      urls.add(url);
      const title = cleanText(web?.title, 'Unknown source');
      const { domain, publisher } = normalizeGroundedSourceIdentity(url, title);
      const classification = classifyStrategicSourceDomain(domain);
      sources.push({
        title,
        url,
        domain,
        publisher,
        language: detectLanguage(domain, url),
        source_type: classification.sourceType,
        trust_tier: classification.trustTier,
      });
    }

    const webSearchQueries = Array.isArray(grounding.webSearchQueries)
      ? grounding.webSearchQueries
      : [];
    for (const query of webSearchQueries) {
      const normalized = cleanText(query);
      if (normalized) queries.add(normalized);
    }
  }

  return { queries: Array.from(queries), sources };
}

function buildSourceMeta(grounding: StrategicGroundingMetadata): StrategicContextSourceMeta {
  const rejected = grounding.sources.filter((source) => source.trust_tier === 'rejected');
  const trustedCount = grounding.sources.filter((source) => source.trust_tier === 'tier_1' || source.trust_tier === 'tier_2').length;
  return {
    search_quality: computeSearchQuality(grounding.sources),
    web_search_queries: grounding.queries,
    sources: grounding.sources,
    trusted_source_count: trustedCount,
    rejected_source_count: rejected.length,
    rejected_domains: Array.from(new Set(rejected.map((source) => source.domain).filter(Boolean))),
  };
}

function buildReportedSource(domain: string): StrategicContextSource {
  const normalizedDomain = cleanText(domain).toLowerCase();
  const classification = classifyStrategicSourceDomain(normalizedDomain);
  return {
    title: normalizedDomain || 'Unknown source',
    url: normalizedDomain ? `https://${normalizedDomain}` : '',
    domain: normalizedDomain,
    publisher: normalizedDomain || 'unknown',
    language: detectLanguage(normalizedDomain, normalizedDomain ? `https://${normalizedDomain}` : ''),
    source_type: classification.sourceType,
    trust_tier: classification.trustTier,
  };
}

function mergeSourceMeta(
  primary: StrategicContextSourceMeta,
  fallback: DraftFallbackPayload,
): StrategicContextSourceMeta {
  if (primary.sources.length > 0 || primary.web_search_queries.length > 0) {
    return primary;
  }

  const reportedSources = Array.from(new Set(fallback.reportedDomains))
    .filter(Boolean)
    .map((domain) => buildReportedSource(domain));
  const reportedQueries = Array.from(new Set(fallback.reportedQueries));
  return buildSourceMeta({
    queries: reportedQueries,
    sources: reportedSources,
  });
}

export function buildNoDataStrategicContext(searchedAt = new Date().toISOString()): StrategicContext {
  return {
    ...EMPTY_NARRATIVE,
    home_motivation_vi: '',
    away_motivation_vi: '',
    league_positions_vi: '',
    fixture_congestion_vi: '',
    home_fixture_congestion_vi: '',
    away_fixture_congestion_vi: '',
    rotation_risk_vi: '',
    key_absences_vi: '',
    home_key_absences_vi: '',
    away_key_absences_vi: '',
    h2h_narrative_vi: '',
    summary_vi: NO_DATA_VI,
    searched_at: searchedAt,
    version: 2,
    competition_type: '',
    ai_condition: '',
    ai_condition_blueprint: null,
    ai_condition_reason: '',
    ai_condition_reason_vi: '',
    qualitative: {
      en: { ...EMPTY_NARRATIVE },
      vi: {
        home_motivation: '',
        away_motivation: '',
        league_positions: '',
        fixture_congestion: '',
        home_fixture_congestion: '',
        away_fixture_congestion: '',
        rotation_risk: '',
        key_absences: '',
        home_key_absences: '',
        away_key_absences: '',
        h2h_narrative: '',
        summary: NO_DATA_VI,
      },
    },
    quantitative: { ...EMPTY_QUANTITATIVE },
    source_meta: {
      search_quality: 'unknown',
      web_search_queries: [],
      sources: [],
      trusted_source_count: 0,
      rejected_source_count: 0,
      rejected_domains: [],
    },
  };
}

function hasTopLeagueCoverage(ctx: Partial<StrategicContext>): boolean {
  const summary = cleanText(ctx.summary);
  if (!summary || isNoDataText(summary)) return false;

  const searchQuality = cleanText(ctx.source_meta?.search_quality).toLowerCase();
  const quantitativeCoverage = countStrategicQuantitativeCoverage(ctx.quantitative);
  const qualitativeCoverage = countStrategicNarrativeCoverage(ctx);
  const trustedSourceCount = Number(ctx.source_meta?.trusted_source_count ?? 0);
  const predictionFallbackUsed = Boolean((ctx.source_meta as Record<string, unknown> | undefined)?.prediction_fallback_used);

  if (trustedSourceCount >= 1 && qualitativeCoverage >= 5) {
    return true;
  }
  if (predictionFallbackUsed && qualitativeCoverage >= 4 && quantitativeCoverage >= 2) {
    return true;
  }
  if (searchQuality === 'high' || searchQuality === 'medium') {
    return qualitativeCoverage >= 5 || (qualitativeCoverage >= 4 && quantitativeCoverage >= 2);
  }
  return trustedSourceCount >= 1 && qualitativeCoverage >= 4 && quantitativeCoverage >= 2;
}

function scoreStrategicContextCandidate(
  ctx: StrategicContext | null,
  options: StrategicContextUsabilityOptions,
): number {
  if (!ctx) return -1;
  const searchQuality = cleanText(ctx.source_meta?.search_quality).toLowerCase();
  const trustedSourceCount = Number(ctx.source_meta?.trusted_source_count ?? 0);
  const qualitativeCoverage = countStrategicNarrativeCoverage(ctx);
  const quantitativeCoverage = countStrategicQuantitativeCoverage(ctx.quantitative);
  const summaryBonus = !isNoDataText(ctx.summary) ? 10 : 0;
  const qualityBonus = searchQuality === 'high'
    ? 12
    : searchQuality === 'medium'
      ? 8
      : searchQuality === 'low'
        ? 2
        : 0;
  const usableBonus = hasUsableStrategicContext(ctx, options)
    ? (options.topLeague ? 20 : 10)
    : 0;

  return qualityBonus
    + summaryBonus
    + trustedSourceCount * 5
    + qualitativeCoverage * 6
    + quantitativeCoverage * 2
    + usableBonus;
}

export function hasUsableStrategicContext(
  ctx: Partial<StrategicContext> | null | undefined,
  options: StrategicContextUsabilityOptions = {},
): boolean {
  if (!ctx || typeof ctx !== 'object') return false;
  if (ctx.version !== 2) return false;
  if (!ctx.source_meta || typeof ctx.source_meta !== 'object') return false;
  const summary = cleanText(ctx.summary);
  const quality = cleanText(ctx.source_meta?.search_quality).toLowerCase();
  const quantitativeCoverage = countStrategicQuantitativeCoverage(ctx.quantitative);
  const qualitativeCoverage = countStrategicNarrativeCoverage(ctx);
  const trustedSourceCount = Number(ctx.source_meta?.trusted_source_count ?? 0);
  const predictionFallbackUsed = Boolean((ctx.source_meta as unknown as Record<string, unknown> | undefined)?.prediction_fallback_used);

  if (options.topLeague) {
    return hasTopLeagueCoverage(ctx);
  }

  if (quality === 'unknown') return false;
  if (quality === 'low') {
    if (predictionFallbackUsed && qualitativeCoverage >= 4 && quantitativeCoverage >= 2 && !!summary && !isNoDataText(summary)) {
      return true;
    }
    return trustedSourceCount >= 1 && qualitativeCoverage >= 4 && !!summary && !isNoDataText(summary);
  }
  if (summary && !isNoDataText(summary)) return true;
  return quantitativeCoverage >= 4 && quality !== 'low';
}

function extractJsonString(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }
  return null;
}

function normalizeContextPayload(payload: unknown, searchedAt: string, sourceMeta: StrategicContextSourceMeta): StrategicContext {
  const raw = typeof payload === 'object' && payload ? payload as Record<string, unknown> : {};
  const qualitativeRoot = typeof raw.qualitative === 'object' && raw.qualitative
    ? raw.qualitative as Record<string, unknown>
    : {};
  const qualitativeEn = normalizeNarrative(raw.qualitative_en ?? qualitativeRoot.en ?? raw.en);
  const qualitativeVi = normalizeNarrative(raw.qualitative_vi ?? qualitativeRoot.vi ?? raw.vi, NO_DATA_VI);
  const quantitative = normalizeQuantitative(raw.quantitative);
  const competitionType = normalizeCompetitionType(raw.competition_type);
  const rawBlueprint = normalizeConditionBlueprint(raw.condition_blueprint ?? raw.ai_condition_blueprint);
  const blueprint = refineConditionBlueprint(rawBlueprint, quantitative, sourceMeta, qualitativeEn);
  const aiCondition = buildMachineConditionFromBlueprint(blueprint) || cleanText(raw.ai_condition);
  const aiConditionReason = sanitizeAiConditionReason(raw.ai_condition_reason || blueprint?.alert_rationale_en);
  const aiConditionReasonVi = sanitizeAiConditionReason(raw.ai_condition_reason_vi || blueprint?.alert_rationale_vi);

  const context: StrategicContext = {
    ...qualitativeEn,
    home_motivation_vi: qualitativeVi.home_motivation || qualitativeEn.home_motivation,
    away_motivation_vi: qualitativeVi.away_motivation || qualitativeEn.away_motivation,
    league_positions_vi: qualitativeVi.league_positions || qualitativeEn.league_positions,
    fixture_congestion_vi: qualitativeVi.fixture_congestion || qualitativeEn.fixture_congestion,
    home_fixture_congestion_vi: qualitativeVi.home_fixture_congestion || qualitativeEn.home_fixture_congestion,
    away_fixture_congestion_vi: qualitativeVi.away_fixture_congestion || qualitativeEn.away_fixture_congestion,
    rotation_risk_vi: qualitativeVi.rotation_risk || qualitativeEn.rotation_risk,
    key_absences_vi: qualitativeVi.key_absences || qualitativeEn.key_absences,
    home_key_absences_vi: qualitativeVi.home_key_absences || qualitativeEn.home_key_absences,
    away_key_absences_vi: qualitativeVi.away_key_absences || qualitativeEn.away_key_absences,
    h2h_narrative_vi: qualitativeVi.h2h_narrative || qualitativeEn.h2h_narrative,
    summary_vi: qualitativeVi.summary || qualitativeEn.summary,
    searched_at: searchedAt,
    version: 2,
    competition_type: competitionType,
    ai_condition: aiCondition,
    ai_condition_blueprint: blueprint,
    ai_condition_reason: aiConditionReason,
    ai_condition_reason_vi: aiConditionReasonVi,
    qualitative: {
      en: qualitativeEn,
      vi: qualitativeVi,
    },
    quantitative,
    source_meta: sourceMeta,
  };

  if (countStrategicNarrativeCoverage(context) === 0 && countStrategicQuantitativeCoverage(context.quantitative) === 0) {
    const empty = buildNoDataStrategicContext(searchedAt);
    return {
      ...empty,
      competition_type: context.competition_type,
      source_meta: sourceMeta,
    };
  }

  return context;
}

function mergeStrategicContextWithDraftFallback(
  context: StrategicContext,
  draftFallback: DraftFallbackPayload,
  sourceMeta: StrategicContextSourceMeta,
): StrategicContext {
  if (
    sourceMeta.search_quality === 'unknown'
    || (
      sourceMeta.search_quality === 'low'
      && sourceMeta.trusted_source_count <= 0
      && sourceMeta.sources.length === 0
    )
  ) {
    return context;
  }

  const mergedQualitativeEn: StrategicContextNarrative = {
    home_motivation: isNoDataText(context.qualitative.en.home_motivation) ? (draftFallback.qualitativeEn.home_motivation || context.qualitative.en.home_motivation) : context.qualitative.en.home_motivation,
    away_motivation: isNoDataText(context.qualitative.en.away_motivation) ? (draftFallback.qualitativeEn.away_motivation || context.qualitative.en.away_motivation) : context.qualitative.en.away_motivation,
    league_positions: isNoDataText(context.qualitative.en.league_positions) ? (draftFallback.qualitativeEn.league_positions || context.qualitative.en.league_positions) : context.qualitative.en.league_positions,
    fixture_congestion: isNoDataText(context.qualitative.en.fixture_congestion) ? (draftFallback.qualitativeEn.fixture_congestion || context.qualitative.en.fixture_congestion) : context.qualitative.en.fixture_congestion,
    home_fixture_congestion: isNoDataText(context.qualitative.en.home_fixture_congestion) ? (draftFallback.qualitativeEn.home_fixture_congestion || context.qualitative.en.home_fixture_congestion) : context.qualitative.en.home_fixture_congestion,
    away_fixture_congestion: isNoDataText(context.qualitative.en.away_fixture_congestion) ? (draftFallback.qualitativeEn.away_fixture_congestion || context.qualitative.en.away_fixture_congestion) : context.qualitative.en.away_fixture_congestion,
    rotation_risk: isNoDataText(context.qualitative.en.rotation_risk) ? (draftFallback.qualitativeEn.rotation_risk || context.qualitative.en.rotation_risk) : context.qualitative.en.rotation_risk,
    key_absences: isNoDataText(context.qualitative.en.key_absences) ? (draftFallback.qualitativeEn.key_absences || context.qualitative.en.key_absences) : context.qualitative.en.key_absences,
    home_key_absences: isNoDataText(context.qualitative.en.home_key_absences) ? (draftFallback.qualitativeEn.home_key_absences || context.qualitative.en.home_key_absences) : context.qualitative.en.home_key_absences,
    away_key_absences: isNoDataText(context.qualitative.en.away_key_absences) ? (draftFallback.qualitativeEn.away_key_absences || context.qualitative.en.away_key_absences) : context.qualitative.en.away_key_absences,
    h2h_narrative: isNoDataText(context.qualitative.en.h2h_narrative) ? (draftFallback.qualitativeEn.h2h_narrative || context.qualitative.en.h2h_narrative) : context.qualitative.en.h2h_narrative,
    summary: isNoDataText(context.qualitative.en.summary) ? (draftFallback.qualitativeEn.summary || context.qualitative.en.summary) : context.qualitative.en.summary,
  };

  const mergedQuantitative: StrategicContextQuantitative = {
    home_last5_points: context.quantitative.home_last5_points ?? draftFallback.quantitative.home_last5_points ?? null,
    away_last5_points: context.quantitative.away_last5_points ?? draftFallback.quantitative.away_last5_points ?? null,
    home_last5_goals_for: context.quantitative.home_last5_goals_for ?? draftFallback.quantitative.home_last5_goals_for ?? null,
    away_last5_goals_for: context.quantitative.away_last5_goals_for ?? draftFallback.quantitative.away_last5_goals_for ?? null,
    home_last5_goals_against: context.quantitative.home_last5_goals_against ?? draftFallback.quantitative.home_last5_goals_against ?? null,
    away_last5_goals_against: context.quantitative.away_last5_goals_against ?? draftFallback.quantitative.away_last5_goals_against ?? null,
    home_home_goals_avg: context.quantitative.home_home_goals_avg ?? draftFallback.quantitative.home_home_goals_avg ?? null,
    away_away_goals_avg: context.quantitative.away_away_goals_avg ?? draftFallback.quantitative.away_away_goals_avg ?? null,
    home_over_2_5_rate_last10: context.quantitative.home_over_2_5_rate_last10 ?? draftFallback.quantitative.home_over_2_5_rate_last10 ?? null,
    away_over_2_5_rate_last10: context.quantitative.away_over_2_5_rate_last10 ?? draftFallback.quantitative.away_over_2_5_rate_last10 ?? null,
    home_btts_rate_last10: context.quantitative.home_btts_rate_last10 ?? draftFallback.quantitative.home_btts_rate_last10 ?? null,
    away_btts_rate_last10: context.quantitative.away_btts_rate_last10 ?? draftFallback.quantitative.away_btts_rate_last10 ?? null,
    home_clean_sheet_rate_last10: context.quantitative.home_clean_sheet_rate_last10 ?? draftFallback.quantitative.home_clean_sheet_rate_last10 ?? null,
    away_clean_sheet_rate_last10: context.quantitative.away_clean_sheet_rate_last10 ?? draftFallback.quantitative.away_clean_sheet_rate_last10 ?? null,
    home_failed_to_score_rate_last10: context.quantitative.home_failed_to_score_rate_last10 ?? draftFallback.quantitative.home_failed_to_score_rate_last10 ?? null,
    away_failed_to_score_rate_last10: context.quantitative.away_failed_to_score_rate_last10 ?? draftFallback.quantitative.away_failed_to_score_rate_last10 ?? null,
  };

  const mergedSourceMeta = mergeSourceMeta(sourceMeta, draftFallback);
  const rawBlueprint = context.ai_condition_blueprint || draftFallback.blueprint;
  const blueprint = refineConditionBlueprint(rawBlueprint, mergedQuantitative, mergedSourceMeta, mergedQualitativeEn);

  return {
    ...context,
    ...mergedQualitativeEn,
    home_motivation_vi: context.home_motivation_vi || mergedQualitativeEn.home_motivation,
    away_motivation_vi: context.away_motivation_vi || mergedQualitativeEn.away_motivation,
    league_positions_vi: context.league_positions_vi || mergedQualitativeEn.league_positions,
    fixture_congestion_vi: context.fixture_congestion_vi || mergedQualitativeEn.fixture_congestion,
    home_fixture_congestion_vi: context.home_fixture_congestion_vi || mergedQualitativeEn.home_fixture_congestion,
    away_fixture_congestion_vi: context.away_fixture_congestion_vi || mergedQualitativeEn.away_fixture_congestion,
    rotation_risk_vi: context.rotation_risk_vi || mergedQualitativeEn.rotation_risk,
    key_absences_vi: context.key_absences_vi || mergedQualitativeEn.key_absences,
    home_key_absences_vi: context.home_key_absences_vi || mergedQualitativeEn.home_key_absences,
    away_key_absences_vi: context.away_key_absences_vi || mergedQualitativeEn.away_key_absences,
    h2h_narrative_vi: context.h2h_narrative_vi || mergedQualitativeEn.h2h_narrative,
    summary_vi: context.summary_vi || mergedQualitativeEn.summary,
    competition_type: context.competition_type || draftFallback.competitionType,
    ai_condition_blueprint: blueprint,
    ai_condition: context.ai_condition || buildMachineConditionFromBlueprint(blueprint),
    ai_condition_reason: context.ai_condition_reason || blueprint?.alert_rationale_en || '',
    ai_condition_reason_vi: context.ai_condition_reason_vi || blueprint?.alert_rationale_vi || '',
    qualitative: {
      en: mergedQualitativeEn,
      vi: {
        home_motivation: context.qualitative.vi.home_motivation || mergedQualitativeEn.home_motivation,
        away_motivation: context.qualitative.vi.away_motivation || mergedQualitativeEn.away_motivation,
        league_positions: context.qualitative.vi.league_positions || mergedQualitativeEn.league_positions,
        fixture_congestion: context.qualitative.vi.fixture_congestion || mergedQualitativeEn.fixture_congestion,
        home_fixture_congestion: context.qualitative.vi.home_fixture_congestion || mergedQualitativeEn.home_fixture_congestion,
        away_fixture_congestion: context.qualitative.vi.away_fixture_congestion || mergedQualitativeEn.away_fixture_congestion,
        rotation_risk: context.qualitative.vi.rotation_risk || mergedQualitativeEn.rotation_risk,
        key_absences: context.qualitative.vi.key_absences || mergedQualitativeEn.key_absences,
        home_key_absences: context.qualitative.vi.home_key_absences || mergedQualitativeEn.home_key_absences,
        away_key_absences: context.qualitative.vi.away_key_absences || mergedQualitativeEn.away_key_absences,
        h2h_narrative: context.qualitative.vi.h2h_narrative || mergedQualitativeEn.h2h_narrative,
        summary: context.qualitative.vi.summary || mergedQualitativeEn.summary,
      },
    },
    quantitative: mergedQuantitative,
    source_meta: mergedSourceMeta,
  };
}

function parseStrategicResponse(text: string, searchedAt: string, sourceMeta: StrategicContextSourceMeta): StrategicContext {
  const json = extractJsonString(text);
  if (!json) {
    throw new Error('Strategic context response did not contain a JSON object');
  }
  const parsed = JSON.parse(json) as unknown;
  return normalizeContextPayload(parsed, searchedAt, sourceMeta);
}

function buildConditionSpecializationPrompt(
  context: StrategicContext,
  draftText: string,
  attempt: 1 | 2,
): string {
  const machineCondition = cleanText(context.ai_condition || buildMachineConditionFromBlueprint(context.ai_condition_blueprint));
  const compactContext = {
    source_quality: context.source_meta.search_quality,
    trusted_source_count: context.source_meta.trusted_source_count,
    summary_en: context.qualitative.en.summary,
    league_positions: context.qualitative.en.league_positions,
    h2h_narrative: context.qualitative.en.h2h_narrative,
    quantitative: context.quantitative,
    current_machine_condition: machineCondition,
    current_blueprint: context.ai_condition_blueprint,
  };
  const retryBlock = attempt === 2
    ? `
RETRY PASS (STRICT — ATTEMPT 2):
- The first specialization attempt failed or still produced a minute-only condition.
- You MUST output a non-minute-only machine condition when TRUSTED_SOURCE_COUNT >= 3.
- At least one of preferred_goal_state or preferred_score_state MUST NOT be "any".
- Pick the single strongest defensible signal from evidence (prefer goal-state if quantitative is sparse but narrative implies scoring tempo; otherwise score-state from league_positions / momentum).
- Do NOT contradict explicit grounded facts.
`
    : '';
  return `You are improving ONLY the live-betting condition for a high-priority (Top/Favorite) football match.

GOAL:
- Upgrade generic minute-only condition into a specific, actionable condition when trusted evidence exists.
${retryBlock}

STRICT RULES:
- Return STRICT JSON only. No commentary.
- Use only evidence from CONTEXT and GROUNDED NOTES below.
- Keep schema exact (no extra keys).
- condition_blueprint enums allowed:
  - preferred_score_state: "any" | "draw" | "home_leading" | "away_leading" | "not_home_leading" | "not_away_leading"
  - preferred_goal_state: "any" | "goals_lte_0" | "goals_lte_1" | "goals_lte_2" | "goals_gte_1" | "goals_gte_2" | "goals_gte_3"
  - favoured_side: "home" | "away" | "none"
- alert_window_start: integer 1..90, alert_window_end: null or integer > start and <=95.
- ai_condition must be machine-readable and use uppercase " AND".
- Allowed atoms:
  - (Minute >= N)
  - (Minute <= N)
  - (Total goals <= 0|1|2)
  - (Total goals >= 1|2|3)
  - (Draw)
  - (Home leading)
  - (Away leading)
  - (NOT Home leading)
  - (NOT Away leading)
- For this high-priority case, avoid minute-only condition when TRUSTED_SOURCE_COUNT >= 3.
- Prefer adding one specific signal (goal-state or score-state) that is most defensible from evidence.

CONTEXT:
${JSON.stringify(compactContext, null, 2)}

GROUNDED NOTES:
${draftText}

Return STRICT JSON with this schema only:
{
  "condition_blueprint": {
    "alert_window_start": number | null,
    "alert_window_end": number | null,
    "preferred_score_state": "any" | "draw" | "home_leading" | "away_leading" | "not_home_leading" | "not_away_leading",
    "preferred_goal_state": "any" | "goals_lte_0" | "goals_lte_1" | "goals_lte_2" | "goals_gte_1" | "goals_gte_2" | "goals_gte_3",
    "favoured_side": "home" | "away" | "none",
    "alert_rationale_en": string,
    "alert_rationale_vi": string
  },
  "ai_condition": string,
  "ai_condition_reason": string,
  "ai_condition_reason_vi": string
}`;
}

function shouldSpecializeCondition(
  context: StrategicContext,
  options: StrategicContextFetchOptions,
): boolean {
  if (!options.highPriority) return false;
  const trusted = Number(context.source_meta?.trusted_source_count ?? 0);
  const quality = cleanText(context.source_meta?.search_quality).toLowerCase();
  if (trusted < 3) return false;
  if (quality !== 'medium' && quality !== 'high') return false;
  const machine = cleanText(context.ai_condition || buildMachineConditionFromBlueprint(context.ai_condition_blueprint));
  return isMinuteOnlyCondition(machine);
}

async function specializeConditionForPriorityMatch(
  context: StrategicContext,
  draftText: string,
): Promise<StrategicContext | null> {
  for (const attempt of [1, 2] as const) {
    const data = await generateGeminiContent(
      buildConditionSpecializationPrompt(context, draftText, attempt),
      {
        model: config.geminiStrategicStructuredModel || config.geminiModel,
        withSearch: false,
        timeoutMs: STRUCTURE_REQUEST_TIMEOUT_MS,
        maxOutputTokens: config.geminiStrategicStructuredMaxOutputTokens,
        responseMimeType: 'application/json',
        thinkingBudget: config.geminiStrategicStructuredThinkingBudget,
      },
    );
    if (!data) continue;
    const text = extractCandidateText(data);
    if (!text) continue;
    const json = extractJsonString(text);
    if (!json) continue;
    try {
      const parsed = JSON.parse(json) as Record<string, unknown>;
      const refinedBlueprint = refineConditionBlueprint(
        normalizeConditionBlueprint(parsed.condition_blueprint),
        context.quantitative,
        context.source_meta,
        context.qualitative.en,
      );
      const machine = buildMachineConditionFromBlueprint(refinedBlueprint) || cleanText(parsed.ai_condition);
      if (!machine || !machine.startsWith('(') || isMinuteOnlyCondition(machine)) continue;
      return {
        ...context,
        ai_condition_blueprint: refinedBlueprint,
        ai_condition: machine,
        ai_condition_reason: sanitizeAiConditionReason(parsed.ai_condition_reason || parsed.ai_condition_reason_vi || refinedBlueprint?.alert_rationale_en || context.ai_condition_reason),
        ai_condition_reason_vi: sanitizeAiConditionReason(parsed.ai_condition_reason_vi || refinedBlueprint?.alert_rationale_vi || context.ai_condition_reason_vi),
      };
    } catch {
      continue;
    }
  }
  return null;
}

async function generateGeminiContent(
  prompt: string,
  options: {
    model?: string;
    withSearch: boolean;
    timeoutMs: number;
    maxOutputTokens: number;
    responseMimeType?: string;
    thinkingBudget?: number | null;
  },
): Promise<Record<string, unknown> | null> {
  return requestGeminiContent(prompt, {
    model: options.model || config.geminiModel,
    withSearch: options.withSearch,
    timeoutMs: options.timeoutMs,
    maxOutputTokens: options.maxOutputTokens,
    responseMimeType: options.responseMimeType,
    thinkingBudget: options.thinkingBudget,
    temperature: options.withSearch ? 0.2 : 0.1,
  });
}

function reapplyConditionRefinementAfterQuantitativeChange(ctx: StrategicContext): StrategicContext {
  const baseBp = ctx.ai_condition_blueprint;
  if (!baseBp) return ctx;
  const refined = refineConditionBlueprint(
    baseBp,
    ctx.quantitative,
    ctx.source_meta,
    ctx.qualitative.en,
  );
  if (!refined) return ctx;
  const machine = buildMachineConditionFromBlueprint(refined) || cleanText(ctx.ai_condition);
  return {
    ...ctx,
    ai_condition_blueprint: refined,
    ai_condition: machine.startsWith('(') ? machine : ctx.ai_condition,
    ai_condition_reason: sanitizeAiConditionReason(ctx.ai_condition_reason || refined.alert_rationale_en),
    ai_condition_reason_vi: sanitizeAiConditionReason(ctx.ai_condition_reason_vi || refined.alert_rationale_vi),
  };
}

async function enrichQuantitativeFromGroundedNotes(
  draftText: string,
  existing: StrategicContextQuantitative,
): Promise<StrategicContextQuantitative> {
  if (process.env['NODE_ENV'] === 'test') return existing;
  const prompt = `You extract ONLY explicit numeric football statistics already stated in GROUNDED NOTES.

RULES:
- Return STRICT JSON only. One object. No commentary.
- Use null when the notes do not explicitly give that exact metric as a number.
- Do NOT guess, infer from vague wording, or fabricate values.
- If notes say "No data found" for a metric, use null.
- For rate fields (*_rate_* and failed_to_score), output a decimal between 0 and 1 (e.g. 45% or 45 -> 0.45).

Keys (all required in JSON):
home_last5_points, away_last5_points, home_last5_goals_for, away_last5_goals_for, home_last5_goals_against, away_last5_goals_against,
home_home_goals_avg, away_away_goals_avg,
home_over_2_5_rate_last10, away_over_2_5_rate_last10, home_btts_rate_last10, away_btts_rate_last10,
home_clean_sheet_rate_last10, away_clean_sheet_rate_last10, home_failed_to_score_rate_last10, away_failed_to_score_rate_last10

GROUNDED NOTES:
${draftText.slice(0, 14000)}`;

  try {
    const data = await generateGeminiContent(prompt, {
      model: config.geminiStrategicStructuredModel || config.geminiModel,
      withSearch: false,
      timeoutMs: QUANT_EXTRACTION_TIMEOUT_MS,
      maxOutputTokens: Math.min(4096, config.geminiStrategicStructuredMaxOutputTokens),
      responseMimeType: 'application/json',
      thinkingBudget: config.geminiStrategicStructuredThinkingBudget,
    });
    if (!data) return existing;
    const text = extractCandidateText(data);
    if (!text) return existing;
    const json = extractJsonString(text);
    if (!json) return existing;
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const extracted = normalizeQuantitative(parsed);
    return mergeQuantitativePreferExisting(existing, extracted);
  } catch {
    return existing;
  }
}

async function tryQuantitativeBackfillFromNotes(
  ctx: StrategicContext,
  draftText: string,
  options: StrategicContextFetchOptions,
): Promise<StrategicContext> {
  if (process.env['NODE_ENV'] === 'test') return ctx;
  if (!options.highPriority) return ctx;
  const quality = cleanText(ctx.source_meta?.search_quality).toLowerCase();
  if (quality !== 'medium' && quality !== 'high') return ctx;
  if (Number(ctx.source_meta?.trusted_source_count ?? 0) < 2) return ctx;
  if (countStrategicQuantitativeCoverage(ctx.quantitative) >= 4) return ctx;

  const merged = await enrichQuantitativeFromGroundedNotes(draftText, ctx.quantitative);
  return reapplyConditionRefinementAfterQuantitativeChange({ ...ctx, quantitative: merged });
}

async function fetchGroundedResearchDraft(
  homeTeam: string,
  awayTeam: string,
  league: string,
  dateStr: string,
  options: StrategicContextFetchOptions = {},
): Promise<{ draftText: string; sourceMeta: StrategicContextSourceMeta; fallback: DraftFallbackPayload } | null> {
  const prompt = buildGroundedResearchDraftPrompt(homeTeam, awayTeam, league, dateStr, options);
  const data = await generateGeminiContent(prompt, {
    model: config.geminiStrategicGroundedModel || config.geminiModel,
    withSearch: true,
    timeoutMs: REQUEST_TIMEOUT_MS,
    maxOutputTokens: config.geminiStrategicGroundedMaxOutputTokens,
    responseMimeType: 'text/plain',
    thinkingBudget: config.geminiStrategicGroundedThinkingBudget,
  });
  if (!data) return null;

  let draftText = extractCandidateText(data);
  if (!draftText) return null;

  let fallback = extractDraftFallbackPayload(draftText);
  let sourceMeta = mergeSourceMeta(buildSourceMeta(extractGroundingMetadata(data)), fallback);
  let quantitativeCoverage = countDraftQuantitativeCoverage(fallback.quantitative);
  let sparseQuantitativeDespiteTrustedSources = sourceMeta.trusted_source_count >= 2
    && (sourceMeta.search_quality === 'medium' || sourceMeta.search_quality === 'high')
    && quantitativeCoverage < 4;

  const allowDraftRescue = process.env['NODE_ENV'] !== 'test' && options.highPriority === true;
  if (sparseQuantitativeDespiteTrustedSources && allowDraftRescue) {
    try {
      const rescueData = await generateGeminiContent(
        buildGroundedResearchDraftPrompt(homeTeam, awayTeam, league, dateStr, { ...options, rescueMode: true }),
        {
          model: config.geminiStrategicGroundedModel || config.geminiModel,
          withSearch: true,
          timeoutMs: REQUEST_TIMEOUT_MS,
          maxOutputTokens: config.geminiStrategicGroundedMaxOutputTokens,
          responseMimeType: 'text/plain',
          thinkingBudget: config.geminiStrategicGroundedThinkingBudget,
        },
      );
      if (rescueData) {
        const rescueDraftText = extractCandidateText(rescueData);
        if (rescueDraftText) {
          const rescueFallback = extractDraftFallbackPayload(rescueDraftText);
          const rescueSourceMeta = mergeSourceMeta(buildSourceMeta(extractGroundingMetadata(rescueData)), rescueFallback);
          const rescueCoverage = countDraftQuantitativeCoverage(rescueFallback.quantitative);
          const shouldAdoptRescue = rescueCoverage > quantitativeCoverage
            || (
              rescueCoverage === quantitativeCoverage
              && rescueSourceMeta.trusted_source_count > sourceMeta.trusted_source_count
            );
          if (shouldAdoptRescue) {
            draftText = rescueDraftText;
            fallback = rescueFallback;
            sourceMeta = rescueSourceMeta;
            quantitativeCoverage = rescueCoverage;
            sparseQuantitativeDespiteTrustedSources = sourceMeta.trusted_source_count >= 2
              && (sourceMeta.search_quality === 'medium' || sourceMeta.search_quality === 'high')
              && quantitativeCoverage < 4;
          }
        }
      }
    } catch {
      // best-effort rescue; keep original draft on rescue failure
    }
  }

  if (sparseQuantitativeDespiteTrustedSources && allowDraftRescue) {
    try {
      const quantPassData = await generateGeminiContent(
        buildGroundedResearchDraftPrompt(homeTeam, awayTeam, league, dateStr, { ...options, quantitativeGroundingPass: true }),
        {
          model: config.geminiStrategicGroundedModel || config.geminiModel,
          withSearch: true,
          timeoutMs: REQUEST_TIMEOUT_MS,
          maxOutputTokens: config.geminiStrategicGroundedMaxOutputTokens,
          responseMimeType: 'text/plain',
          thinkingBudget: config.geminiStrategicGroundedThinkingBudget,
        },
      );
      if (quantPassData) {
        const quantDraftText = extractCandidateText(quantPassData);
        if (quantDraftText) {
          const quantFallback = extractDraftFallbackPayload(quantDraftText);
          const quantSourceMeta = mergeSourceMeta(buildSourceMeta(extractGroundingMetadata(quantPassData)), quantFallback);
          const quantCoverage = countDraftQuantitativeCoverage(quantFallback.quantitative);
          const shouldAdoptQuantPass = quantCoverage > quantitativeCoverage
            || (
              quantCoverage === quantitativeCoverage
              && quantSourceMeta.trusted_source_count > sourceMeta.trusted_source_count
            );
          if (shouldAdoptQuantPass) {
            draftText = quantDraftText;
            fallback = quantFallback;
            sourceMeta = quantSourceMeta;
            quantitativeCoverage = quantCoverage;
            sparseQuantitativeDespiteTrustedSources = sourceMeta.trusted_source_count >= 2
              && (sourceMeta.search_quality === 'medium' || sourceMeta.search_quality === 'high')
              && quantitativeCoverage < 4;
          }
        }
      }
    } catch {
      // best-effort quantitative grounding pass
    }
  }

  if (sparseQuantitativeDespiteTrustedSources) {
    console.warn(
      `[strategic-context] Sparse quantitative draft for ${homeTeam} vs ${awayTeam}: `
      + `coverage=${quantitativeCoverage}, trusted=${sourceMeta.trusted_source_count}, quality=${sourceMeta.search_quality}`,
    );
  }

  await writeStrategicDebugArtifact(
    {
      stage: 'grounded-draft',
      match: { homeTeam, awayTeam, league, dateStr },
      sourceMeta,
      quantitativeCoverage,
      sparseQuantitativeDespiteTrustedSources,
      fallbackQuantitative: fallback.quantitative,
      draftTextPreview: draftText.slice(0, 4000),
    },
    homeTeam,
    awayTeam,
  );
  return { draftText, sourceMeta, fallback };
}

async function buildStructuredStrategicContext(
  draftText: string,
  searchedAt: string,
  sourceMeta: StrategicContextSourceMeta,
  fallback: DraftFallbackPayload,
): Promise<StrategicContext | null> {
  const draftOnlyContext = mergeStrategicContextWithDraftFallback(
    buildNoDataStrategicContext(searchedAt),
    fallback,
    sourceMeta,
  );
  const data = await generateGeminiContent(
    buildStructuredStrategicContextPrompt(draftText, sourceMeta),
    {
      model: config.geminiStrategicStructuredModel || config.geminiModel,
      withSearch: false,
      timeoutMs: STRUCTURE_REQUEST_TIMEOUT_MS,
      maxOutputTokens: config.geminiStrategicStructuredMaxOutputTokens,
      responseMimeType: 'application/json',
      thinkingBudget: config.geminiStrategicStructuredThinkingBudget,
    },
  );
  if (!data) return draftOnlyContext;

  const text = extractCandidateText(data);
  if (!text) return draftOnlyContext;
  await writeStrategicDebugArtifact(
    {
      stage: 'structured-raw',
      sourceMeta,
      draftPreview: draftText.slice(0, 2500),
      structuredTextPreview: text.slice(0, 3500),
    },
    'structured',
    'context',
  );

  try {
    const parsed = parseStrategicResponse(text, searchedAt, sourceMeta);
    return mergeStrategicContextWithDraftFallback(parsed, fallback, sourceMeta);
  } catch {
    const repaired = await generateGeminiContent(
      buildStrategicJsonRepairPrompt(text, draftText, sourceMeta),
      {
        model: config.geminiStrategicStructuredModel || config.geminiModel,
        withSearch: false,
        timeoutMs: STRUCTURE_REQUEST_TIMEOUT_MS,
        maxOutputTokens: config.geminiStrategicStructuredMaxOutputTokens,
        responseMimeType: 'application/json',
        thinkingBudget: config.geminiStrategicStructuredThinkingBudget,
      },
    );
    const repairedText = repaired ? extractCandidateText(repaired) : '';
    if (!repairedText) return draftOnlyContext;
    try {
      const repairedParsed = parseStrategicResponse(repairedText, searchedAt, sourceMeta);
      return mergeStrategicContextWithDraftFallback(repairedParsed, fallback, sourceMeta);
    } catch {
      return draftOnlyContext;
    }
  }
}

function buildGroundedResearchDraftPrompt(
  homeTeam: string,
  awayTeam: string,
  league: string,
  dateStr: string,
  options: StrategicContextFetchOptions = {},
): string {
  const leagueCountry = cleanText(options.leagueCountry);
  const highPriorityFocus = options.highPriority
    ? `
PRIORITY ENRICHMENT MODE:
- This match is in a Top/Favorite league bucket and needs higher-quality strategic output.
- Your output should maximize actionable live-betting context while staying fact-grounded.
- For trusted-source runs, avoid generic all-null quantitative blocks.
- If quantitative evidence exists in trusted references, surface it explicitly in numeric fields.
- HARD TARGET: when your search yields medium/high quality with multiple trustworthy domains, populate at least 8 of the 16 quantitative keys with numeric literals (not null). Prioritize last-5 points, last-5 goals for/against, home/away goals averages, Over2.5 and BTTS last-10 rates.
`
    : '';
  const favoriteLeagueFocus = options.favoriteLeague
    ? `
FAVORITE LEAGUE CONTEXT:
- This competition is explicitly selected by users as a favorite league.
- Prioritize practical, actionable context over generic narrative.
`
    : '';
  const topLeagueFocus = options.topLeague
    ? `
TOP-LEAGUE PRIORITY:
- This competition is flagged internally as a major top league. Sparse or empty context is unacceptable unless trustworthy sources genuinely have nothing current.
- You MUST actively try to populate: league_positions, key_absences, home_key_absences, away_key_absences, fixture_congestion or rotation_risk, home_fixture_congestion, away_fixture_congestion, and at least one concrete motivation signal for each team.
- Prefer official league/club sources plus major stats/news sources before settling on "No data found".
- If country context helps disambiguation, use it: ${leagueCountry || 'unknown country'}.
`
    : '';
  const rescueFocus = options.rescueMode
    ? `
RESCUE PASS:
- Earlier research was empty or too sparse.
- Re-run the search with country-aware, source-aware discipline.
- Explicitly try official league table/schedule pages, official club squad/news pages, and major stats/reference pages before concluding "No data found".
- For top leagues, it is especially important to recover at least:
  - league_positions
  - key_absences
  - home_key_absences
  - away_key_absences
  - fixture_congestion or rotation_risk
  - home_fixture_congestion
  - away_fixture_congestion
  - a summary grounded in current season context
`
    : '';
  const quantitativeGroundingPassFocus = options.quantitativeGroundingPass
    ? `
QUANT-FOCUSED GROUNDING PASS (NUMERIC RECOVERY):
- Prior output still lacked recoverable numeric priors. Open season/match stat pages (FBref, SofaScore, FotMob, Flashscore, official league stats) for BOTH teams.
- You MUST fill HOME_LAST5_POINTS, AWAY_LAST5_POINTS, HOME_LAST5_GOALS_FOR, AWAY_LAST5_GOALS_FOR, HOME_LAST5_GOALS_AGAINST, AWAY_LAST5_GOALS_AGAINST when the page shows last-five form rows.
- Fill HOME_OVER_2_5_RATE_LAST10 / AWAY_OVER_2_5_RATE_LAST10 and BTTS rates when explicitly listed (numeric literals or null).
- Keep qualitative lines short; numeric accuracy is the priority of this pass.
`
    : '';
  const quantRecoveryFloor = (options.highPriority || options.topLeague)
    ? `
QUANTITATIVE FLOOR (STATS TABLES):
- When any trustworthy stats table exists for the current season, do not leave all 16 quantitative keys null unless the table truly lacks that data.
- Prefer filling last-five points and last-five goals for/against for BOTH teams first, then home/away goals averages, then Over2.5/BTTS last-10 if shown.
`
    : '';
  const wordLimit = options.highPriority ? 640 : options.topLeague ? 560 : 500;
  return `You are a football pre-match research analyst preparing grounded raw notes for a live betting decision engine.

Match:
- Home team: ${homeTeam}
- Away team: ${awayTeam}
- Competition label: ${league}
- Competition country: ${leagueCountry || 'unknown'}
- Match date: ${dateStr}

SEARCH DISCIPLINE:
- Use Google Search grounding.
- Prioritize trustworthy sources only:
  1. Official competition, federation, or club sources for schedule, injuries, suspensions, and competition context.
  2. Tier-1 sports/news outlets (Reuters, AP, BBC Sport, ESPN, Sky Sports, The Athletic, etc.) for current squad news, rotation, manager quotes, motivation signals.
  3. Reputable football stats/reference sites (FBref, Soccerway, Transfermarkt, SofaScore, Flashscore, FotMob, etc.) for table position, recent form, BTTS/O/U tendencies, and goal averages.
- Ignore or down-rank betting tip sites, rumor blogs, forums, and social media chatter.
- If information cannot be verified from trustworthy sources, use "No data found" for narrative fields and null for numeric fields.
- Do NOT invent exact numbers.
- Do NOT infer team strength solely from brand size, reputation, or club-name recognition.
- Return ENGLISH only in this step.
- Keep each value compact so all keys fit. For qualitative fields, target <= 16 words.
${highPriorityFocus}
${favoriteLeagueFocus}
${topLeagueFocus}
${rescueFocus}
${quantitativeGroundingPassFocus}
${quantRecoveryFloor}

TASKS:
1. Produce concise qualitative notes:
   - home_motivation
   - away_motivation
   - league_positions
   - fixture_congestion
  - home_fixture_congestion
  - away_fixture_congestion
   - rotation_risk
   - key_absences
  - home_key_absences
  - away_key_absences
   - h2h_narrative
   - summary
2. Produce quantitative pre-match priors useful for live betting:
   - home_last5_points
   - away_last5_points
   - home_last5_goals_for
   - away_last5_goals_for
   - home_last5_goals_against
   - away_last5_goals_against
   - home_home_goals_avg
   - away_away_goals_avg
   - home_over_2_5_rate_last10
   - away_over_2_5_rate_last10
   - home_btts_rate_last10
   - away_btts_rate_last10
   - home_clean_sheet_rate_last10
   - away_clean_sheet_rate_last10
   - home_failed_to_score_rate_last10
   - away_failed_to_score_rate_last10
3. Determine competition_type. Allowed values only:
   - "domestic_league"
   - "domestic_cup"
   - "european"
   - "international"
   - "friendly"
4. Generate ONE monitoring condition expression for live monitoring, only if strategically meaningful.

QUANTITATIVE EXTRACTION RULES (IMPORTANT):
- For quantitative keys, prioritize official competition pages and reputable stats/reference sources.
- If a trustworthy source provides a numeric clue, extract a numeric value instead of "No data found"/null.
- For rate fields, return numeric values only (decimal 0..1 or percentage-style number) without prose.
- For medium/high confidence research runs, avoid all-null quantitative output and populate every recoverable metric.
- Use null only when no trustworthy source provides that specific metric.

CONDITION GENERATION RULES:
- For european/international/friendly matches: the teams are from different domestic leagues, so do NOT compare their league positions directly.
- If competition_type is unknown or unclear, leave it as an empty string and disable league-position-gap reasoning.
- Do NOT output code. Describe only the intended trigger logic briefly in plain English if a trigger is meaningful.

OUTPUT:
- Return PLAIN TEXT only, no JSON and no markdown table.
- Keep total output under ${wordLimit} words.
- Every listed key must appear exactly once, even if the value is "No data found" or null.
- No duplicated keys.
- Do not include citation markers like "[cite: ...]" in values.
- The output must start with "COMPETITION_TYPE:" and end with "SOURCE_DOMAINS:".
- For numeric fields, output numeric literals or null only (no prose).
- Use exactly this key-value layout:
COMPETITION_TYPE:
HOME_MOTIVATION:
AWAY_MOTIVATION:
LEAGUE_POSITIONS:
FIXTURE_CONGESTION:
HOME_FIXTURE_CONGESTION:
AWAY_FIXTURE_CONGESTION:
ROTATION_RISK:
KEY_ABSENCES:
HOME_KEY_ABSENCES:
AWAY_KEY_ABSENCES:
H2H_NARRATIVE:
SUMMARY:
HOME_LAST5_POINTS:
AWAY_LAST5_POINTS:
HOME_LAST5_GOALS_FOR:
AWAY_LAST5_GOALS_FOR:
HOME_LAST5_GOALS_AGAINST:
AWAY_LAST5_GOALS_AGAINST:
HOME_HOME_GOALS_AVG:
AWAY_AWAY_GOALS_AVG:
HOME_OVER_2_5_RATE_LAST10:
AWAY_OVER_2_5_RATE_LAST10:
HOME_BTTS_RATE_LAST10:
AWAY_BTTS_RATE_LAST10:
HOME_CLEAN_SHEET_RATE_LAST10:
AWAY_CLEAN_SHEET_RATE_LAST10:
HOME_FAILED_TO_SCORE_RATE_LAST10:
AWAY_FAILED_TO_SCORE_RATE_LAST10:
ALERT_WINDOW_START:
ALERT_WINDOW_END:
PREFERRED_SCORE_STATE:
PREFERRED_GOAL_STATE:
FAVOURED_SIDE:
ALERT_RATIONALE:
SEARCH_QUERIES:
SOURCE_DOMAINS:
`;
}

function buildStructuredStrategicContextPrompt(
  draftText: string,
  sourceMeta: StrategicContextSourceMeta,
): string {
  const trustedDomains = sourceMeta.sources
    .filter((source) => source.trust_tier === 'tier_1' || source.trust_tier === 'tier_2')
    .map((source) => source.domain)
    .join(', ') || '(none)';

  return `You are converting grounded football research notes into STRICT JSON for a live betting system.

SOURCE_QUALITY: ${sourceMeta.search_quality}
TRUSTED_SOURCE_DOMAINS: ${trustedDomains}
TRUSTED_SOURCE_COUNT: ${sourceMeta.trusted_source_count}
REJECTED_SOURCE_COUNT: ${sourceMeta.rejected_source_count}

RULES:
- Use ONLY facts present in the grounded notes below.
- If a field is missing or uncertain, use "No data found" for narrative fields and null for numeric fields.
- Preserve numeric values from grounded notes whenever present; do NOT replace grounded numeric values with null.
- Keep English and Vietnamese fields aligned to the same facts.
- Keep each narrative field concise: usually <= 18 words. Keep summary <= 28 words.
- Do NOT add commentary outside JSON.
- Do NOT add extra keys.
- If SOURCE_QUALITY is low or trusted source count is 0, stay conservative about uncertain claims, but preserve any grounded facts that are explicitly present in the notes.
- competition_type must be one of: "domestic_league", "domestic_cup", "european", "international", "friendly", or "".
- condition_blueprint must use only allowed enums:
  - preferred_score_state: "any" | "draw" | "home_leading" | "away_leading" | "not_home_leading" | "not_away_leading"
  - preferred_goal_state: "any" | "goals_lte_0" | "goals_lte_1" | "goals_lte_2" | "goals_gte_1" | "goals_gte_2" | "goals_gte_3"
  - favoured_side: "home" | "away" | "none"
- QUALITY TARGET FOR LIVE BETTING:
  - If SOURCE_QUALITY is "medium" or "high" and TRUSTED_SOURCE_COUNT >= 2, do NOT leave both preferred_goal_state and preferred_score_state as "any".
  - Prefer goal-state specialization from grounded quantitative signals (over/under tendency, BTTS, clean-sheet, failed-to-score rates).
  - Use score-state specialization when side momentum is clear (recent points/goals trend).
- CONDITION OUTPUT MUST BE EVALUABLE FOR LIVE FILTERING:
  - alert_window_start must be an integer from 1..90 (NEVER null).
  - alert_window_end must be null or an integer from 2..95 and strictly greater than alert_window_start.
  - If both preferred_goal_state and preferred_score_state are "any", then alert_window_end is REQUIRED.
  - Do NOT return an empty or non-evaluable condition blueprint.
- ai_condition must be a machine-readable boolean expression derived from condition_blueprint only:
  - Allowed atoms:
    - (Minute >= N)
    - (Minute <= N)
    - (Total goals <= 0|1|2)
    - (Total goals >= 1|2|3)
    - (Draw)
    - (Home leading)
    - (Away leading)
    - (NOT Home leading)
    - (NOT Away leading)
  - Join atoms using uppercase " AND ".
  - Do NOT output natural language in ai_condition.
- If evidence is weak/uncertain, still output a conservative evaluable fallback:
  - condition_blueprint.alert_window_start = 60
  - condition_blueprint.alert_window_end = 85
  - preferred_goal_state = "any"
  - preferred_score_state = "any"
  - favoured_side = "none"
  - ai_condition = "(Minute >= 60) AND (Minute <= 85)"
  - reason fields should explain conservative fallback due limited evidence.

GROUNDED NOTES:
${draftText}

Return STRICT JSON only with this schema:
{
  "qualitative_en": {
    "home_motivation": string,
    "away_motivation": string,
    "league_positions": string,
    "fixture_congestion": string,
    "home_fixture_congestion": string,
    "away_fixture_congestion": string,
    "rotation_risk": string,
    "key_absences": string,
    "home_key_absences": string,
    "away_key_absences": string,
    "h2h_narrative": string,
    "summary": string
  },
  "qualitative_vi": {
    "home_motivation": string,
    "away_motivation": string,
    "league_positions": string,
    "fixture_congestion": string,
    "home_fixture_congestion": string,
    "away_fixture_congestion": string,
    "rotation_risk": string,
    "key_absences": string,
    "home_key_absences": string,
    "away_key_absences": string,
    "h2h_narrative": string,
    "summary": string
  },
  "quantitative": {
    "home_last5_points": number | null,
    "away_last5_points": number | null,
    "home_last5_goals_for": number | null,
    "away_last5_goals_for": number | null,
    "home_last5_goals_against": number | null,
    "away_last5_goals_against": number | null,
    "home_home_goals_avg": number | null,
    "away_away_goals_avg": number | null,
    "home_over_2_5_rate_last10": number | null,
    "away_over_2_5_rate_last10": number | null,
    "home_btts_rate_last10": number | null,
    "away_btts_rate_last10": number | null,
    "home_clean_sheet_rate_last10": number | null,
    "away_clean_sheet_rate_last10": number | null,
    "home_failed_to_score_rate_last10": number | null,
    "away_failed_to_score_rate_last10": number | null
  },
  "competition_type": "domestic_league" | "domestic_cup" | "european" | "international" | "friendly" | "",
  "condition_blueprint": {
    "alert_window_start": number | null,
    "alert_window_end": number | null,
    "preferred_score_state": "any" | "draw" | "home_leading" | "away_leading" | "not_home_leading" | "not_away_leading",
    "preferred_goal_state": "any" | "goals_lte_0" | "goals_lte_1" | "goals_lte_2" | "goals_gte_1" | "goals_gte_2" | "goals_gte_3",
    "favoured_side": "home" | "away" | "none",
    "alert_rationale_en": string,
    "alert_rationale_vi": string
  },
  "ai_condition": string,
  "ai_condition_reason": string,
  "ai_condition_reason_vi": string
}`;
}

function buildStrategicJsonRepairPrompt(
  malformedText: string,
  draftText: string,
  sourceMeta: StrategicContextSourceMeta,
): string {
  return `Repair the malformed strategic-context output into STRICT JSON only.

SOURCE_QUALITY: ${sourceMeta.search_quality}
TRUSTED_SOURCE_COUNT: ${sourceMeta.trusted_source_count}
REJECTED_SOURCE_COUNT: ${sourceMeta.rejected_source_count}

Use only facts from GROUNDED NOTES below.
If uncertain, use "No data found" for narrative fields and null for numeric fields.
Do not add extra keys or commentary.
Ensure condition_blueprint is evaluable:
- alert_window_start: integer 1..90 (never null)
- alert_window_end: null or integer > alert_window_start and <= 95
- if preferred_goal_state and preferred_score_state are both "any", alert_window_end must not be null
When SOURCE_QUALITY is medium/high and TRUSTED_SOURCE_COUNT >= 2, ensure at least one of preferred_goal_state or preferred_score_state is not "any".
Ensure ai_condition is machine-readable using only allowed atoms and uppercase " AND".
If uncertain, use conservative fallback:
- alert_window_start=60, alert_window_end=85, preferred_goal_state="any", preferred_score_state="any", favoured_side="none"
- ai_condition="(Minute >= 60) AND (Minute <= 85)"

GROUNDED NOTES:
${draftText}

MALFORMED OUTPUT TO REPAIR:
${malformedText}

Return the corrected JSON object only.`;
}

/**
 * Use Gemini with Google Search grounding to research match strategic context.
 * Returns null if the request fails; returns a structured "No data found" context
 * when search completed but trustworthy evidence was weak.
 */
export async function fetchStrategicContext(
  homeTeam: string,
  awayTeam: string,
  league: string,
  matchDate: string | null,
  options: StrategicContextFetchOptions = {},
): Promise<StrategicContext | null> {
  if (!config.geminiApiKey) {
    console.warn('[strategic-context] GEMINI_API_KEY not configured, skipping');
    return null;
  }

  const searchedAt = new Date().toISOString();
  const dateStr = matchDate || 'upcoming';

  try {
    let grounded: { draftText: string; sourceMeta: StrategicContextSourceMeta; fallback: DraftFallbackPayload } | null = null;
    let groundedError: unknown = null;
    const groundedAttempts = options.highPriority ? 3 : 1;
    for (let attempt = 0; attempt < groundedAttempts; attempt++) {
      try {
        grounded = await fetchGroundedResearchDraft(homeTeam, awayTeam, league, dateStr, options);
        if (grounded) break;
      } catch (err) {
        groundedError = err;
      }
    }
    if (!grounded) {
      if (groundedError instanceof Error && groundedError.name === 'AbortError') {
        console.error('[strategic-context] Grounded draft request timed out');
      } else if (groundedError) {
        console.error('[strategic-context] Grounded draft error:', groundedError instanceof Error ? groundedError.message : groundedError);
      } else {
        console.warn('[strategic-context] Empty grounded draft from Gemini');
      }
      return null;
    }

    let activeDraftText = grounded.draftText;

    let structured = await buildStructuredStrategicContext(
      grounded.draftText,
      searchedAt,
      grounded.sourceMeta,
      grounded.fallback,
    );
    if (!structured) {
      console.error('[strategic-context] Structured JSON synthesis failed');
      return null;
    }

    if ((options.topLeague || options.highPriority) && !hasUsableStrategicContext(structured, { topLeague: options.topLeague })) {
      try {
        const rescueGrounded = await fetchGroundedResearchDraft(
          homeTeam,
          awayTeam,
          league,
          dateStr,
          {
            ...options,
            rescueMode: true,
          },
        );
        if (rescueGrounded) {
          const rescueStructured = await buildStructuredStrategicContext(
            rescueGrounded.draftText,
            searchedAt,
            rescueGrounded.sourceMeta,
            rescueGrounded.fallback,
          );
          if (
            scoreStrategicContextCandidate(rescueStructured, { topLeague: options.topLeague }) >
            scoreStrategicContextCandidate(structured, { topLeague: options.topLeague })
          ) {
            structured = rescueStructured ?? structured;
            activeDraftText = rescueGrounded.draftText;
          }
        }
      } catch (err) {
        console.warn('[strategic-context] Priority rescue pass failed:', err instanceof Error ? err.message : String(err));
      }
    }

    structured = await tryQuantitativeBackfillFromNotes(structured, activeDraftText, options);

    if (shouldSpecializeCondition(structured, options)) {
      try {
        const specialized = await specializeConditionForPriorityMatch(structured, activeDraftText);
        if (specialized) {
          structured = specialized;
        }
      } catch (err) {
        console.warn('[strategic-context] Condition specialization pass failed:', err instanceof Error ? err.message : String(err));
      }
    }

    return structured;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.error('[strategic-context] Request timed out');
    } else {
      console.error('[strategic-context] Error:', err instanceof Error ? err.message : err);
    }
    return null;
  }
}
