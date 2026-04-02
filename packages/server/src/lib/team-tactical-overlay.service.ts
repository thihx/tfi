import { config } from '../config.js';
import { classifyStrategicSourceDomain } from '../config/strategic-source-policy.js';
import { generateGeminiContent } from './gemini.js';
import { auditFailure, auditSkipped, auditSuccess } from './audit.js';
import {
  flattenTeamProfileData,
  getTopLeagueTacticalOverlayRefreshCandidates,
  type TacticalOverlayRefreshCandidateRow,
  type TeamProfileOverlayMetadataInput,
  upsertTeamProfile,
} from '../repos/team-profiles.repo.js';
import { classifyTacticalOverlayCompetition } from './tactical-overlay-eligibility.js';
import { getTacticalOverlaySourceCatalog } from './tactical-overlay-source-catalog.js';

export interface TacticalOverlayRefreshOptions {
  maxPerRun?: number;
  staleDays?: number;
}

export interface TacticalOverlayRefreshSummary {
  candidateTeams: number;
  selectedTeams: number;
  refreshedTeams: number;
  skippedTeams: number;
  failedTeams: number;
  skippedReasons: Record<string, number>;
}

export interface TacticalOverlayRefreshResult {
  teamId: string;
  teamName: string;
  leagueId: number;
  leagueName: string;
  outcome: 'refreshed' | 'skipped' | 'failed';
  reason: string;
  sourceMode: string | null;
  sourceConfidence: 'low' | 'medium' | 'high' | null;
  sourceCount: number;
}

type Confidence = 'low' | 'medium' | 'high';

const ATTACK_STYLES = new Set(['counter', 'direct', 'possession', 'mixed']);
const TIER3 = new Set(['low', 'medium', 'high']);
const SQUAD_DEPTH = new Set(['shallow', 'medium', 'deep']);

function cleanText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function readEnum<T extends string>(value: unknown, allowed: Set<string>, fallback: T): T {
  return allowed.has(value as string) ? (value as T) : fallback;
}

function repairJson(raw: string): string {
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) text = text.slice(start, end + 1);
  let repaired = '';
  let inString = false;
  let escaping = false;
  for (const char of text) {
    if (escaping) {
      repaired += char;
      escaping = false;
      continue;
    }
    if (char === '\\') {
      repaired += char;
      escaping = true;
      continue;
    }
    if (char === '"') {
      repaired += char;
      inString = !inString;
      continue;
    }
    if (inString) {
      if (char === '\n') {
        repaired += '\\n';
        continue;
      }
      if (char === '\r') {
        repaired += '\\r';
        continue;
      }
      if (char === '\t') {
        repaired += '\\t';
        continue;
      }
      if (char < ' ') {
        repaired += ' ';
        continue;
      }
    }
    repaired += char;
  }
  return repaired.replace(/,\s*([}\]])/g, '$1');
}

function extractCandidateText(data: Record<string, unknown>): string {
  const candidates = Array.isArray(data.candidates) ? data.candidates as Array<Record<string, unknown>> : [];
  const content = typeof candidates[0]?.content === 'object' && candidates[0]?.content
    ? candidates[0]?.content as Record<string, unknown>
    : null;
  const parts = Array.isArray(content?.parts) ? content.parts as Array<Record<string, unknown>> : [];
  return parts
    .map((part) => typeof part.text === 'string' ? part.text : '')
    .filter(Boolean)
    .join('\n')
    .trim();
}

function extractGroundedUrls(data: Record<string, unknown>): string[] {
  const candidates = Array.isArray(data.candidates) ? data.candidates as Array<Record<string, unknown>> : [];
  const urls = new Set<string>();

  for (const candidate of candidates) {
    const grounding = typeof candidate.groundingMetadata === 'object' && candidate.groundingMetadata
      ? candidate.groundingMetadata as Record<string, unknown>
      : null;
    if (!grounding) continue;
    const chunks = Array.isArray(grounding.groundingChunks) ? grounding.groundingChunks as Array<Record<string, unknown>> : [];
    for (const chunk of chunks) {
      const web = typeof chunk.web === 'object' && chunk.web ? chunk.web as Record<string, unknown> : null;
      const uri = cleanText(web?.uri);
      if (uri) urls.add(uri);
    }
  }

  return [...urls];
}

function filterTrustedUrls(rawUrls: unknown): string[] {
  if (!Array.isArray(rawUrls)) return [];
  const trusted = new Set<string>();
  for (const entry of rawUrls) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    try {
      const url = new URL(trimmed);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
      const classification = classifyStrategicSourceDomain(url.hostname.toLowerCase());
      if (classification.trustTier === 'tier_1' || classification.trustTier === 'tier_2') {
        trusted.add(url.toString());
      }
    } catch {
      continue;
    }
  }
  return [...trusted].slice(0, 12);
}

function rankConfidence(value: Confidence | null | undefined): number {
  if (value === 'high') return 3;
  if (value === 'medium') return 2;
  if (value === 'low') return 1;
  return 0;
}

function unrankConfidence(rank: number): Confidence | null {
  if (rank >= 3) return 'high';
  if (rank === 2) return 'medium';
  if (rank === 1) return 'low';
  return null;
}

function capConfidenceBySourceCount(confidence: Confidence | null, trustedSourceCount: number): Confidence | null {
  const sourceCap = trustedSourceCount >= 3 ? 3 : trustedSourceCount >= 2 ? 2 : trustedSourceCount >= 1 ? 1 : 0;
  const requested = rankConfidence(confidence);
  return unrankConfidence(Math.min(requested || sourceCap, sourceCap));
}

function buildPrompt(candidate: TacticalOverlayRefreshCandidateRow): string {
  const season = candidate.league_season ? String(candidate.league_season) : 'current';
  const sourceCatalog = getTacticalOverlaySourceCatalog({
    leagueName: candidate.league_name,
    country: candidate.league_country,
    type: candidate.league_type,
    topLeague: candidate.top_league ?? false,
  });
  const preferredDomains = sourceCatalog.preferredDomains.join(', ');
  const researchFocus = sourceCatalog.researchFocus.join(', ');
  return `
You are a football tactical analyst updating a structured tactical overlay for an approved football competition context.

Team:
- Name: ${candidate.team_name}
- League: ${candidate.league_name}
- Country: ${candidate.league_country}
- Season context: ${season}

Rules:
- Research only tactical/style information from trusted football sources.
- Use Google Search grounding sources and prefer official football sites, FBref, Transfermarkt, Soccerway, FotMob, Sofascore, Flashscore, or WhoScored.
- Competition policy: ${sourceCatalog.classification.competitionKind} (${sourceCatalog.classification.reason}).
- Prefer these domains first when available: ${preferredDomains}.
- Prioritize research around: ${researchFocus}.
- Do NOT return quantitative metrics such as goals per match, BTTS, corners, cards, or win rates.
- If evidence is mixed or thin, choose the more conservative neutral bucket rather than over-claiming.
- SOURCE_URLS must contain exact HTTPS URLs that support the tactical overlay.
- Return ONLY the following uppercase key-value lines. No markdown. No JSON.

Required output format:
TEAM_NAME: ${candidate.team_name}
SEASON: YYYY/YY or YYYY
SOURCE_URLS: https://source1 | https://source2 | https://source3
SAMPLE_CONFIDENCE: low|medium|high
ATTACK_STYLE: counter|direct|possession|mixed
DEFENSIVE_LINE: low|medium|high
PRESSING_INTENSITY: low|medium|high
SQUAD_DEPTH: shallow|medium|deep
NOTES_EN: Short tactical betting note in English.
NOTES_VI: Short tactical betting note in Vietnamese.

Definitions:
- attack_style: counter = absorb and break quickly; direct = vertical play, long balls, crosses; possession = controlled build-up; mixed = no dominant pattern
- defensive_line: low = deep block; medium = balanced line; high = aggressive high line
- pressing_intensity: how aggressively the team presses without the ball
- squad_depth: shallow = limited trusted rotation; deep = strong bench and rotation resilience
`.trim();
}

interface ParsedOverlay {
  attackStyle: 'counter' | 'direct' | 'possession' | 'mixed';
  defensiveLine: 'low' | 'medium' | 'high';
  pressingIntensity: 'low' | 'medium' | 'high';
  squadDepth: 'shallow' | 'medium' | 'deep';
  notesEn: string;
  notesVi: string;
  sourceConfidence: Confidence | null;
  sourceUrls: string[];
  sourceSeason: string | null;
}

function parseKeyValueLines(rawText: string): Record<string, string> {
  const record: Record<string, string> = {};
  let currentKey = '';
  for (const rawLine of rawText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    const maybeKey = idx > 0 ? line.slice(0, idx).trim().toUpperCase() : '';
    if (idx > 0 && /^[A-Z_]+$/.test(maybeKey)) {
      currentKey = maybeKey;
      record[currentKey] = line.slice(idx + 1).trim();
      continue;
    }
    if (currentKey) {
      record[currentKey] = `${record[currentKey]} ${line}`.trim();
    }
  }
  return record;
}

function parseOverlayResponse(data: Record<string, unknown>): ParsedOverlay {
  const rawText = extractCandidateText(data);
  if (!rawText) throw new Error('Gemini tactical overlay response was empty.');

  let record: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawText);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Gemini tactical overlay JSON was not an object.');
    }
    record = parsed as Record<string, unknown>;
  } catch {
    try {
      const parsed = JSON.parse(repairJson(rawText));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Gemini tactical overlay JSON was not an object.');
      }
      record = parsed as Record<string, unknown>;
    } catch {
      const lineRecord = parseKeyValueLines(rawText);
      record = {
        team_name: lineRecord.TEAM_NAME,
        season: lineRecord.SEASON,
        data_sources: (lineRecord.SOURCE_URLS || '').split(/\s*\|\s*|\s*,\s*/).filter(Boolean),
        sample_confidence: lineRecord.SAMPLE_CONFIDENCE,
        notes_en: lineRecord.NOTES_EN,
        notes_vi: lineRecord.NOTES_VI,
        profile: {
          attack_style: lineRecord.ATTACK_STYLE,
          defensive_line: lineRecord.DEFENSIVE_LINE,
          pressing_intensity: lineRecord.PRESSING_INTENSITY,
          squad_depth: lineRecord.SQUAD_DEPTH,
        },
      };
    }
  }

  const profile = record.profile && typeof record.profile === 'object' && !Array.isArray(record.profile)
    ? record.profile as Record<string, unknown>
    : record;
  const trustedUrls = filterTrustedUrls(record.data_sources);
  const groundedTrustedUrls = filterTrustedUrls(extractGroundedUrls(data));
  const sourceUrls = [...new Set([...trustedUrls, ...groundedTrustedUrls])].slice(0, 12);
  const rawConfidence = record.sample_confidence === 'low'
    || record.sample_confidence === 'medium'
    || record.sample_confidence === 'high'
    ? record.sample_confidence
    : null;
  const sourceConfidence = capConfidenceBySourceCount(rawConfidence, sourceUrls.length);

  if (sourceUrls.length === 0) {
    throw new Error('No trusted tactical overlay source URLs were found.');
  }

  return {
    attackStyle: readEnum(profile.attack_style, ATTACK_STYLES, 'mixed'),
    defensiveLine: readEnum(profile.defensive_line, TIER3, 'medium'),
    pressingIntensity: readEnum(profile.pressing_intensity, TIER3, 'medium'),
    squadDepth: readEnum(profile.squad_depth, SQUAD_DEPTH, 'medium'),
    notesEn: cleanText(record.notes_en),
    notesVi: cleanText(record.notes_vi),
    sourceConfidence,
    sourceUrls,
    sourceSeason: cleanText(record.season) || null,
  };
}

function computeCandidatePriority(candidate: TacticalOverlayRefreshCandidateRow, nowMs: number, staleDays: number): number | null {
  const overlay = candidate.profile.tactical_overlay;
  if (overlay.source_mode === 'manual_override' || overlay.source_mode === 'curated') return null;
  if (overlay.source_mode === 'default_neutral') return 0;
  const updatedAtMs = overlay.updated_at ? Date.parse(overlay.updated_at) : NaN;
  const staleCutoffMs = nowMs - staleDays * 24 * 60 * 60 * 1000;
  if (!overlay.source_confidence || overlay.source_urls.length === 0) return 1;
  if (!Number.isFinite(updatedAtMs) || updatedAtMs <= staleCutoffMs) return 2;
  return null;
}

function pickBestEligibleCompetitionCandidates(
  candidates: TacticalOverlayRefreshCandidateRow[],
): TacticalOverlayRefreshCandidateRow[] {
  const bestByTeam = new Map<string, { candidate: TacticalOverlayRefreshCandidateRow; sortRank: number }>();
  for (const candidate of candidates) {
    const classification = classifyTacticalOverlayCompetition({
      leagueName: candidate.league_name,
      country: candidate.league_country,
      type: candidate.league_type,
      topLeague: candidate.top_league ?? false,
    });
    if (!classification.eligible) continue;
    const current = bestByTeam.get(candidate.team_id);
    if (!current || classification.sortRank > current.sortRank) {
      bestByTeam.set(candidate.team_id, { candidate, sortRank: classification.sortRank });
    }
  }
  return [...bestByTeam.values()].map((entry) => entry.candidate);
}

export function selectTacticalOverlayRefreshCandidates(
  candidates: TacticalOverlayRefreshCandidateRow[],
  options: Required<TacticalOverlayRefreshOptions>,
  now = new Date(),
): TacticalOverlayRefreshCandidateRow[] {
  const nowMs = now.getTime();
  return pickBestEligibleCompetitionCandidates(candidates)
    .map((candidate) => ({
      candidate,
      priority: computeCandidatePriority(candidate, nowMs, options.staleDays),
    }))
    .filter((entry): entry is { candidate: TacticalOverlayRefreshCandidateRow; priority: number } => entry.priority != null)
    .sort((left, right) =>
      left.priority - right.priority
      || (Date.parse(left.candidate.profile.tactical_overlay.updated_at ?? '1970-01-01T00:00:00.000Z')
        - Date.parse(right.candidate.profile.tactical_overlay.updated_at ?? '1970-01-01T00:00:00.000Z'))
      || left.candidate.team_name.localeCompare(right.candidate.team_name))
    .slice(0, options.maxPerRun)
    .map((entry) => entry.candidate);
}

export async function refreshTacticalOverlayForCandidate(
  candidate: TacticalOverlayRefreshCandidateRow,
): Promise<TacticalOverlayRefreshResult> {
  const overlay = candidate.profile.tactical_overlay;
  if (overlay.source_mode === 'manual_override' || overlay.source_mode === 'curated') {
    return {
      teamId: candidate.team_id,
      teamName: candidate.team_name,
      leagueId: candidate.league_id,
      leagueName: candidate.league_name,
      outcome: 'skipped',
      reason: 'protected_source_mode',
      sourceMode: overlay.source_mode,
      sourceConfidence: overlay.source_confidence,
      sourceCount: overlay.source_urls.length,
    };
  }

  const start = Date.now();
  try {
    const prompt = buildPrompt(candidate);
    const response = await generateGeminiContent(prompt, {
      model: config.geminiStrategicGroundedModel,
      timeoutMs: config.geminiTimeoutMs,
      withSearch: true,
      temperature: 0,
      maxOutputTokens: 2048,
      thinkingBudget: config.geminiStrategicGroundedThinkingBudget,
    });
    const parsed = parseOverlayResponse(response);
    const profile = flattenTeamProfileData(candidate.profile);
    const overlayMetadata: TeamProfileOverlayMetadataInput = {
      source_mode: 'llm_assisted',
      source_confidence: parsed.sourceConfidence,
      source_urls: parsed.sourceUrls,
      source_season: parsed.sourceSeason,
    };

    await upsertTeamProfile(candidate.team_id, {
      profile: {
        ...profile,
        attack_style: parsed.attackStyle,
        defensive_line: parsed.defensiveLine,
        pressing_intensity: parsed.pressingIntensity,
        squad_depth: parsed.squadDepth,
      },
      notes_en: parsed.notesEn || candidate.notes_en,
      notes_vi: parsed.notesVi || candidate.notes_vi,
      overlay_metadata: overlayMetadata,
    });

    auditSuccess('reference-data', 'TACTICAL_OVERLAY_REFRESHED', {
      actor: 'scheduler',
      duration_ms: Date.now() - start,
      metadata: {
        teamId: candidate.team_id,
        teamName: candidate.team_name,
        leagueId: candidate.league_id,
        leagueName: candidate.league_name,
        sourceMode: 'llm_assisted',
        sourceConfidence: parsed.sourceConfidence,
        sourceCount: parsed.sourceUrls.length,
      },
    });

    return {
      teamId: candidate.team_id,
      teamName: candidate.team_name,
      leagueId: candidate.league_id,
      leagueName: candidate.league_name,
      outcome: 'refreshed',
      reason: 'updated',
      sourceMode: 'llm_assisted',
      sourceConfidence: parsed.sourceConfidence,
      sourceCount: parsed.sourceUrls.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    auditFailure('reference-data', 'TACTICAL_OVERLAY_REFRESHED', message, {
      actor: 'scheduler',
      duration_ms: Date.now() - start,
      metadata: {
        teamId: candidate.team_id,
        teamName: candidate.team_name,
        leagueId: candidate.league_id,
        leagueName: candidate.league_name,
      },
    });
    return {
      teamId: candidate.team_id,
      teamName: candidate.team_name,
      leagueId: candidate.league_id,
      leagueName: candidate.league_name,
      outcome: 'failed',
      reason: message,
      sourceMode: overlay.source_mode,
      sourceConfidence: overlay.source_confidence,
      sourceCount: overlay.source_urls.length,
    };
  }
}

export async function refreshTopLeagueTacticalOverlays(
  options: TacticalOverlayRefreshOptions = {},
): Promise<TacticalOverlayRefreshSummary & { results: TacticalOverlayRefreshResult[] }> {
  const resolved: Required<TacticalOverlayRefreshOptions> = {
    maxPerRun: Math.max(1, Math.trunc(options.maxPerRun ?? config.tacticalOverlayRefreshMaxPerRun)),
    staleDays: Math.max(1, Math.trunc(options.staleDays ?? config.tacticalOverlayRefreshStaleDays)),
  };

  if (!config.geminiApiKey) {
    auditSkipped('reference-data', 'TACTICAL_OVERLAY_REFRESH_RUN', {
      actor: 'scheduler',
      metadata: { reason: 'missing_gemini_api_key' },
    });
    return {
      candidateTeams: 0,
      selectedTeams: 0,
      refreshedTeams: 0,
      skippedTeams: 0,
      failedTeams: 0,
      skippedReasons: { missing_gemini_api_key: 1 },
      results: [],
    };
  }

  const allCandidates = await getTopLeagueTacticalOverlayRefreshCandidates();
  const eligibleCandidates = pickBestEligibleCompetitionCandidates(allCandidates);
  const selected = selectTacticalOverlayRefreshCandidates(allCandidates, resolved);
  const results: TacticalOverlayRefreshResult[] = [];
  const skippedReasons: Record<string, number> = {};
  let refreshedTeams = 0;
  let skippedTeams = 0;
  let failedTeams = 0;

  for (const candidate of selected) {
    const result = await refreshTacticalOverlayForCandidate(candidate);
    results.push(result);
    if (result.outcome === 'refreshed') refreshedTeams += 1;
    else if (result.outcome === 'skipped') {
      skippedTeams += 1;
      skippedReasons[result.reason] = (skippedReasons[result.reason] ?? 0) + 1;
    } else {
      failedTeams += 1;
      skippedReasons[result.reason] = (skippedReasons[result.reason] ?? 0) + 1;
    }
  }

  return {
    candidateTeams: eligibleCandidates.length,
    selectedTeams: selected.length,
    refreshedTeams,
    skippedTeams,
    failedTeams,
    skippedReasons,
    results,
  };
}

export const __testables__ = {
  buildPrompt,
  parseOverlayResponse,
  selectTacticalOverlayRefreshCandidates,
  capConfidenceBySourceCount,
  pickBestEligibleCompetitionCandidates,
};
