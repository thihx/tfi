// ============================================================
// Watchlist Routes
// ============================================================

import type { FastifyInstance } from 'fastify';
import { requireAdminOrOwner, requireCurrentUser } from '../lib/authz.js';
import {
  EntitlementError,
  assertWatchlistCapacityAvailable,
  assertWatchlistCapacityForAdditional,
  resolveSubscriptionAccess,
  sendEntitlementError,
} from '../lib/subscription-access.js';
import { config } from '../config.js';
import { isValidTimeZone } from '../lib/user-personalization-settings.js';
import * as leaguesRepo from '../repos/leagues.repo.js';
import * as matchesRepo from '../repos/matches.repo.js';
import * as repo from '../repos/watchlist.repo.js';
import { getSettings, saveSettings } from '../repos/settings.repo.js';
import { buildAutoWatchlistEntry } from '../jobs/watchlist-side-effects.shared.js';

const FAVORITE_LEAGUE_IDS_KEY = 'FAVORITE_LEAGUE_IDS';
const LEGACY_SUGGESTED_TOP_LEAGUE_IDS_KEY = 'SUGGESTED_TOP_LEAGUE_IDS';

function parsePositiveIntegerArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const ids = value
    .map((entry) => (typeof entry === 'number' ? entry : Number(entry)))
    .filter((entry) => Number.isInteger(entry) && entry > 0) as number[];
  return Array.from(new Set(ids));
}

function getFavoriteLeagueIdsFromSettings(settings: Record<string, unknown>): number[] {
  const nextValue = settings[FAVORITE_LEAGUE_IDS_KEY];
  if (nextValue !== undefined) {
    return parsePositiveIntegerArray(nextValue);
  }
  return parsePositiveIntegerArray(settings[LEGACY_SUGGESTED_TOP_LEAGUE_IDS_KEY]);
}

function getFavoriteLeagueEnabled(entitlements: Record<string, unknown>): boolean {
  return entitlements['watchlist.suggested_top_leagues.enabled'] !== false;
}

function getFavoriteLeagueLimit(entitlements: Record<string, unknown>): number | null {
  const raw = entitlements['watchlist.suggested_top_leagues.limit'];
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

function toLocalDateString(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export async function watchlistRoutes(app: FastifyInstance) {
  app.get('/api/me/watch-subscriptions', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    return repo.getAllWatchlist(user.userId);
  });

  app.get<{ Params: { id: string } }>('/api/me/watch-subscriptions/:id', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    const subscriptionId = Number(req.params.id);
    if (!Number.isInteger(subscriptionId) || subscriptionId <= 0) {
      return reply.code(400).send({ error: 'Invalid watch subscription ID' });
    }
    const entry = await repo.getWatchSubscriptionById(subscriptionId, user.userId);
    if (!entry) return reply.code(404).send({ error: 'Watch subscription not found' });
    return entry;
  });

  app.post<{ Body: Partial<repo.WatchlistCreate> }>('/api/me/watch-subscriptions', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    if (!req.body.match_id) return reply.code(400).send({ error: 'match_id is required' });
    if (user.role !== 'admin' && user.role !== 'owner') {
      try {
        const access = await resolveSubscriptionAccess(user.userId);
        await assertWatchlistCapacityAvailable(access, user.userId);
      } catch (error) {
        const entitlement = sendEntitlementError(error);
        if (entitlement) {
          return reply.code(entitlement.statusCode).send(entitlement.payload);
        }
        throw error;
      }
    }
    let body = req.body;
    if (body.auto_apply_recommended_condition == null) {
      const settings = await getSettings(user.userId, { fallbackToDefault: false }).catch(() => ({}));
      const autoApplyRecommendedCondition =
        (settings as Record<string, unknown>).AUTO_APPLY_RECOMMENDED_CONDITION !== false;
      body = {
        ...body,
        auto_apply_recommended_condition: autoApplyRecommendedCondition,
      };
    }
    const entry = await repo.createWatchlistEntry(body, user.userId);
    return reply.code(201).send(entry);
  });

  app.get('/api/me/watch-subscriptions/favorite-leagues', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;

    const [settings, systemFavoriteLeagues] = await Promise.all([
      getSettings(user.userId, { fallbackToDefault: false }),
      leaguesRepo.getTopLeagues(),
    ]);
    const systemFavoriteLeagueIds = new Set(systemFavoriteLeagues.map((league) => league.league_id));
    const selectedLeagueIds = getFavoriteLeagueIdsFromSettings(settings)
      .filter((leagueId) => systemFavoriteLeagueIds.has(leagueId));

    if (user.role === 'admin' || user.role === 'owner') {
      return {
        availableLeagues: systemFavoriteLeagues,
        selectedLeagueIds,
        favoriteLeaguesEnabled: true,
        favoriteLeagueLimit: null,
        watchlistActiveLimit: null,
        watchlistActiveCount: await repo.countActiveWatchSubscriptionsByUser(user.userId),
      };
    }

    const access = await resolveSubscriptionAccess(user.userId);
    const favoriteLeagueLimit = getFavoriteLeagueLimit(access.entitlements);
    return {
      availableLeagues: systemFavoriteLeagues,
      selectedLeagueIds,
      favoriteLeaguesEnabled: getFavoriteLeagueEnabled(access.entitlements) && favoriteLeagueLimit !== 0,
      favoriteLeagueLimit,
      watchlistActiveLimit: access.entitlements['watchlist.active_matches.limit'],
      watchlistActiveCount: await repo.countActiveWatchSubscriptionsByUser(user.userId),
    };
  });

  app.put<{ Body: { leagueIds?: unknown } }>('/api/me/watch-subscriptions/favorite-leagues', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;

    const requestedLeagueIds = parsePositiveIntegerArray(req.body?.leagueIds);
    const [settings, systemFavoriteLeagues] = await Promise.all([
      getSettings(user.userId, { fallbackToDefault: false }),
      leaguesRepo.getTopLeagues(),
    ]);
    const systemFavoriteLeagueIds = new Set(systemFavoriteLeagues.map((league) => league.league_id));
    const invalidLeagueIds = requestedLeagueIds.filter((leagueId) => !systemFavoriteLeagueIds.has(leagueId));
    if (invalidLeagueIds.length > 0) {
      return reply.code(400).send({ error: 'One or more selected leagues are not eligible favorite leagues.' });
    }

    let watchlistActiveLimit: number | null = null;
    let favoriteLeagueLimit: number | null = null;
    if (user.role !== 'admin' && user.role !== 'owner') {
      try {
        const access = await resolveSubscriptionAccess(user.userId);
        if (!getFavoriteLeagueEnabled(access.entitlements)) {
          throw new EntitlementError('Favorite leagues are not included in your current plan.', {
            code: 'FAVORITE_LEAGUES_DISABLED',
            details: { entitlementKey: 'watchlist.suggested_top_leagues.enabled' },
          });
        }
        favoriteLeagueLimit = getFavoriteLeagueLimit(access.entitlements);
        if (favoriteLeagueLimit != null && requestedLeagueIds.length > favoriteLeagueLimit) {
          throw new EntitlementError(`Your current plan allows up to ${favoriteLeagueLimit} favorite leagues.`, {
            code: 'FAVORITE_LEAGUES_LIMIT_REACHED',
            details: {
              entitlementKey: 'watchlist.suggested_top_leagues.limit',
              limit: favoriteLeagueLimit,
              used: requestedLeagueIds.length,
            },
          });
        }
        watchlistActiveLimit = typeof access.entitlements['watchlist.active_matches.limit'] === 'number'
          ? access.entitlements['watchlist.active_matches.limit'] as number
          : Number(access.entitlements['watchlist.active_matches.limit'] ?? 0);
      } catch (error) {
        const entitlement = sendEntitlementError(error);
        if (entitlement) {
          return reply.code(entitlement.statusCode).send(entitlement.payload);
        }
        throw error;
      }
    }

    const mergedSettings: Record<string, unknown> = {
      ...settings,
      [FAVORITE_LEAGUE_IDS_KEY]: requestedLeagueIds,
    };
    await saveSettings(mergedSettings, user.userId);

    const userTimeZone = isValidTimeZone(mergedSettings.USER_TIMEZONE) ? mergedSettings.USER_TIMEZONE : config.timezone;
    const localDate = toLocalDateString(new Date(), userTimeZone);
    const todayMatches = await matchesRepo.getMatchesForLeaguesOnLocalDate(requestedLeagueIds, localDate, userTimeZone);
    const existingMatchIds = await repo.getExistingUserWatchlistMatchIds(
      user.userId,
      todayMatches.map((match) => match.match_id),
    );
    const newMatches = todayMatches.filter((match) => !existingMatchIds.has(match.match_id));
    const currentWatchlistCount = await repo.countActiveWatchSubscriptionsByUser(user.userId);

    if (user.role !== 'admin' && user.role !== 'owner' && newMatches.length > 0) {
      try {
        const access = await resolveSubscriptionAccess(user.userId);
        await assertWatchlistCapacityForAdditional(access, user.userId, newMatches.length);
      } catch (error) {
        const entitlement = sendEntitlementError(error);
        if (entitlement) {
          return {
            error: typeof entitlement.payload?.error === 'string'
              ? entitlement.payload.error
              : 'Would exceed your watchlist limit. No matches were added.',
            limitExceeded: true,
            savedLeagueIds: requestedLeagueIds,
            candidateMatches: todayMatches.length,
            alreadyWatched: existingMatchIds.size,
            newMatches: newMatches.length,
            added: 0,
            localDate,
            userTimeZone,
            currentWatchlistCount,
            watchlistActiveLimit,
            favoriteLeagueLimit,
          };
        }
        throw error;
      }
    }

    const autoApplyRecommendedCondition = mergedSettings.AUTO_APPLY_RECOMMENDED_CONDITION !== false;
    const watchlistEntries = newMatches.map((match) => buildAutoWatchlistEntry(
      match,
      autoApplyRecommendedCondition,
      'favorite-league-auto',
    ));
    const addedRows = await repo.createWatchlistEntriesBatch(watchlistEntries, user.userId);

    return {
      error: null,
      limitExceeded: false,
      savedLeagueIds: requestedLeagueIds,
      candidateMatches: todayMatches.length,
      alreadyWatched: existingMatchIds.size,
      newMatches: newMatches.length,
      added: addedRows.length,
      localDate,
      userTimeZone,
      currentWatchlistCount,
      watchlistActiveLimit,
      favoriteLeagueLimit,
    };
  });

  app.put<{ Params: { id: string }; Body: Partial<repo.WatchlistRow> }>(
    '/api/me/watch-subscriptions/:id',
    async (req, reply) => {
      const user = requireCurrentUser(req, reply);
      if (!user) return;
      const subscriptionId = Number(req.params.id);
      if (!Number.isInteger(subscriptionId) || subscriptionId <= 0) {
        return reply.code(400).send({ error: 'Invalid watch subscription ID' });
      }
      const entry = await repo.updateWatchSubscriptionById(subscriptionId, req.body, user.userId);
      if (!entry) return reply.code(404).send({ error: 'Watch subscription not found' });
      return entry;
    },
  );

  app.patch<{ Params: { id: string }; Body: Partial<repo.WatchlistRow> }>(
    '/api/me/watch-subscriptions/:id',
    async (req, reply) => {
      const user = requireCurrentUser(req, reply);
      if (!user) return;
      const subscriptionId = Number(req.params.id);
      if (!Number.isInteger(subscriptionId) || subscriptionId <= 0) {
        return reply.code(400).send({ error: 'Invalid watch subscription ID' });
      }
      const entry = await repo.updateWatchSubscriptionById(subscriptionId, req.body, user.userId);
      if (!entry) return reply.code(404).send({ error: 'Watch subscription not found' });
      return entry;
    },
  );

  app.delete<{ Params: { id: string } }>('/api/me/watch-subscriptions/:id', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    const subscriptionId = Number(req.params.id);
    if (!Number.isInteger(subscriptionId) || subscriptionId <= 0) {
      return reply.code(400).send({ error: 'Invalid watch subscription ID' });
    }
    const ok = await repo.deleteWatchSubscriptionById(subscriptionId, user.userId);
    return { deleted: ok };
  });

  /** Delete by match_id — idempotent fallback when subscription ID is not known */
  app.delete<{ Params: { matchId: string } }>('/api/me/watch-subscriptions/by-match/:matchId', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    const ok = await repo.deleteWatchlistEntry(req.params.matchId, user.userId);
    return { deleted: ok };
  });

  /** Increment check counter (used by pipeline) */
  app.post<{ Params: { matchId: string } }>(
    '/api/watchlist/:matchId/check',
    async (req, reply) => {
      const user = requireAdminOrOwner(req, reply);
      if (!user) return;
      await repo.incrementChecks(req.params.matchId);
      return { ok: true };
    },
  );

  /** Expire old entries */
  app.post<{ Body: { cutoffMinutes?: number } }>('/api/watchlist/expire', async (req, reply) => {
    const user = requireAdminOrOwner(req, reply);
    if (!user) return;
    const count = await repo.expireOldEntries(req.body.cutoffMinutes);
    return { expired: count };
  });
}
