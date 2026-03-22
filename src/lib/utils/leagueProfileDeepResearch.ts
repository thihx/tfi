import type { League, LeagueProfile } from '@/types';

export type LeagueProfileDraft = Omit<LeagueProfile, 'league_id' | 'created_at' | 'updated_at'>;

export type ImportFieldStatus = 'set' | 'default';
export type ImportFieldResult = { label: string; value: string; status: ImportFieldStatus };
export type ParseImportResult = { draft: LeagueProfileDraft; repaired: boolean; summary: ImportFieldResult[] };

const TIER5_VALUES = new Set<LeagueProfileDraft['tempo_tier']>(['very_low', 'low', 'balanced', 'high', 'very_high']);
const TIER3_VALUES = new Set<LeagueProfileDraft['volatility_tier']>(['low', 'medium', 'high']);
const HOME_ADV_VALUES = new Set<LeagueProfileDraft['home_advantage_tier']>(['low', 'normal', 'high']);

export const DEFAULT_LEAGUE_PROFILE_DRAFT: LeagueProfileDraft = {
  tempo_tier: 'balanced',
  goal_tendency: 'balanced',
  home_advantage_tier: 'normal',
  corners_tendency: 'balanced',
  cards_tendency: 'balanced',
  volatility_tier: 'medium',
  data_reliability_tier: 'medium',
  avg_goals: null,
  over_2_5_rate: null,
  btts_rate: null,
  late_goal_rate_75_plus: null,
  avg_corners: null,
  avg_cards: null,
  notes_en: '',
  notes_vi: '',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readNullableNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function readTier5(value: unknown, fallback: LeagueProfileDraft['tempo_tier']): LeagueProfileDraft['tempo_tier'] {
  return TIER5_VALUES.has(value as LeagueProfileDraft['tempo_tier'])
    ? value as LeagueProfileDraft['tempo_tier']
    : fallback;
}

function readTier3(value: unknown, fallback: LeagueProfileDraft['volatility_tier']): LeagueProfileDraft['volatility_tier'] {
  return TIER3_VALUES.has(value as LeagueProfileDraft['volatility_tier'])
    ? value as LeagueProfileDraft['volatility_tier']
    : fallback;
}

function readHomeAdvantage(value: unknown, fallback: LeagueProfileDraft['home_advantage_tier']): LeagueProfileDraft['home_advantage_tier'] {
  return HOME_ADV_VALUES.has(value as LeagueProfileDraft['home_advantage_tier'])
    ? value as LeagueProfileDraft['home_advantage_tier']
    : fallback;
}

function normalizeLeagueName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function extractImportRoot(parsed: unknown): Record<string, unknown> {
  if (!isRecord(parsed)) {
    throw new Error('Imported content must be a JSON object.');
  }

  if (isRecord(parsed.profile)) return parsed.profile;
  if (Array.isArray(parsed.profiles)) {
    if (parsed.profiles.length !== 1 || !isRecord(parsed.profiles[0])) {
      throw new Error('Expected exactly one profile in "profiles".');
    }
    return parsed.profiles[0];
  }

  return parsed;
}

export function buildLeagueProfileDeepResearchPrompt(league: Pick<League, 'league_id' | 'league_name' | 'country' | 'tier' | 'type' | 'top_league'>): string {
  return [
    '/Deepresearch',
    '',
    'Goal:',
    'Create exactly one betting-oriented league profile for the football competition below.',
    'Return exactly one JSON object, not an array, not markdown.',
    '',
    'League input from TFI:',
    `- league_id: ${league.league_id}`,
    `- league_name: ${league.league_name}`,
    `- country: ${league.country || 'Unknown'}`,
    `- tier: ${league.tier || 'Unknown'}`,
    `- type: ${league.type || 'Unknown'}`,
    `- tfi_top_league: ${league.top_league ? 'true' : 'false'}`,
    '',
    'Research rules:',
    '- Prioritize official league/federation websites, major football statistics/reference sites, and high-trust news sources.',
    '- Do not use betting tipster sites, forums, fan blogs, rumor pages, or unverifiable social posts.',
    '- Focus on structurally stable league tendencies that matter for live football betting calibration.',
    '- Do not produce betting picks.',
    '- If evidence is weak or conflicting, use null or balanced/default tiers instead of guessing.',
    '- Keep notes concise and operational.',
    '',
    'Quantitative guidance:',
    '- Provide quantitative fields only when they are supported reliably by sources.',
    '- If a quantitative field is not clearly supported, return null.',
    '',
    'Return STRICT JSON only with this exact shape:',
    '{',
    '  "league_id": number,',
    '  "league_name": "string",',
    '  "country": "string",',
    '  "sample_confidence": "low|medium|high",',
    '  "qualitative_profile": {',
    '    "tempo_tier": "very_low|low|balanced|high|very_high",',
    '    "goal_tendency": "very_low|low|balanced|high|very_high",',
    '    "home_advantage_tier": "low|normal|high",',
    '    "corners_tendency": "very_low|low|balanced|high|very_high",',
    '    "cards_tendency": "very_low|low|balanced|high|very_high",',
    '    "volatility_tier": "low|medium|high",',
    '    "data_reliability_tier": "low|medium|high"',
    '  },',
    '  "quantitative_verified": {',
    '    "avg_goals": number|null,',
    '    "over_2_5_rate": number|null,',
    '    "btts_rate": number|null,',
    '    "late_goal_rate_75_plus": number|null,',
    '    "avg_corners": number|null,',
    '    "avg_cards": number|null',
    '  },',
    '  "notes_en": "short operational summary",',
    '  "notes_vi": "ban tieng Viet ngan gon",',
    '  "sources": [',
    '    {',
    '      "title": "string",',
    '      "url": "string",',
    '      "trust": "official|major_stats|major_news|other"',
    '    }',
    '  ],',
    '  "field_evidence": {',
    '    "tempo_tier": ["url1", "url2"],',
    '    "goal_tendency": ["url1"],',
    '    "volatility_tier": ["url1", "url2"]',
    '  }',
    '}',
    '',
    'Important:',
    '- Do not wrap the JSON in markdown fences.',
    '- Do not return multiple profiles.',
    '- Do not invent unsupported numbers.',
  ].join('\n');
}

/** Attempt to fix common JSON issues produced by AI (missing values, trailing commas, markdown fences). */
export function repairJson(raw: string): string {
  let s = raw.trim();
  // Strip markdown code fences
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  // Fix "key":, → "key": null,
  s = s.replace(/"([^"]+)"\s*:\s*,/g, '"$1": null,');
  // Fix "key": } or "key": ] (value missing before closing bracket)
  s = s.replace(/"([^"]+)"\s*:\s*([\}\]])/g, '"$1": null$2');
  // Remove trailing commas before } or ]
  s = s.replace(/,(\s*[\}\]])/g, '$1');
  return s;
}

export function summarizeDraft(draft: LeagueProfileDraft): ImportFieldResult[] {
  const def = DEFAULT_LEAGUE_PROFILE_DRAFT;
  const fmt = (v: number | null) => (v == null ? '—' : String(v));
  const st = (a: unknown, b: unknown): ImportFieldStatus => (a !== b ? 'set' : 'default');
  return [
    { label: 'Tempo',           value: draft.tempo_tier,              status: st(draft.tempo_tier, def.tempo_tier) },
    { label: 'Goal Tendency',   value: draft.goal_tendency,           status: st(draft.goal_tendency, def.goal_tendency) },
    { label: 'Home Advantage',  value: draft.home_advantage_tier,     status: st(draft.home_advantage_tier, def.home_advantage_tier) },
    { label: 'Corners',         value: draft.corners_tendency,        status: st(draft.corners_tendency, def.corners_tendency) },
    { label: 'Cards',           value: draft.cards_tendency,          status: st(draft.cards_tendency, def.cards_tendency) },
    { label: 'Volatility',      value: draft.volatility_tier,         status: st(draft.volatility_tier, def.volatility_tier) },
    { label: 'Data Reliability',value: draft.data_reliability_tier,   status: st(draft.data_reliability_tier, def.data_reliability_tier) },
    { label: 'Avg Goals',       value: fmt(draft.avg_goals),          status: st(draft.avg_goals, def.avg_goals) },
    { label: 'Over 2.5 Rate',   value: fmt(draft.over_2_5_rate),      status: st(draft.over_2_5_rate, def.over_2_5_rate) },
    { label: 'BTTS Rate',       value: fmt(draft.btts_rate),          status: st(draft.btts_rate, def.btts_rate) },
    { label: 'Late Goal 75+',   value: fmt(draft.late_goal_rate_75_plus), status: st(draft.late_goal_rate_75_plus, def.late_goal_rate_75_plus) },
    { label: 'Avg Corners',     value: fmt(draft.avg_corners),        status: st(draft.avg_corners, def.avg_corners) },
    { label: 'Avg Cards',       value: fmt(draft.avg_cards),          status: st(draft.avg_cards, def.avg_cards) },
    { label: 'Notes EN',        value: draft.notes_en ? '✓ present' : '—', status: st(draft.notes_en, def.notes_en) },
    { label: 'Notes VI',        value: draft.notes_vi ? '✓ present' : '—', status: st(draft.notes_vi, def.notes_vi) },
  ];
}

export function parseImportedLeagueProfile(raw: string, league: Pick<League, 'league_name' | 'country'>): ParseImportResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Import content is empty.');
  }

  const repaired = trimmed !== repairJson(trimmed);
  const toparse = repairJson(trimmed);

  let parsed: unknown;
  try {
    parsed = JSON.parse(toparse);
  } catch {
    throw new Error('Content is not valid JSON and could not be auto-repaired. Check for syntax errors.');
  }

  const root = extractImportRoot(parsed);
  const importedLeagueName = readText(root.league_name);
  const importedCountry = readText(root.country);

  if (importedLeagueName && normalizeLeagueName(importedLeagueName) !== normalizeLeagueName(league.league_name)) {
    throw new Error(`Imported profile is for "${importedLeagueName}", not "${league.league_name}".`);
  }
  if (importedCountry && league.country && normalizeLeagueName(importedCountry) !== normalizeLeagueName(league.country)) {
    throw new Error(`Imported country "${importedCountry}" does not match "${league.country}".`);
  }

  const qualitative = isRecord(root.qualitative_profile) ? root.qualitative_profile : root;
  const quantitative = isRecord(root.quantitative_verified)
    ? root.quantitative_verified
    : isRecord(root.quantitative)
      ? root.quantitative
      : root;

  const draft: LeagueProfileDraft = {
    tempo_tier: readTier5(qualitative.tempo_tier, DEFAULT_LEAGUE_PROFILE_DRAFT.tempo_tier),
    goal_tendency: readTier5(qualitative.goal_tendency, DEFAULT_LEAGUE_PROFILE_DRAFT.goal_tendency),
    home_advantage_tier: readHomeAdvantage(qualitative.home_advantage_tier, DEFAULT_LEAGUE_PROFILE_DRAFT.home_advantage_tier),
    corners_tendency: readTier5(qualitative.corners_tendency, DEFAULT_LEAGUE_PROFILE_DRAFT.corners_tendency),
    cards_tendency: readTier5(qualitative.cards_tendency, DEFAULT_LEAGUE_PROFILE_DRAFT.cards_tendency),
    volatility_tier: readTier3(qualitative.volatility_tier, DEFAULT_LEAGUE_PROFILE_DRAFT.volatility_tier),
    data_reliability_tier: readTier3(qualitative.data_reliability_tier, DEFAULT_LEAGUE_PROFILE_DRAFT.data_reliability_tier),
    avg_goals: readNullableNumber(quantitative.avg_goals),
    over_2_5_rate: readNullableNumber(quantitative.over_2_5_rate),
    btts_rate: readNullableNumber(quantitative.btts_rate),
    late_goal_rate_75_plus: readNullableNumber(quantitative.late_goal_rate_75_plus),
    avg_corners: readNullableNumber(quantitative.avg_corners),
    avg_cards: readNullableNumber(quantitative.avg_cards),
    notes_en: readText(root.notes_en),
    notes_vi: readText(root.notes_vi),
  };

  return { draft, repaired, summary: summarizeDraft(draft) };
}
