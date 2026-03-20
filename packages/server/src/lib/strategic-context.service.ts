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

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const REQUEST_TIMEOUT_MS = 60_000;

const NO_DATA = 'No data found';
const NO_DATA_VI = 'Khong tim thay du lieu';

export type StrategicCompetitionType =
  | 'domestic_league'
  | 'domestic_cup'
  | 'european'
  | 'international'
  | 'friendly'
  | '';

export type StrategicSearchQuality = 'high' | 'medium' | 'low' | 'unknown';
export type StrategicSourceTrustTier = 'tier_1' | 'tier_2' | 'tier_3' | 'rejected';
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
export type StrategicSourceType =
  | 'official'
  | 'major_news'
  | 'stats_reference'
  | 'aggregator'
  | 'unknown'
  | 'rejected';

export interface StrategicContextNarrative {
  home_motivation: string;
  away_motivation: string;
  league_positions: string;
  fixture_congestion: string;
  rotation_risk: string;
  key_absences: string;
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
  rotation_risk_vi: string;
  key_absences_vi: string;
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

const EMPTY_NARRATIVE: StrategicContextNarrative = {
  home_motivation: '',
  away_motivation: '',
  league_positions: '',
  fixture_congestion: '',
  rotation_risk: '',
  key_absences: '',
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

const OFFICIAL_DOMAINS = [
  'fifa.com',
  'uefa.com',
  'the-afc.com',
  'cafonline.com',
  'concacaf.com',
  'ofcfootball.com',
  'premierleague.com',
  'laliga.com',
  'seriea.it',
  'bundesliga.com',
  'ligue1.com',
  'efl.com',
  'mlssoccer.com',
];

const MAJOR_NEWS_DOMAINS = [
  'reuters.com',
  'apnews.com',
  'bbc.com',
  'bbc.co.uk',
  'espn.com',
  'skysports.com',
  'theathletic.com',
  'nbcsports.com',
  'foxsports.com',
  'goal.com',
];

const STATS_REFERENCE_DOMAINS = [
  'fbref.com',
  'soccerway.com',
  'transfermarkt.com',
  'transfermarkt.co.uk',
  'sofascore.com',
  'flashscore.com',
  'fotmob.com',
  'whoscored.com',
  'worldfootball.net',
];

const REJECTED_DOMAIN_PATTERNS = [
  'reddit.com',
  'x.com',
  'twitter.com',
  'facebook.com',
  'instagram.com',
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'telegram.me',
  'blogspot.',
  'wordpress.',
  'medium.com',
  'substack.com',
  'tipster',
  'betting',
  'oddschecker',
  'freesupertips',
  'forum',
];

interface StrategicGroundingMetadata {
  queries: string[];
  sources: StrategicContextSource[];
}

function cleanText(value: unknown, fallback = ''): string {
  const text = typeof value === 'string' ? value : value == null ? '' : String(value);
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized || fallback;
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
    rotation_risk: cleanNarrativeField(obj.rotation_risk),
    key_absences: cleanNarrativeField(obj.key_absences),
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

function matchesDomain(domain: string, candidate: string): boolean {
  return domain === candidate || domain.endsWith(`.${candidate}`);
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function detectLanguage(domain: string, url: string): 'en' | 'vi' | 'unknown' {
  if (domain.endsWith('.vn') || /(?:^|[/?&])lang=vi(?:$|[&#])/i.test(url) || /\/vi(?:\/|$)/i.test(url)) {
    return 'vi';
  }
  if (domain) return 'en';
  return 'unknown';
}

function classifySource(domain: string): { trustTier: StrategicSourceTrustTier; sourceType: StrategicSourceType } {
  if (!domain) return { trustTier: 'rejected', sourceType: 'rejected' };

  if (REJECTED_DOMAIN_PATTERNS.some((pattern) => domain.includes(pattern))) {
    return { trustTier: 'rejected', sourceType: 'rejected' };
  }
  if (OFFICIAL_DOMAINS.some((candidate) => matchesDomain(domain, candidate))) {
    return { trustTier: 'tier_1', sourceType: 'official' };
  }
  if (MAJOR_NEWS_DOMAINS.some((candidate) => matchesDomain(domain, candidate))) {
    return { trustTier: 'tier_1', sourceType: 'major_news' };
  }
  if (STATS_REFERENCE_DOMAINS.some((candidate) => matchesDomain(domain, candidate))) {
    return { trustTier: 'tier_2', sourceType: 'stats_reference' };
  }
  if (domain.includes('score') || domain.includes('sport') || domain.includes('news')) {
    return { trustTier: 'tier_3', sourceType: 'aggregator' };
  }
  return { trustTier: 'tier_3', sourceType: 'unknown' };
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
  return cleanText(parts[0]?.text);
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
      const domain = extractDomain(url);
      const classification = classifySource(domain);
      sources.push({
        title: cleanText(web?.title, domain || 'Unknown source'),
        url,
        domain,
        publisher: domain || 'unknown',
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

export function buildNoDataStrategicContext(searchedAt = new Date().toISOString()): StrategicContext {
  return {
    ...EMPTY_NARRATIVE,
    home_motivation_vi: '',
    away_motivation_vi: '',
    league_positions_vi: '',
    fixture_congestion_vi: '',
    rotation_risk_vi: '',
    key_absences_vi: '',
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
        rotation_risk: '',
        key_absences: '',
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

export function hasUsableStrategicContext(ctx: Partial<StrategicContext> | null | undefined): boolean {
  if (!ctx || typeof ctx !== 'object') return false;
  const summary = cleanText(ctx.summary);
  const quality = cleanText(ctx.source_meta?.search_quality).toLowerCase();
  const quantitativeCoverage = countStrategicQuantitativeCoverage(ctx.quantitative);

  if (quality === 'low') return false;
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
    rotation_risk_vi: qualitativeVi.rotation_risk || qualitativeEn.rotation_risk,
    key_absences_vi: qualitativeVi.key_absences || qualitativeEn.key_absences,
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

  if (sourceMeta.search_quality === 'low') {
    const poor = buildNoDataStrategicContext(searchedAt);
    return {
      ...poor,
      competition_type: context.competition_type,
      source_meta: sourceMeta,
    };
  }

  return context;
}

function parseStrategicResponse(text: string, searchedAt: string, sourceMeta: StrategicContextSourceMeta): StrategicContext {
  const json = extractJsonString(text);
  if (!json) {
    throw new Error('Strategic context response did not contain a JSON object');
  }
  const parsed = JSON.parse(json) as unknown;
  return normalizeContextPayload(parsed, searchedAt, sourceMeta);
}

function buildResearchPrompt(homeTeam: string, awayTeam: string, league: string, dateStr: string): string {
  return `You are a football pre-match research analyst preparing structured inputs for a live betting decision engine.

Match:
- Home team: ${homeTeam}
- Away team: ${awayTeam}
- Competition label: ${league}
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

TASKS:
1. Produce concise bilingual qualitative notes:
   - home_motivation
   - away_motivation
   - league_positions
   - fixture_congestion
   - rotation_risk
   - key_absences
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
- Do NOT output a free-form code expression directly.
- Instead, fill condition_blueprint using only these enums:
  - preferred_score_state: "any" | "draw" | "home_leading" | "away_leading" | "not_home_leading" | "not_away_leading"
  - preferred_goal_state: "any" | "goals_lte_0" | "goals_lte_1" | "goals_lte_2" | "goals_gte_1" | "goals_gte_2" | "goals_gte_3"
  - favoured_side: "home" | "away" | "none"
- alert_window_start should usually be between 45 and 75 for meaningful live alerts.
- alert_window_end is optional; use null when no upper bound is needed.
- If there is not enough trustworthy evidence for a good condition, use:
  - alert_window_start = null
  - alert_window_end = null
  - preferred_score_state = "any"
  - preferred_goal_state = "any"
  - favoured_side = "none"
  - empty rationale strings

OUTPUT:
- Return STRICT JSON only.
- No markdown, no code fences, no commentary outside JSON.
- Narrative fields must be strings.
- Numeric fields must be numbers or null.
- Keep the English and Vietnamese narrative aligned to the same facts.
- The server will derive ai_condition from condition_blueprint. Prefer filling condition_blueprint accurately over inventing ai_condition text.

JSON SCHEMA:
{
  "qualitative_en": {
    "home_motivation": string,
    "away_motivation": string,
    "league_positions": string,
    "fixture_congestion": string,
    "rotation_risk": string,
    "key_absences": string,
    "h2h_narrative": string,
    "summary": string
  },
  "qualitative_vi": {
    "home_motivation": string,
    "away_motivation": string,
    "league_positions": string,
    "fixture_congestion": string,
    "rotation_risk": string,
    "key_absences": string,
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
  "competition_type": "domestic_league" | "domestic_cup" | "european" | "international" | "friendly",
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
): Promise<StrategicContext | null> {
  if (!config.geminiApiKey) {
    console.warn('[strategic-context] GEMINI_API_KEY not configured, skipping');
    return null;
  }

  const searchedAt = new Date().toISOString();
  const dateStr = matchDate || 'upcoming';
  const prompt = buildResearchPrompt(homeTeam, awayTeam, league, dateStr);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch(`${GEMINI_BASE}/${config.geminiModel}:generateContent?key=${config.geminiApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error(`[strategic-context] Gemini API error ${response.status}: ${errText.substring(0, 300)}`);
      return null;
    }

    const data = await response.json() as Record<string, unknown>;
    const text = extractCandidateText(data);

    if (!text) {
      console.warn('[strategic-context] Empty response from Gemini');
      return null;
    }

    const sourceMeta = buildSourceMeta(extractGroundingMetadata(data));
    return parseStrategicResponse(text, searchedAt, sourceMeta);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.error('[strategic-context] Request timed out');
    } else {
      console.error('[strategic-context] Error:', err instanceof Error ? err.message : err);
    }
    return null;
  }
}
