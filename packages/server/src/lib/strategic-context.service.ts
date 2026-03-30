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
import {
  classifyStrategicSourceDomain,
  type StrategicSearchQuality,
  type StrategicSourceTrustTier,
  type StrategicSourceType,
} from '../config/strategic-source-policy.js';

const REQUEST_TIMEOUT_MS = 90_000;
const STRUCTURE_REQUEST_TIMEOUT_MS = 45_000;

const NO_DATA = 'No data found';
const NO_DATA_VI = 'Khong tim thay du lieu';

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

function cleanText(value: unknown, fallback = ''): string {
  const text = typeof value === 'string' ? value : value == null ? '' : String(value);
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized || fallback;
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

function parseReportedCsvLine(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
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
  if (predictionFallbackUsed && qualitativeCoverage >= 5 && quantitativeCoverage >= 2) {
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

  if (options.topLeague) {
    return hasTopLeagueCoverage(ctx);
  }

  if (quality === 'unknown') return false;
  if (quality === 'low') {
    return trustedSourceCount >= 1 && qualitativeCoverage >= 5 && !!summary && !isNoDataText(summary);
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
  const blueprint = normalizeConditionBlueprint(raw.condition_blueprint ?? raw.ai_condition_blueprint);
  const aiCondition = buildMachineConditionFromBlueprint(blueprint) || cleanText(raw.ai_condition);
  const aiConditionReason = cleanText(raw.ai_condition_reason || blueprint?.alert_rationale_en);
  const aiConditionReasonVi = cleanText(raw.ai_condition_reason_vi || blueprint?.alert_rationale_vi);

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
  if (sourceMeta.search_quality === 'low') {
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

  const blueprint = context.ai_condition_blueprint || draftFallback.blueprint;
  const mergedSourceMeta = mergeSourceMeta(sourceMeta, draftFallback);

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

  const draftText = extractCandidateText(data);
  if (!draftText) return null;

  const fallback = extractDraftFallbackPayload(draftText);
  const sourceMeta = mergeSourceMeta(buildSourceMeta(extractGroundingMetadata(data)), fallback);
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
${topLeagueFocus}
${rescueFocus}

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

CONDITION GENERATION RULES:
- For european/international/friendly matches: the teams are from different domestic leagues, so do NOT compare their league positions directly.
- If competition_type is unknown or unclear, leave it as an empty string and disable league-position-gap reasoning.
- Do NOT output code. Describe only the intended trigger logic briefly in plain English if a trigger is meaningful.

OUTPUT:
- Return PLAIN TEXT only, no JSON and no markdown table.
- Keep total output under 300 words.
- Every listed key must appear exactly once, even if the value is "No data found" or null.
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
- Keep English and Vietnamese fields aligned to the same facts.
- Keep each narrative field concise: usually <= 18 words. Keep summary <= 28 words.
- Do NOT add commentary outside JSON.
- Do NOT add extra keys.
- If SOURCE_QUALITY is low or trusted source count is 0, prefer conservative no-data fields.
- competition_type must be one of: "domestic_league", "domestic_cup", "european", "international", "friendly", or "".
- condition_blueprint must use only allowed enums:
  - preferred_score_state: "any" | "draw" | "home_leading" | "away_leading" | "not_home_leading" | "not_away_leading"
  - preferred_goal_state: "any" | "goals_lte_0" | "goals_lte_1" | "goals_lte_2" | "goals_gte_1" | "goals_gte_2" | "goals_gte_3"
  - favoured_side: "home" | "away" | "none"

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
    for (let attempt = 0; attempt < 2; attempt++) {
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

    if (options.topLeague && !hasUsableStrategicContext(structured, { topLeague: true })) {
      try {
        const rescueGrounded = await fetchGroundedResearchDraft(
          homeTeam,
          awayTeam,
          league,
          dateStr,
          {
            ...options,
            topLeague: true,
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
          if (scoreStrategicContextCandidate(rescueStructured, { topLeague: true }) > scoreStrategicContextCandidate(structured, { topLeague: true })) {
            structured = rescueStructured ?? structured;
          }
        }
      } catch (err) {
        console.warn('[strategic-context] Top-league rescue pass failed:', err instanceof Error ? err.message : String(err));
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
