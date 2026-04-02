import type { TeamProfile, TeamProfileData } from '@/types';
import { filterTrustedTacticalOverlaySourceUrls } from './tacticalOverlaySourcePolicy';
import { getTacticalOverlaySourceCatalog } from './tacticalOverlaySourceCatalog';

export interface TeamProfileOverlayMetadata {
  source_mode: 'default_neutral' | 'curated' | 'llm_assisted' | 'manual_override';
  source_confidence: 'low' | 'medium' | 'high' | null;
  source_urls: string[];
  source_season: string | null;
}

export type TeamProfileDraft = Omit<TeamProfile, 'team_id' | 'created_at' | 'updated_at'> & {
  profile: TeamProfileData;
  overlay_metadata?: TeamProfileOverlayMetadata;
};

export type ImportFieldStatus = 'set' | 'default';
export type ImportFieldResult = { label: string; value: string; status: ImportFieldStatus };
export type ParseImportResult = { draft: TeamProfileDraft; repaired: boolean; summary: ImportFieldResult[]; warnings: string[] };

export const DEFAULT_TEAM_PROFILE_DATA: TeamProfileData = {
  attack_style: 'mixed',
  defensive_line: 'medium',
  pressing_intensity: 'medium',
  set_piece_threat: 'medium',
  home_strength: 'normal',
  form_consistency: 'inconsistent',
  squad_depth: 'medium',
  avg_goals_scored: null,
  avg_goals_conceded: null,
  clean_sheet_rate: null,
  btts_rate: null,
  over_2_5_rate: null,
  avg_corners_for: null,
  avg_corners_against: null,
  avg_cards: null,
  first_goal_rate: null,
  late_goal_rate: null,
  data_reliability_tier: 'medium',
};

export const DEFAULT_TEAM_PROFILE_DRAFT: TeamProfileDraft = {
  profile: { ...DEFAULT_TEAM_PROFILE_DATA },
  notes_en: '',
  notes_vi: '',
  overlay_metadata: {
    source_mode: 'default_neutral',
    source_confidence: null,
    source_urls: [],
    source_season: null,
  },
};

const ATTACK_STYLES = new Set(['counter', 'direct', 'possession', 'mixed']);
const TIER3 = new Set(['low', 'medium', 'high']);
const SQUAD_DEPTH = new Set(['shallow', 'medium', 'deep']);

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function readText(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function readEnum<T extends string>(v: unknown, allowed: Set<string>, fallback: T): T {
  return allowed.has(v as string) ? (v as T) : fallback;
}

function repairJson(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) s = s.slice(start, end + 1);
  s = s.replace(/,\s*([}\]])/g, '$1');
  return s;
}

export function buildTeamProfileDeepResearchPrompt(
  teamName: string,
  leagueName?: string,
): string {
  const context = leagueName ? ` (currently associated with ${leagueName})` : '';
  const sourceCatalog = getTacticalOverlaySourceCatalog(leagueName);
  return `
You are a football tactical analyst. Research the team "${teamName}"${context} and return a structured tactical overlay for betting analysis.

Important constraints:
- This workflow is for TACTICAL OVERLAY ONLY.
- Do NOT estimate or return quantitative metrics such as goals per match, BTTS rate, corners, cards, or reliability tiers.
- Use trusted football sources only. Prefer exact HTTPS URLs from official club or league sites, FBref, Transfermarkt, Soccerway, FotMob, Sofascore, Flashscore, or WhoScored.
- Prefer these domains first when available: ${sourceCatalog.preferredDomains.join(', ')}.
- Prioritize research around: ${sourceCatalog.researchFocus.join(', ')}.
- data_sources must contain real source URLs, not source labels.
- Return ONLY valid JSON. No markdown, no prose outside JSON.
- The same schema may be reused later for club teams or national teams. If the team is a national side, reflect that in entity_type and competition_context.

Required JSON schema:
{
  "schema_version": 1,
  "target": "team_tactical_overlay",
  "entity_type": "club|national_team|unknown",
  "team_name": "${teamName}",
  "competition_context": "${leagueName ? `${leagueName} season context` : 'Optional competition or tournament context'}",
  "season": "YYYY/YY or YYYY",
  "data_sources": ["exact source URLs or short source labels"],
  "sample_confidence": "low|medium|high",
  "profile": {
    "attack_style": "counter|direct|possession|mixed",
    "defensive_line": "low|medium|high",
    "pressing_intensity": "low|medium|high",
    "squad_depth": "shallow|medium|deep"
  },
  "notes_en": "Short tactical betting note in English.",
  "notes_vi": "Short tactical betting note in Vietnamese."
}

Field definitions:
- attack_style: counter = absorb and transition; direct = long balls, crosses, quick vertical play; possession = controlled build-up; mixed = no clear dominant pattern
- defensive_line: low = deep block; medium = mid-block; high = aggressive line and press
- pressing_intensity: how aggressively the team presses without the ball
- squad_depth: shallow = limited rotation and bench depth; deep = strong bench and rotation resilience
- sample_confidence: confidence in this tactical overlay only, not a quantitative coverage score
- competition_context: optional text like "Premier League 2025/26" or "FIFA World Cup 2026 preparation"
`.trim();
}

export function parseImportedTeamProfile(
  raw: string,
  teamName: string,
  currentDraft: TeamProfileDraft = DEFAULT_TEAM_PROFILE_DRAFT,
): ParseImportResult {
  let repaired = false;
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    try {
      parsed = JSON.parse(repairJson(raw));
      repaired = true;
    } catch {
      throw new Error('Invalid JSON - could not parse even after repair attempt.');
    }
  }

  if (!isRecord(parsed)) throw new Error('Parsed JSON is not an object.');
  if (parsed.target != null && parsed.target !== 'team_tactical_overlay') {
    throw new Error('Imported JSON target is not team_tactical_overlay.');
  }
  if (parsed.schema_version != null && parsed.schema_version !== 1) {
    throw new Error('Unsupported tactical overlay schema_version.');
  }

  const profileBlock = isRecord(parsed.profile) ? parsed.profile : parsed;
  const currentProfile = currentDraft.profile ?? DEFAULT_TEAM_PROFILE_DATA;
  const currentOverlayMetadata = currentDraft.overlay_metadata ?? DEFAULT_TEAM_PROFILE_DRAFT.overlay_metadata!;
  const notesEn = readText(parsed.notes_en || profileBlock.notes_en) || currentDraft.notes_en;
  const notesVi = readText(parsed.notes_vi || profileBlock.notes_vi) || currentDraft.notes_vi;
  const sourceConfidence =
    parsed.sample_confidence === 'low'
    || parsed.sample_confidence === 'medium'
    || parsed.sample_confidence === 'high'
      ? parsed.sample_confidence
      : currentOverlayMetadata.source_confidence;
  const { trusted: sourceUrls, dropped: droppedSourceUrls } = filterTrustedTacticalOverlaySourceUrls(parsed.data_sources);
  const sourceSeason = readText(parsed.season) || currentOverlayMetadata.source_season || null;
  if (sourceUrls.length === 0) {
    throw new Error('No trusted tactical overlay source URLs found. Use exact HTTPS URLs from trusted football sources.');
  }
  const warnings = droppedSourceUrls.length > 0
    ? [`Dropped ${droppedSourceUrls.length} untrusted or invalid source entr${droppedSourceUrls.length === 1 ? 'y' : 'ies'}.`]
    : [];

  const profile: TeamProfileData = {
    ...currentProfile,
    attack_style: readEnum(profileBlock.attack_style, ATTACK_STYLES, currentProfile.attack_style),
    defensive_line: readEnum(profileBlock.defensive_line, TIER3, currentProfile.defensive_line),
    pressing_intensity: readEnum(profileBlock.pressing_intensity, TIER3, currentProfile.pressing_intensity),
    squad_depth: readEnum(profileBlock.squad_depth, SQUAD_DEPTH, currentProfile.squad_depth),
  };

  const draft: TeamProfileDraft = {
    profile,
    notes_en: notesEn,
    notes_vi: notesVi,
    overlay_metadata: {
      source_mode: 'llm_assisted',
      source_confidence: sourceConfidence,
      source_urls: sourceUrls,
      source_season: sourceSeason,
    },
  };

  const summary: ImportFieldResult[] = [
    { label: 'Attack Style', value: profile.attack_style, status: profile.attack_style !== currentProfile.attack_style ? 'set' : 'default' },
    { label: 'Defensive Line', value: profile.defensive_line, status: profile.defensive_line !== currentProfile.defensive_line ? 'set' : 'default' },
    { label: 'Pressing', value: profile.pressing_intensity, status: profile.pressing_intensity !== currentProfile.pressing_intensity ? 'set' : 'default' },
    { label: 'Squad Depth', value: profile.squad_depth, status: profile.squad_depth !== currentProfile.squad_depth ? 'set' : 'default' },
    { label: 'Source Confidence', value: sourceConfidence ?? '-', status: sourceConfidence ? 'set' : 'default' },
    { label: 'Source Count', value: sourceUrls.length ? String(sourceUrls.length) : '-', status: sourceUrls.length > 0 ? 'set' : 'default' },
    { label: 'Season', value: sourceSeason ?? '-', status: sourceSeason ? 'set' : 'default' },
    { label: 'Notes (EN)', value: notesEn ? notesEn.slice(0, 60) + (notesEn.length > 60 ? '...' : '') : '-', status: notesEn ? 'set' : 'default' },
    { label: 'Notes (VI)', value: notesVi ? notesVi.slice(0, 60) + (notesVi.length > 60 ? '...' : '') : '-', status: notesVi ? 'set' : 'default' },
  ];

  void teamName;
  return { draft, repaired, summary, warnings };
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
    p.avg_goals_scored,
    p.avg_goals_conceded,
    p.clean_sheet_rate,
    p.btts_rate,
    p.over_2_5_rate,
    p.avg_corners_for,
    p.avg_corners_against,
    p.avg_cards,
    p.first_goal_rate,
    p.late_goal_rate,
  ].filter((v) => v != null).length;
  const overlaySet = [
    draft.overlay_metadata?.source_confidence,
    draft.overlay_metadata?.source_urls?.length ? 'sources' : null,
    draft.overlay_metadata?.source_season,
  ].filter(Boolean).length;
  return { set: qualSet + quantSet + overlaySet, total: 21 };
}
