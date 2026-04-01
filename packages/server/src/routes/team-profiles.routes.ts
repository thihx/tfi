import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireAdminOrOwner, requireCurrentUser } from '../lib/authz.js';
import {
  getAllTeamProfiles,
  getTeamProfileByTeamId,
  upsertTeamProfile,
  deleteTeamProfile,
  flattenTeamProfileRow,
  getTacticalOverlayEligibilityForTeam,
  type TeamProfileData,
  type TeamProfileOverlayMetadataInput,
  type TeamProfileInput,
} from '../repos/team-profiles.repo.js';
import { classifyStrategicSourceDomain } from '../config/strategic-source-policy.js';

// ── Validation helpers ───────────────────────────────────────────────────────

const ATTACK_STYLES  = new Set(['counter', 'direct', 'possession', 'mixed']);
const TIER3          = new Set(['low', 'medium', 'high']);
const HOME_STRENGTH  = new Set(['weak', 'normal', 'strong']);
const FORM_CONSIST   = new Set(['volatile', 'inconsistent', 'consistent']);
const SQUAD_DEPTH    = new Set(['shallow', 'medium', 'deep']);

function readEnum<T extends string>(v: unknown, allowed: Set<string>, fallback: T): T {
  return allowed.has(v as string) ? (v as T) : fallback;
}

function readNullableNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function normalizeTrustedOverlaySourceUrls(rawUrls: string[] | undefined): string[] {
  if (!rawUrls) return [];
  const trusted = new Set<string>();
  for (const entry of rawUrls) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    try {
      const url = new URL(trimmed);
      const protocol = url.protocol.toLowerCase();
      if (protocol !== 'https:' && protocol !== 'http:') continue;
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

function validateOverlayMetadata(raw: unknown): TeamProfileOverlayMetadataInput | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  const sourceMode =
    value.source_mode === 'default_neutral'
    || value.source_mode === 'curated'
    || value.source_mode === 'llm_assisted'
    || value.source_mode === 'manual_override'
      ? value.source_mode
      : undefined;
  const sourceConfidence =
    value.source_confidence === 'low'
    || value.source_confidence === 'medium'
    || value.source_confidence === 'high'
      ? value.source_confidence
      : undefined;
  const sourceUrls = Array.isArray(value.source_urls)
    ? normalizeTrustedOverlaySourceUrls(value.source_urls as string[])
    : undefined;
  const sourceSeason = typeof value.source_season === 'string'
    ? value.source_season.trim() || null
    : value.source_season === null
      ? null
      : undefined;

  if (!sourceMode && !sourceConfidence && !sourceUrls && sourceSeason === undefined) {
    return undefined;
  }

  return {
    ...(sourceMode ? { source_mode: sourceMode } : {}),
    ...(sourceConfidence ? { source_confidence: sourceConfidence } : {}),
    ...(sourceUrls ? { source_urls: sourceUrls } : {}),
    ...(sourceSeason !== undefined ? { source_season: sourceSeason } : {}),
  };
}

function validateOverlayWorkflowRules(
  overlayMetadata: TeamProfileOverlayMetadataInput | undefined,
  options: { overlayEligible: boolean },
): string | null {
  if (!overlayMetadata) return null;
  const sourceMode = overlayMetadata.source_mode ?? 'default_neutral';
  if (sourceMode === 'default_neutral') return null;
  if (!options.overlayEligible) {
    return 'Tactical overlay refresh is limited to approved competition contexts: top domestic leagues, continental club competitions, and major international tournaments or qualifiers.';
  }
  if (overlayMetadata.source_confidence !== 'low'
    && overlayMetadata.source_confidence !== 'medium'
    && overlayMetadata.source_confidence !== 'high') {
    return 'Tactical overlay requires source confidence.';
  }
  if (!overlayMetadata.source_urls || overlayMetadata.source_urls.length === 0) {
    return 'Tactical overlay requires at least one trusted source URL.';
  }
  return null;
}

function validateProfile(raw: unknown): TeamProfileData {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('profile must be an object');
  }
  const p = raw as Record<string, unknown>;
  return {
    attack_style:          readEnum(p.attack_style,       ATTACK_STYLES, 'mixed'),
    defensive_line:        readEnum(p.defensive_line,     TIER3, 'medium'),
    pressing_intensity:    readEnum(p.pressing_intensity, TIER3, 'medium'),
    set_piece_threat:      readEnum(p.set_piece_threat,   TIER3, 'medium'),
    home_strength:         readEnum(p.home_strength,      HOME_STRENGTH, 'normal'),
    form_consistency:      readEnum(p.form_consistency,   FORM_CONSIST, 'inconsistent'),
    squad_depth:           readEnum(p.squad_depth,        SQUAD_DEPTH, 'medium'),
    avg_goals_scored:      readNullableNum(p.avg_goals_scored),
    avg_goals_conceded:    readNullableNum(p.avg_goals_conceded),
    clean_sheet_rate:      readNullableNum(p.clean_sheet_rate),
    btts_rate:             readNullableNum(p.btts_rate),
    over_2_5_rate:         readNullableNum(p.over_2_5_rate),
    avg_corners_for:       readNullableNum(p.avg_corners_for),
    avg_corners_against:   readNullableNum(p.avg_corners_against),
    avg_cards:             readNullableNum(p.avg_cards),
    first_goal_rate:       readNullableNum(p.first_goal_rate),
    late_goal_rate:        readNullableNum(p.late_goal_rate),
    data_reliability_tier: readEnum(p.data_reliability_tier, TIER3, 'medium'),
  };
}

// ── Route registration ───────────────────────────────────────────────────────

export async function teamProfileRoutes(app: FastifyInstance) {
  const getTeamProfile = async (
    req: FastifyRequest<{ Params: { teamId: string } }>,
    reply: FastifyReply,
  ) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    const { teamId } = req.params as { teamId: string };
    const row = await getTeamProfileByTeamId(teamId);
    if (!row) return reply.status(404).send({ error: 'Profile not found' });
    return flattenTeamProfileRow(row);
  };

  const putTeamProfile = async (
    req: FastifyRequest<{ Params: { teamId: string }; Body: Record<string, unknown> }>,
    reply: FastifyReply,
  ) => {
    const user = requireAdminOrOwner(req, reply);
    if (!user) return;
    const { teamId } = req.params as { teamId: string };
    const body = req.body as Record<string, unknown>;
    const overlayMetadata = validateOverlayMetadata(body.overlay_metadata);
    const overlayEligibility = await getTacticalOverlayEligibilityForTeam(teamId);
    const overlayRuleViolation = validateOverlayWorkflowRules(overlayMetadata, {
      overlayEligible: overlayEligibility.eligible,
    });
    if (overlayRuleViolation) {
      return reply.status(400).send({ error: overlayRuleViolation });
    }

    let profileData: TeamProfileData;
    try {
      profileData = validateProfile(body.profile);
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }

    const input: TeamProfileInput = {
      profile:  profileData,
      notes_en: typeof body.notes_en === 'string' ? body.notes_en.trim() : '',
      notes_vi: typeof body.notes_vi === 'string' ? body.notes_vi.trim() : '',
      overlay_metadata: overlayMetadata,
    };

    const saved = await upsertTeamProfile(teamId, input);
    return flattenTeamProfileRow(saved);
  };

  const removeTeamProfile = async (
    req: FastifyRequest<{ Params: { teamId: string } }>,
    reply: FastifyReply,
  ) => {
    const user = requireAdminOrOwner(req, reply);
    if (!user) return;
    const { teamId } = req.params as { teamId: string };
    const deleted = await deleteTeamProfile(teamId);
    if (!deleted) return reply.status(404).send({ error: 'Profile not found' });
    return { ok: true };
  };

  /** List all team profiles (with team metadata joined) */
  app.get('/api/team-profiles', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    const rows = await getAllTeamProfiles();
    return rows.map(flattenTeamProfileRow);
  });

  /** Get profile for a single team */
  app.get('/api/favorite-teams/:teamId/profile', getTeamProfile);
  app.get('/api/me/favorite-teams/:teamId/profile', getTeamProfile);

  /** Create or update profile for a team */
  app.put('/api/favorite-teams/:teamId/profile', putTeamProfile);
  app.put('/api/me/favorite-teams/:teamId/profile', putTeamProfile);

  /** Delete a team profile */
  app.delete('/api/favorite-teams/:teamId/profile', removeTeamProfile);
  app.delete('/api/me/favorite-teams/:teamId/profile', removeTeamProfile);
}
