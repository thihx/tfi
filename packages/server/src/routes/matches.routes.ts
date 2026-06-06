// ============================================================
// Matches Routes
// ============================================================

import type { FastifyInstance } from 'fastify';
import { lookupLiveStreamLinks, parseLiveStreamProviderUrls } from '../lib/live-stream-locator.js';
import { loadLiveStreamLocatorSettings } from '../lib/live-stream-settings.js';
import * as repo from '../repos/matches.repo.js';

export async function matchRoutes(app: FastifyInstance) {
  app.get('/api/matches', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return repo.getActiveLeagueMatches();
  });

  app.get<{ Querystring: { statuses?: string } }>('/api/matches/by-status', async (req) => {
    const statuses = req.query.statuses?.split(',').filter(Boolean) ?? [];
    return repo.getMatchesByStatus(statuses);
  });

  app.post<{ Body: { ids: string[] } }>('/api/matches/by-ids', async (req) => {
    return repo.getMatchesByIds(req.body.ids);
  });

  app.post<{ Body: { matchIds?: string[] } }>('/api/matches/live-streams/lookup', async (req, reply) => {
    const rawIds = Array.isArray(req.body?.matchIds) ? req.body.matchIds : [];
    const matchIds = Array.from(new Set(rawIds.map((id) => String(id).trim()).filter(Boolean)));
    if (matchIds.length === 0) return { results: [] };
    const settings = await loadLiveStreamLocatorSettings();
    if (matchIds.length > settings.maxMatches) {
      return reply.status(400).send({
        error: `Too many matches requested. Max ${settings.maxMatches}.`,
      });
    }

    const matches = await repo.getMatchesByIds(matchIds);
    const providers = parseLiveStreamProviderUrls(settings.providerUrls);
    const results = await lookupLiveStreamLinks(matches, {
      enabled: settings.enabled,
      providers,
      timeoutMs: settings.timeoutMs,
      cacheTtlMs: settings.cacheTtlMs,
      cacheKeySalt: [
        settings.enabled ? 'enabled' : 'disabled',
        settings.timeoutMs,
        settings.cacheTtlMs,
        ...settings.providerUrls,
      ].join('|'),
    });
    return { results };
  });

  /** Full refresh — replaces all matches (used by match fetcher) */
  app.post<{ Body: repo.MatchRow[] }>('/api/matches/refresh', async (req) => {
    const count = await repo.replaceAllMatches(req.body);
    return { replaced: count };
  });

  /** Partial update — live score updates */
  app.patch<{ Body: Partial<repo.MatchRow>[] }>('/api/matches', async (req) => {
    const count = await repo.updateMatches(req.body);
    return { updated: count };
  });

  app.delete<{ Body: { ids: string[] } }>('/api/matches', async (req) => {
    const count = await repo.deleteMatchesByIds(req.body.ids);
    return { deleted: count };
  });
}
