// ============================================================
// Matches Routes
// ============================================================

import type { FastifyInstance } from 'fastify';
import { markPublicLiveBoardActive } from '../lib/live-board-activity.js';
import { lookupLiveStreamLinks, parseLiveStreamSourcesAsProviders } from '../lib/live-stream-locator.js';
import { filterLiveStreamSourcesForRegion, resolveViewerRegion } from '../lib/live-stream-region.js';
import { loadLiveStreamLocatorSettings } from '../lib/live-stream-settings.js';
import * as repo from '../repos/matches.repo.js';

export async function matchRoutes(app: FastifyInstance) {
  app.get('/api/matches', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return repo.getActiveLeagueMatches();
  });

  app.post('/api/matches/live-board/active', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    try {
      await markPublicLiveBoardActive();
    } catch (err) {
      req.log.warn({ err }, 'Failed to mark Matches live board activity');
    }
    return { active: true };
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
    const viewerRegion = resolveViewerRegion(req);
    const eligibleSources = filterLiveStreamSourcesForRegion(settings.sources, viewerRegion, settings.regionFiltering);
    const providers = parseLiveStreamSourcesAsProviders(eligibleSources);
    req.log.info({
      event: 'live_stream_lookup_region',
      viewer_country: viewerRegion.country,
      region_source: viewerRegion.source,
      eligible_source_count: eligibleSources.length,
      lookup_source_count: providers.length,
      unknown_policy: settings.regionFiltering.unknownPolicy,
    }, 'Live stream lookup region filter applied');
    const results = await lookupLiveStreamLinks(matches, {
      enabled: settings.enabled,
      providers,
      timeoutMs: settings.timeoutMs,
      cacheTtlMs: settings.cacheTtlMs,
      cacheKeySalt: [
        settings.enabled ? 'enabled' : 'disabled',
        settings.regionFiltering.enabled ? 'region:on' : 'region:off',
        viewerRegion.country ?? 'unknown',
        settings.regionFiltering.unknownPolicy,
        settings.timeoutMs,
        settings.cacheTtlMs,
        ...eligibleSources.map((source) => `${source.id}:${source.url}:${source.countries.join('+')}:${source.priority}:${source.active}`),
      ].join('|'),
    });
    return { viewerRegion, results };
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
