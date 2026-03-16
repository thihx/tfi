// ============================================================
// Match Snapshots Routes
// ============================================================

import type { FastifyInstance } from 'fastify';
import * as repo from '../repos/match-snapshots.repo.js';

export async function snapshotRoutes(app: FastifyInstance) {
  app.get<{ Params: { matchId: string } }>(
    '/api/snapshots/match/:matchId',
    async (req) => {
      return repo.getSnapshotsByMatch(req.params.matchId);
    },
  );

  app.get<{ Params: { matchId: string } }>(
    '/api/snapshots/match/:matchId/latest',
    async (req) => {
      const snap = await repo.getLatestSnapshot(req.params.matchId);
      if (!snap) return { snapshot: null };
      return snap;
    },
  );

  app.post<{
    Body: {
      match_id: string;
      minute: number;
      status?: string;
      home_score?: number;
      away_score?: number;
      stats?: Record<string, unknown>;
      events?: unknown[];
      odds?: Record<string, unknown>;
      source?: string;
    };
  }>('/api/snapshots', async (req, reply) => {
    if (!req.body.match_id) return reply.code(400).send({ error: 'match_id is required' });
    if (req.body.minute == null) return reply.code(400).send({ error: 'minute is required' });
    const snap = await repo.createSnapshot(req.body);
    return reply.code(201).send(snap);
  });
}
