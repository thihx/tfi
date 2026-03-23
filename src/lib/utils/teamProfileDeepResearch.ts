import type { TeamProfile, TeamProfileData } from '@/types';

export type TeamProfileDraft = Omit<TeamProfile, 'team_id' | 'created_at' | 'updated_at'> & {
  profile: TeamProfileData;
};

export type ImportFieldStatus = 'set' | 'default';
export type ImportFieldResult = { label: string; value: string; status: ImportFieldStatus };
export type ParseImportResult = { draft: TeamProfileDraft; repaired: boolean; summary: ImportFieldResult[] };

// ── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_TEAM_PROFILE_DATA: TeamProfileData = {
  attack_style:          'mixed',
  defensive_line:        'medium',
  pressing_intensity:    'medium',
  set_piece_threat:      'medium',
  home_strength:         'normal',
  form_consistency:      'inconsistent',
  squad_depth:           'medium',
  avg_goals_scored:      null,
  avg_goals_conceded:    null,
  clean_sheet_rate:      null,
  btts_rate:             null,
  over_2_5_rate:         null,
  avg_corners_for:       null,
  avg_corners_against:   null,
  avg_cards:             null,
  first_goal_rate:       null,
  late_goal_rate:        null,
  data_reliability_tier: 'medium',
};

export const DEFAULT_TEAM_PROFILE_DRAFT: TeamProfileDraft = {
  profile:  { ...DEFAULT_TEAM_PROFILE_DATA },
  notes_en: '',
  notes_vi: '',
};

// ── Enum sets ─────────────────────────────────────────────────────────────────

const ATTACK_STYLES  = new Set(['counter', 'direct', 'possession', 'mixed']);
const TIER3          = new Set(['low', 'medium', 'high']);
const HOME_STRENGTH  = new Set(['weak', 'normal', 'strong']);
const FORM_CONSIST   = new Set(['volatile', 'inconsistent', 'consistent']);
const SQUAD_DEPTH    = new Set(['shallow', 'medium', 'deep']);

// ── Helpers ──────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function readText(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function readNullableNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function readEnum<T extends string>(v: unknown, allowed: Set<string>, fallback: T): T {
  return allowed.has(v as string) ? (v as T) : fallback;
}

function repairJson(raw: string): string {
  let s = raw.trim();
  // Strip markdown fences
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  // Find first { ... } block
  const start = s.indexOf('{');
  const end   = s.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) s = s.slice(start, end + 1);
  // Remove trailing commas before } or ]
  s = s.replace(/,\s*([}\]])/g, '$1');
  return s;
}

// ── Deep Research prompt ──────────────────────────────────────────────────────

export function buildTeamProfileDeepResearchPrompt(
  teamName: string,
  leagueName?: string,
): string {
  const context = leagueName ? ` (playing in ${leagueName})` : '';
  return `
You are a football data analyst and betting expert. Research the team "${teamName}"${context} and return a JSON profile following the exact schema below.

Use the most recent FULL season data available. If data is unavailable for a specific field, use null.

Return ONLY valid JSON — no markdown, no explanation, no extra text.

Required JSON schema:
{
  "team_name": "${teamName}",
  "season": "YYYY/YY or YYYY",
  "data_sources": ["list of sources used"],
  "sample_confidence": "low|medium|high",

  "profile": {
    "attack_style": "counter|direct|possession|mixed",
    "defensive_line": "low|medium|high",
    "pressing_intensity": "low|medium|high",
    "set_piece_threat": "low|medium|high",
    "home_strength": "weak|normal|strong",
    "form_consistency": "volatile|inconsistent|consistent",
    "squad_depth": "shallow|medium|deep",
    "avg_goals_scored": <number or null>,
    "avg_goals_conceded": <number or null>,
    "clean_sheet_rate": <0-100 percentage or null>,
    "btts_rate": <0-100 percentage or null>,
    "over_2_5_rate": <0-100 percentage or null>,
    "avg_corners_for": <number or null>,
    "avg_corners_against": <number or null>,
    "avg_cards": <yellow cards per match or null>,
    "first_goal_rate": <0-100 percentage or null>,
    "late_goal_rate": <0-100 percentage — goals scored OR conceded ≥76' or null>,
    "data_reliability_tier": "low|medium|high"
  },

  "notes_en": "Brief analyst note: key betting considerations for this team (home/away splits, cup vs league performance, injury patterns, set-piece danger, etc.)",
  "notes_vi": "Ghi chú tương tự bằng tiếng Việt"
}

Field definitions for accuracy:
- attack_style: counter = absorb & transition; direct = long balls/crosses; possession = build-up play; mixed = no clear tendency
- defensive_line: low = deep block; medium = mid-block; high = high press/offside trap
- pressing_intensity: how aggressively the team presses out of possession
- set_piece_threat: danger from corners, free kicks (both attacking and defensive vulnerability)
- home_strength: how much stronger at home vs away (affects Asian Handicap calibration)
- form_consistency: volatile = results unpredictable; inconsistent = occasional streaks; consistent = reliable
- squad_depth: shallow = small rotation, fatigue risk; deep = strong bench
- first_goal_rate: percentage of matches where THIS team scores first (key for AH 0/-0.5)
- late_goal_rate: percentage of matches with a goal in 76th minute or later (either team)
- data_reliability_tier: low = few matches/obscure league; medium = sufficient sample; high = top league, rich data
`.trim();
}

// ── JSON parser ───────────────────────────────────────────────────────────────

export function parseImportedTeamProfile(
  raw: string,
  teamName: string,
): ParseImportResult {
  let repaired = false;
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    try {
      const fixed = repairJson(raw);
      parsed = JSON.parse(fixed);
      repaired = true;
    } catch {
      throw new Error('Invalid JSON — could not parse even after repair attempt.');
    }
  }

  if (!isRecord(parsed)) throw new Error('Parsed JSON is not an object.');

  // Extract profile block
  const profileBlock = isRecord(parsed.profile) ? parsed.profile : parsed;

  const defaults = DEFAULT_TEAM_PROFILE_DATA;
  const data: TeamProfileData = {
    attack_style:          readEnum(profileBlock.attack_style,       ATTACK_STYLES, defaults.attack_style),
    defensive_line:        readEnum(profileBlock.defensive_line,     TIER3, defaults.defensive_line),
    pressing_intensity:    readEnum(profileBlock.pressing_intensity, TIER3, defaults.pressing_intensity),
    set_piece_threat:      readEnum(profileBlock.set_piece_threat,   TIER3, defaults.set_piece_threat),
    home_strength:         readEnum(profileBlock.home_strength,      HOME_STRENGTH, defaults.home_strength),
    form_consistency:      readEnum(profileBlock.form_consistency,   FORM_CONSIST, defaults.form_consistency),
    squad_depth:           readEnum(profileBlock.squad_depth,        SQUAD_DEPTH, defaults.squad_depth),
    avg_goals_scored:      readNullableNum(profileBlock.avg_goals_scored),
    avg_goals_conceded:    readNullableNum(profileBlock.avg_goals_conceded),
    clean_sheet_rate:      readNullableNum(profileBlock.clean_sheet_rate),
    btts_rate:             readNullableNum(profileBlock.btts_rate),
    over_2_5_rate:         readNullableNum(profileBlock.over_2_5_rate),
    avg_corners_for:       readNullableNum(profileBlock.avg_corners_for),
    avg_corners_against:   readNullableNum(profileBlock.avg_corners_against),
    avg_cards:             readNullableNum(profileBlock.avg_cards),
    first_goal_rate:       readNullableNum(profileBlock.first_goal_rate),
    late_goal_rate:        readNullableNum(profileBlock.late_goal_rate),
    data_reliability_tier: readEnum(profileBlock.data_reliability_tier, TIER3, defaults.data_reliability_tier),
  };

  const notes_en = readText(parsed.notes_en || profileBlock.notes_en);
  const notes_vi = readText(parsed.notes_vi || profileBlock.notes_vi);

  const draft: TeamProfileDraft = { profile: data, notes_en, notes_vi };

  // Build summary for review step
  const summary: ImportFieldResult[] = [
    { label: 'Attack Style',       value: data.attack_style,          status: data.attack_style          !== defaults.attack_style          ? 'set' : 'default' },
    { label: 'Defensive Line',     value: data.defensive_line,        status: data.defensive_line        !== defaults.defensive_line        ? 'set' : 'default' },
    { label: 'Pressing',           value: data.pressing_intensity,    status: data.pressing_intensity    !== defaults.pressing_intensity    ? 'set' : 'default' },
    { label: 'Set Pieces',         value: data.set_piece_threat,      status: data.set_piece_threat      !== defaults.set_piece_threat      ? 'set' : 'default' },
    { label: 'Home Strength',      value: data.home_strength,         status: data.home_strength         !== defaults.home_strength         ? 'set' : 'default' },
    { label: 'Form Consistency',   value: data.form_consistency,      status: data.form_consistency      !== defaults.form_consistency      ? 'set' : 'default' },
    { label: 'Squad Depth',        value: data.squad_depth,           status: data.squad_depth           !== defaults.squad_depth           ? 'set' : 'default' },
    { label: 'Goals Scored/90',    value: data.avg_goals_scored    != null ? String(data.avg_goals_scored)    : '—', status: data.avg_goals_scored    != null ? 'set' : 'default' },
    { label: 'Goals Conceded/90',  value: data.avg_goals_conceded  != null ? String(data.avg_goals_conceded)  : '—', status: data.avg_goals_conceded  != null ? 'set' : 'default' },
    { label: 'Clean Sheet %',      value: data.clean_sheet_rate    != null ? `${data.clean_sheet_rate}%`    : '—', status: data.clean_sheet_rate    != null ? 'set' : 'default' },
    { label: 'BTTS %',             value: data.btts_rate           != null ? `${data.btts_rate}%`           : '—', status: data.btts_rate           != null ? 'set' : 'default' },
    { label: 'Over 2.5 %',         value: data.over_2_5_rate       != null ? `${data.over_2_5_rate}%`       : '—', status: data.over_2_5_rate       != null ? 'set' : 'default' },
    { label: 'Corners For/90',     value: data.avg_corners_for     != null ? String(data.avg_corners_for)     : '—', status: data.avg_corners_for     != null ? 'set' : 'default' },
    { label: 'Corners Against/90', value: data.avg_corners_against != null ? String(data.avg_corners_against) : '—', status: data.avg_corners_against != null ? 'set' : 'default' },
    { label: 'Cards/90',           value: data.avg_cards           != null ? String(data.avg_cards)           : '—', status: data.avg_cards           != null ? 'set' : 'default' },
    { label: 'First Goal %',       value: data.first_goal_rate     != null ? `${data.first_goal_rate}%`     : '—', status: data.first_goal_rate     != null ? 'set' : 'default' },
    { label: 'Late Goal %',        value: data.late_goal_rate      != null ? `${data.late_goal_rate}%`      : '—', status: data.late_goal_rate      != null ? 'set' : 'default' },
    { label: 'Data Reliability',   value: data.data_reliability_tier, status: data.data_reliability_tier !== defaults.data_reliability_tier ? 'set' : 'default' },
    { label: 'Notes (EN)',         value: notes_en ? notes_en.slice(0, 60) + (notes_en.length > 60 ? '…' : '') : '—', status: notes_en ? 'set' : 'default' },
    { label: 'Notes (VI)',         value: notes_vi ? notes_vi.slice(0, 60) + (notes_vi.length > 60 ? '…' : '') : '—', status: notes_vi ? 'set' : 'default' },
  ];

  void teamName; // used by caller context only
  return { draft, repaired, summary };
}

export function summarizeDraft(draft: TeamProfileDraft): { set: number; total: number } {
  const p = draft.profile;
  const d = DEFAULT_TEAM_PROFILE_DATA;
  const qualSet = [
    p.attack_style !== d.attack_style,
    p.defensive_line !== d.defensive_line,
    p.pressing_intensity !== d.pressing_intensity,
    p.set_piece_threat !== d.set_piece_threat,
    p.home_strength !== d.home_strength,
    p.form_consistency !== d.form_consistency,
    p.squad_depth !== d.squad_depth,
    p.data_reliability_tier !== d.data_reliability_tier,
  ].filter(Boolean).length;
  const quantSet = [
    p.avg_goals_scored, p.avg_goals_conceded, p.clean_sheet_rate,
    p.btts_rate, p.over_2_5_rate, p.avg_corners_for, p.avg_corners_against,
    p.avg_cards, p.first_goal_rate, p.late_goal_rate,
  ].filter((v) => v != null).length;
  return { set: qualSet + quantSet, total: 18 };
}
