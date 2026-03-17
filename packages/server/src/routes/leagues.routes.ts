// ============================================================
// Leagues Routes
// ============================================================

import type { FastifyInstance } from 'fastify';
import * as repo from '../repos/leagues.repo.js';
import { fetchAllLeagues, type ApiLeague } from '../lib/football-api.js';

// ── Tier classification (mirrors Apps Script logic) ──

const INTERNATIONAL_IDS = new Set([
  2, 3, 848, 1, 4, 5, 9, 531, 11, 12, 15, 13, 25, 960,
]);

const TOP_COUNTRIES: Record<string, { tier1: number[]; tier2: number[] }> = {
  'England': { tier1: [39], tier2: [40] },
  'Spain': { tier1: [140], tier2: [141] },
  'Italy': { tier1: [135], tier2: [136] },
  'Germany': { tier1: [78], tier2: [79] },
  'France': { tier1: [61], tier2: [62] },
  'Portugal': { tier1: [94], tier2: [95] },
  'Netherlands': { tier1: [88], tier2: [89] },
  'Belgium': { tier1: [144], tier2: [145] },
  'Turkey': { tier1: [203], tier2: [204] },
  'Scotland': { tier1: [179], tier2: [180] },
  'Denmark': { tier1: [119], tier2: [120] },
  'Switzerland': { tier1: [207], tier2: [208] },
  'Austria': { tier1: [218], tier2: [219] },
  'Greece': { tier1: [197], tier2: [198] },
  'Norway': { tier1: [103], tier2: [104] },
  'Sweden': { tier1: [113], tier2: [114] },
  'Poland': { tier1: [106], tier2: [107] },
  'Czech-Republic': { tier1: [345], tier2: [346] },
  'Croatia': { tier1: [210], tier2: [211] },
  'Serbia': { tier1: [286], tier2: [287] },
  'Romania': { tier1: [283], tier2: [284] },
  'Ukraine': { tier1: [333], tier2: [334] },
  'Russia': { tier1: [235], tier2: [236] },
  'Brazil': { tier1: [71], tier2: [72] },
  'Argentina': { tier1: [128], tier2: [129] },
  'Mexico': { tier1: [262], tier2: [263] },
  'USA': { tier1: [253], tier2: [] },
  'Chile': { tier1: [265], tier2: [] },
  'Colombia': { tier1: [239], tier2: [] },
  'Uruguay': { tier1: [274], tier2: [] },
  'Japan': { tier1: [98], tier2: [99] },
  'South-Korea': { tier1: [292], tier2: [] },
  'Saudi-Arabia': { tier1: [307], tier2: [] },
  'China': { tier1: [17], tier2: [] },
  'Australia': { tier1: [188], tier2: [] },
};

function classifyLeague(item: ApiLeague): { tier: string; autoActive: boolean } {
  const id = item.league.id;
  const country = item.country.name;
  const type = item.league.type;   // 'League' | 'Cup'

  if (INTERNATIONAL_IDS.has(id)) return { tier: 'International', autoActive: true };

  const countryData = TOP_COUNTRIES[country];
  if (countryData) {
    if (countryData.tier1.includes(id)) return { tier: '1', autoActive: true };
    if (countryData.tier2.includes(id)) return { tier: '2', autoActive: false };
    if (type === 'Cup') return { tier: 'Cup', autoActive: false };
  }

  if (type === 'League') return { tier: '3', autoActive: false };
  if (type === 'Cup') return { tier: 'Cup', autoActive: false };
  return { tier: 'Other', autoActive: false };
}

export async function leagueRoutes(app: FastifyInstance) {
  app.get('/api/leagues', async () => {
    return repo.getAllLeagues();
  });

  app.get('/api/leagues/active', async () => {
    return repo.getActiveLeagues();
  });

  app.get<{ Params: { id: string } }>('/api/leagues/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'Invalid league ID' });
    const league = await repo.getLeagueById(id);
    if (!league) return reply.code(404).send({ error: 'League not found' });
    return league;
  });

  app.put<{ Params: { id: string }; Body: { active: boolean } }>(
    '/api/leagues/:id/active',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (Number.isNaN(id)) return reply.code(400).send({ error: 'Invalid league ID' });
      const league = await repo.updateLeagueActive(id, req.body.active);
      if (!league) return reply.code(404).send({ error: 'League not found' });
      return league;
    },
  );

  app.post<{ Body: { ids: number[]; active: boolean } }>(
    '/api/leagues/bulk-active',
    async (req) => {
      const count = await repo.bulkSetActive(req.body.ids, req.body.active);
      return { updated: count };
    },
  );

  // ── Top-league endpoints ──

  app.get('/api/leagues/top', async () => {
    return repo.getTopLeagues();
  });

  app.put<{ Params: { id: string }; Body: { top_league: boolean } }>(
    '/api/leagues/:id/top-league',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (Number.isNaN(id)) return reply.code(400).send({ error: 'Invalid league ID' });
      const ok = await repo.updateLeagueTopLeague(id, req.body.top_league);
      if (!ok) return reply.code(404).send({ error: 'League not found' });
      return { league_id: id, top_league: req.body.top_league };
    },
  );

  app.post<{ Body: { ids: number[]; top_league: boolean } }>(
    '/api/leagues/bulk-top-league',
    async (req) => {
      const count = await repo.bulkSetTopLeague(req.body.ids, req.body.top_league);
      return { updated: count };
    },
  );

  app.post<{ Body: repo.LeagueRow[] }>('/api/leagues/sync', async (req) => {
    const count = await repo.upsertLeagues(req.body);
    return { upserted: count };
  });

  // Fetch all leagues from Football API, classify tiers, upsert into DB
  app.post('/api/leagues/fetch-from-api', async (_req, reply) => {
    try {
      const apiLeagues = await fetchAllLeagues();
      if (apiLeagues.length === 0) {
        return reply.code(502).send({ error: 'No leagues returned from Football API' });
      }

      // Get existing leagues to preserve user's active settings
      const existing = await repo.getAllLeagues();
      const existingMap = new Map(existing.map((l) => [l.league_id, l]));

      const toUpsert: Partial<repo.LeagueRow>[] = apiLeagues.map((item) => {
        const { tier, autoActive } = classifyLeague(item);
        const prev = existingMap.get(item.league.id);
        return {
          league_id: item.league.id,
          league_name: item.league.name,
          country: item.country.name,
          tier,
          // Keep user's active setting if league already exists, else use auto
          active: prev ? prev.active : autoActive,
          // Preserve user's top_league setting
          top_league: prev ? prev.top_league : undefined,
          type: item.league.type,
          logo: item.league.logo,
        };
      });

      const count = await repo.upsertLeagues(toUpsert);
      return { fetched: apiLeagues.length, upserted: count };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: `Football API error: ${msg}` });
    }
  });
}
