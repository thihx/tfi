// ============================================================
// Favorite Teams Routes
// ============================================================

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireCurrentUser } from '../lib/authz.js';
import * as repo from '../repos/favorite-teams.repo.js';
import { getLeagueTeamsDirectory } from '../lib/league-team-directory.service.js';

export async function favoriteTeamsRoutes(app: FastifyInstance) {
  const getCurrentUserFavoriteTeams = async (
    req: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    return repo.getFavoriteTeams(user.userId);
  };

  const addCurrentUserFavoriteTeam = async (
    req: FastifyRequest<{ Body: { team_id: string; team_name: string; team_logo?: string } }>,
    reply: FastifyReply,
  ) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    const { team_id, team_name, team_logo = '' } = req.body;
    if (!team_id || !team_name) return reply.code(400).send({ error: 'team_id and team_name are required' });
    await repo.addFavoriteTeam(user.userId, { team_id: String(team_id), team_name, team_logo });
    return { ok: true };
  };

  const removeCurrentUserFavoriteTeam = async (
    req: FastifyRequest<{ Params: { teamId: string } }>,
    reply: FastifyReply,
  ) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    await repo.removeFavoriteTeam(user.userId, req.params.teamId);
    return { ok: true };
  };

  // GET /api/favorite-teams — compatibility self-service path
  app.get('/api/favorite-teams', getCurrentUserFavoriteTeams);

  // GET /api/me/favorite-teams — design-aligned self-service path
  app.get('/api/me/favorite-teams', getCurrentUserFavoriteTeams);

  // POST /api/favorite-teams  { team_id, team_name, team_logo }
  app.post<{ Body: { team_id: string; team_name: string; team_logo?: string } }>(
    '/api/favorite-teams',
    addCurrentUserFavoriteTeam,
  );

  app.post<{ Body: { team_id: string; team_name: string; team_logo?: string } }>(
    '/api/me/favorite-teams',
    addCurrentUserFavoriteTeam,
  );

  // DELETE /api/favorite-teams/:teamId
  app.delete<{ Params: { teamId: string } }>(
    '/api/favorite-teams/:teamId',
    removeCurrentUserFavoriteTeam,
  );

  app.delete<{ Params: { teamId: string } }>(
    '/api/me/favorite-teams/:teamId',
    removeCurrentUserFavoriteTeam,
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
