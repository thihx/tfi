// ============================================================
// Leagues Routes
// ============================================================

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as repo from '../repos/leagues.repo.js';
import * as profileRepo from '../repos/league-profiles.repo.js';
import * as favoriteTeamsRepo from '../repos/favorite-teams.repo.js';
import * as teamProfilesRepo from '../repos/team-profiles.repo.js';
import { getRedisClient } from '../lib/redis.js';
import { requireCurrentUser } from '../lib/authz.js';
import {
  ensureLeagueCatalogEntry,
  refreshLeagueCatalog,
  type LeagueCatalogRefreshMode,
} from '../lib/league-catalog.service.js';
import { getTopLeagueProfileCoverage } from '../lib/profile-coverage.js';

const ACTIVE_CACHE_KEY = 'cache:leagues:active';
const ALL_CACHE_KEY = 'cache:leagues:all';
const ACTIVE_CACHE_TTL_SEC = 5 * 60; // 5 minutes

async function getActiveLeaguesCached(): Promise<repo.LeagueRow[]> {
  try {
    const redis = getRedisClient();
    const cached = await redis.get(ACTIVE_CACHE_KEY);
    if (cached) return JSON.parse(cached) as repo.LeagueRow[];
  } catch { /* Redis down → proceed to DB */ }

  const leagues = await repo.getActiveLeagues();

  try {
    await getRedisClient().set(ACTIVE_CACHE_KEY, JSON.stringify(leagues), 'EX', ACTIVE_CACHE_TTL_SEC);
  } catch { /* non-critical */ }

  return leagues;
}

async function getAllLeaguesCached(): Promise<repo.LeagueRow[]> {
  try {
    const redis = getRedisClient();
    const cached = await redis.get(ALL_CACHE_KEY);
    if (cached) return JSON.parse(cached) as repo.LeagueRow[];
  } catch { /* Redis down → proceed to DB */ }

  const leagues = await repo.getAllLeagues();

  try {
    await getRedisClient().set(ALL_CACHE_KEY, JSON.stringify(leagues), 'EX', ACTIVE_CACHE_TTL_SEC);
  } catch { /* non-critical */ }

  return leagues;
}

async function invalidateActiveLeaguesCache(): Promise<void> {
  try { await getRedisClient().del(ACTIVE_CACHE_KEY, ALL_CACHE_KEY); } catch { /* ignore */ }
}

const TIER_VALUES = new Set<profileRepo.LeagueTier>(['low', 'balanced', 'high']);
const TIER_ALIASES: Record<string, profileRepo.LeagueTier> = {
  medium: 'balanced',
  normal: 'balanced',
};

function parseNullableNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function readTier(value: unknown): profileRepo.LeagueTier | null {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return 'balanced';
  if (raw in TIER_ALIASES) return TIER_ALIASES[raw] ?? null;
  return TIER_VALUES.has(raw as profileRepo.LeagueTier)
    ? raw as profileRepo.LeagueTier
    : null;
}

interface NormalizedProfilePayload {
  profile: profileRepo.LeagueProfileData;
  notes_en: string;
  notes_vi: string;
}

function normalizeProfilePayload(body: Record<string, unknown>): NormalizedProfilePayload | null {
  const p = (body.profile != null && typeof body.profile === 'object' && !Array.isArray(body.profile))
    ? body.profile as Record<string, unknown>
    : body;

  const tempoTier = readTier(p.tempo_tier);
  const goalTendency = readTier(p.goal_tendency);
  const homeAdvantageTier = readTier(p.home_advantage_tier);
  const cornersTendency = readTier(p.corners_tendency);
  const cardsTendency = readTier(p.cards_tendency);
  const volatilityTier = readTier(p.volatility_tier);
  const dataReliabilityTier = readTier(p.data_reliability_tier);

  if (
    tempoTier == null
    || goalTendency == null
    || homeAdvantageTier == null
    || cornersTendency == null
    || cardsTendency == null
    || volatilityTier == null
    || dataReliabilityTier == null
  ) {
    return null;
  }

  return {
    profile: {
      tempo_tier:            tempoTier,
      goal_tendency:         goalTendency,
      home_advantage_tier:   homeAdvantageTier,
      corners_tendency:      cornersTendency,
      cards_tendency:        cardsTendency,
      volatility_tier:       volatilityTier,
      data_reliability_tier: dataReliabilityTier,
      avg_goals:             parseNullableNumber(p.avg_goals),
      over_2_5_rate:         parseNullableNumber(p.over_2_5_rate),
      btts_rate:             parseNullableNumber(p.btts_rate),
      late_goal_rate_75_plus: parseNullableNumber(p.late_goal_rate_75_plus),
      avg_corners:           parseNullableNumber(p.avg_corners),
      avg_cards:             parseNullableNumber(p.avg_cards),
    },
    notes_en: String(body.notes_en ?? '').trim(),
    notes_vi: String(body.notes_vi ?? '').trim(),
  };
}

function readRefreshMode(value: unknown): LeagueCatalogRefreshMode {
  return value === 'full' || value === 'ids' || value === 'active-top'
    ? value
    : 'full';
}

export async function leagueRoutes(app: FastifyInstance) {
  app.get('/api/leagues', async () => {
    return getAllLeaguesCached();
  });

  /** Single request that loads all data needed for the Leagues tab on mount. */
  app.get('/api/leagues/init', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    const [leagues, favoriteTeams, profiledIdSet] = await Promise.all([
      getAllLeaguesCached(),
      favoriteTeamsRepo.getFavoriteTeams(user.userId),
      teamProfilesRepo.getTeamIdsWithProfile(),
    ]);
    return {
      leagues,
      favoriteTeamIds: favoriteTeams.map((f) => f.team_id),
      profiledTeamIds: Array.from(profiledIdSet),
    };
  });

  /** Static path must be registered before `/api/leagues/:id` so it is not captured as an ID. */
  app.get('/api/leagues/profile-coverage', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    return getTopLeagueProfileCoverage();
  });

  /** Register before any `/api/leagues/:id` route so `reorder` is never treated as an `:id`. */
  app.put<{ Body: { ordered_ids: number[] } }>('/api/leagues/reorder', async (req, reply) => {
    const raw = req.body?.ordered_ids;
    if (!Array.isArray(raw) || raw.length === 0) {
      return reply.code(400).send({ error: 'ordered_ids must be a non-empty array of integers' });
    }
    const ids: number[] = [];
    for (const x of raw) {
      const n = typeof x === 'number' ? x : Number(String(x));
      if (!Number.isInteger(n)) {
        return reply.code(400).send({ error: 'ordered_ids must be a non-empty array of integers' });
      }
      ids.push(n);
    }
    const updated = await repo.reorderLeagues(ids);
    void invalidateActiveLeaguesCache();
    return { updated };
  });

  app.get('/api/leagues/active', async () => {
    return getActiveLeaguesCached();
  });

  app.get<{ Params: { id: string } }>('/api/leagues/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'Invalid league ID' });
    const league = await ensureLeagueCatalogEntry(id);
    if (!league) return reply.code(404).send({ error: 'League not found' });
    return league;
  });

  app.put<{ Params: { id: string }; Body: { active: boolean } }>(
    '/api/leagues/:id/active',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (Number.isNaN(id)) return reply.code(400).send({ error: 'Invalid league ID' });
      const ok = await repo.updateLeagueActive(id, req.body.active);
      if (!ok) return reply.code(404).send({ error: 'League not found' });
      void invalidateActiveLeaguesCache();
      return { league_id: id, active: req.body.active };
    },
  );

  app.post<{ Body: { ids: number[]; active: boolean } }>(
    '/api/leagues/bulk-active',
    async (req) => {
      const count = await repo.bulkSetActive(req.body.ids, req.body.active);
      void invalidateActiveLeaguesCache();
      return { updated: count };
    },
  );

  // ── Top-league endpoints ──

  app.get('/api/leagues/top', async () => {
    return repo.getTopLeagues();
  });

  app.get('/api/league-profiles', async () => {
    const rows = await profileRepo.getAllLeagueProfiles();
    return rows.map(profileRepo.flattenLeagueProfileRow);
  });

  app.get<{ Params: { id: string } }>('/api/leagues/:id/profile', async (req, reply) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'Invalid league ID' });
    const league = await repo.getLeagueById(id);
    if (!league) return reply.code(404).send({ error: 'League not found' });
    const profile = await profileRepo.getLeagueProfileByLeagueId(id);
    if (!profile) return reply.code(404).send({ error: 'League profile not found' });
    return profileRepo.flattenLeagueProfileRow(profile);
  });

  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/leagues/:id/profile',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (Number.isNaN(id)) return reply.code(400).send({ error: 'Invalid league ID' });
      const league = await repo.getLeagueById(id);
      if (!league) return reply.code(404).send({ error: 'League not found' });

      const payload = normalizeProfilePayload(req.body ?? {});
      if (!payload) {
        return reply.code(400).send({ error: 'Invalid league profile payload' });
      }

      const saved = await profileRepo.upsertLeagueProfile(id, payload.profile, payload.notes_en, payload.notes_vi);
      void invalidateActiveLeaguesCache();
      return profileRepo.flattenLeagueProfileRow(saved);
    },
  );

  app.delete<{ Params: { id: string } }>('/api/leagues/:id/profile', async (req, reply) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'Invalid league ID' });
    const league = await repo.getLeagueById(id);
    if (!league) return reply.code(404).send({ error: 'League not found' });
    const ok = await profileRepo.deleteLeagueProfile(id);
    if (!ok) return reply.code(404).send({ error: 'League profile not found' });
    void invalidateActiveLeaguesCache();
    return { league_id: id, deleted: true };
  });

  app.put<{ Params: { id: string }; Body: { top_league: boolean } }>(
    '/api/leagues/:id/top-league',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (Number.isNaN(id)) return reply.code(400).send({ error: 'Invalid league ID' });
      const ok = await repo.updateLeagueTopLeague(id, req.body.top_league);
      if (!ok) return reply.code(404).send({ error: 'League not found' });
      void invalidateActiveLeaguesCache();
      return { league_id: id, top_league: req.body.top_league };
    },
  );

  app.post<{ Body: { ids: number[]; top_league: boolean } }>(
    '/api/leagues/bulk-top-league',
    async (req) => {
      const count = await repo.bulkSetTopLeague(req.body.ids, req.body.top_league);
      void invalidateActiveLeaguesCache();
      return { updated: count };
    },
  );

  app.put<{ Params: { id: string }; Body: { display_name?: string | null } }>(
    '/api/leagues/:id/display-name',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (Number.isNaN(id)) return reply.code(400).send({ error: 'Invalid league ID' });
      const body = req.body as { display_name?: unknown } | undefined;
      if (body == null || !('display_name' in body)) {
        return reply.code(400).send({ error: 'Body must include display_name (string or null to clear)' });
      }
      const raw = body.display_name;
      const displayName = raw === null || raw === '' ? null : String(raw).trim() || null;
      const ok = await repo.updateLeagueDisplayName(id, displayName);
      if (!ok) return reply.code(404).send({ error: 'League not found' });
      void invalidateActiveLeaguesCache();
      return { league_id: id, display_name: displayName };
    },
  );

  app.post<{ Body: repo.LeagueRow[] }>('/api/leagues/sync', async (req) => {
    const count = await repo.upsertLeagues(req.body);
    return { upserted: count };
  });

  app.post<{
    Body?: {
      mode?: LeagueCatalogRefreshMode;
      leagueIds?: number[];
      force?: boolean;
    };
  }>('/api/leagues/fetch-from-api', async (req, reply) => {
    try {
      const result = await refreshLeagueCatalog({
        mode: readRefreshMode(req.body?.mode),
        leagueIds: req.body?.leagueIds,
        force: req.body?.force ?? true,
      });
      if (result.upserted > 0) void invalidateActiveLeaguesCache();
      if (result.mode === 'full' && result.fetched === 0) {
        return reply.code(502).send({ error: 'No leagues returned from Football API' });
      }
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: `Football API error: ${msg}` });
    }
  });

  app.post<{ Params: { id: string } }>('/api/leagues/:id/refresh', async (req, reply) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'Invalid league ID' });

    try {
      const result = await refreshLeagueCatalog({ mode: 'ids', leagueIds: [id], force: true });
      if (result.upserted > 0) void invalidateActiveLeaguesCache();
      const league = await repo.getLeagueById(id);
      if (!league) return reply.code(404).send({ error: 'League not found' });
      return { ...result, league };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: `Football API error: ${msg}` });
    }
  });
}
