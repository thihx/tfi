// ============================================================
// AI Performance Routes
// ============================================================

import type { FastifyInstance } from 'fastify';
import * as repo from '../repos/ai-performance.repo.js';

export async function aiPerformanceRoutes(app: FastifyInstance) {
  app.get('/api/ai-performance/stats', async () => {
    return repo.getAccuracyStats();
  });

  app.get('/api/ai-performance/stats/by-model', async () => {
    return repo.getAccuracyByModel();
  });

  app.post<{
    Body: {
      recommendation_id: number;
      bet_id?: number | null;
      match_id: string;
      ai_model?: string;
      prompt_version?: string;
      ai_confidence?: number | null;
      ai_should_push?: boolean;
      predicted_market?: string;
      predicted_selection?: string;
      predicted_odds?: number | null;
      match_minute?: number | null;
      match_score?: string;
      league?: string;
    };
  }>('/api/ai-performance', async (req, reply) => {
    if (!req.body.recommendation_id) return reply.code(400).send({ error: 'recommendation_id is required' });
    if (!req.body.match_id) return reply.code(400).send({ error: 'match_id is required' });
    const rec = await repo.createAiPerformanceRecord(req.body);
    return reply.code(201).send(rec);
  });
}
