// ============================================================
// Favorite Teams Routes
// ============================================================

import type { FastifyInstance } from 'fastify';
import * as repo from '../repos/favorite-teams.repo.js';
import { getLeagueTeamsDirectory } from '../lib/league-team-directory.service.js';

export async function favoriteTeamsRoutes(app: FastifyInstance) {
  // GET /api/favorite-teams
  app.get('/api/favorite-teams', async () => {
    return repo.getFavoriteTeams();
  });

  // POST /api/favorite-teams  { team_id, team_name, team_logo }
  app.post<{ Body: { team_id: string; team_name: string; team_logo?: string } }>(
    '/api/favorite-teams',
    async (req, reply) => {
      const { team_id, team_name, team_logo = '' } = req.body;
      if (!team_id || !team_name) return reply.code(400).send({ error: 'team_id and team_name are required' });
      await repo.addFavoriteTeam({ team_id: String(team_id), team_name, team_logo });
      return { ok: true };
    },
  );

  // DELETE /api/favorite-teams/:teamId
  app.delete<{ Params: { teamId: string } }>(
    '/api/favorite-teams/:teamId',
    async (req) => {
      await repo.removeFavoriteTeam(req.params.teamId);
      return { ok: true };
    },
  );

  // GET /api/proxy/football/league-teams?leagueId=39
  app.get<{ Querystring: { leagueId?: string } }>(
    '/api/proxy/football/league-teams',
    async (req, reply) => {
      const leagueId = Number(req.query.leagueId);
      if (!leagueId) return reply.code(400).send({ error: 'leagueId is required' });
      try {
        return await getLeagueTeamsDirectory(leagueId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.code(502).send({ error: `Failed to load league teams: ${message}` });
      }
    },
  );
}
