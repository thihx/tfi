// ============================================================
// Recommendations Routes
// ============================================================

import type { FastifyInstance } from 'fastify';
import * as repo from '../repos/recommendations.repo.js';
import * as aiPerfRepo from '../repos/ai-performance.repo.js';
import { reEvaluateAllResults } from '../jobs/re-evaluate.job.js';
import { audit } from '../lib/audit.js';

export async function recommendationRoutes(app: FastifyInstance) {
  app.get<{ Querystring: {
    limit?: string; offset?: string;
    result?: string; bet_type?: string; search?: string;
    league?: string; date_from?: string; date_to?: string; risk_level?: string;
    sort_by?: string; sort_dir?: string;
  } }>(
    '/api/recommendations',
    async (req) => {
      const limit = Number(req.query.limit) || 50;
      const offset = Number(req.query.offset) || 0;
      return repo.getAllRecommendations({
        limit,
        offset,
        result: req.query.result || undefined,
        bet_type: req.query.bet_type || undefined,
        search: req.query.search || undefined,
        league: req.query.league || undefined,
        date_from: req.query.date_from || undefined,
        date_to: req.query.date_to || undefined,
        risk_level: req.query.risk_level || undefined,
        sort_by: req.query.sort_by || undefined,
        sort_dir: req.query.sort_dir || undefined,
      });
    },
  );

  app.get('/api/recommendations/dashboard', async () => {
    return repo.getDashboardSummary();
  });

  app.get('/api/recommendations/bet-types', async () => {
    return repo.getDistinctBetTypes();
  });

  app.get('/api/recommendations/leagues', async () => {
    return repo.getDistinctLeagues();
  });

  app.get<{ Params: { matchId: string } }>(
    '/api/recommendations/match/:matchId',
    async (req) => {
      return repo.getRecommendationsByMatchId(req.params.matchId);
    },
  );

  app.get('/api/recommendations/stats', async () => {
    return repo.getStats();
  });

  app.post<{ Body: Partial<repo.RecommendationCreate> }>(
    '/api/recommendations',
    async (req, reply) => {
      if (!req.body.match_id) return reply.code(400).send({ error: 'match_id is required' });

      let rec: repo.RecommendationRow;
      try {
        rec = await repo.createRecommendation(req.body);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        req.log.error({ err, matchId: req.body.match_id, selection: req.body.selection }, 'Failed to save recommendation');
        return reply.code(500).send({ error: `Failed to save recommendation: ${errMsg}` });
      }

      // Auto-create AI performance tracking record (F4 audit fix: pass real ai_should_push)
      if (rec.ai_model) {
        try {
          await aiPerfRepo.createAiPerformanceRecord({
            recommendation_id: rec.id,
            match_id: rec.match_id,
            ai_model: rec.ai_model,
            prompt_version: rec.prompt_version ?? '',
            ai_confidence: rec.confidence,
            ai_should_push: rec.bet_type === 'AI',
            predicted_market: rec.bet_market ?? '',
            predicted_selection: rec.selection,
            predicted_odds: rec.odds ? Number(rec.odds) : null,
            match_minute: rec.minute,
            match_score: rec.score ?? '',
            league: rec.league ?? '',
          });
        } catch { /* non-critical — duplicate key or other */ }
      }

      return reply.code(201).send(rec);
    },
  );

  // Hook: audit every recommendation save
  app.addHook('onResponse', (request, reply, done) => {
    if (request.method === 'POST' && request.url === '/api/recommendations' && reply.statusCode === 201) {
      const body = request.body as Record<string, unknown> | undefined;
      audit({
        category: 'PIPELINE',
        action: 'RECOMMENDATION_SAVED',
        actor: 'pipeline',
        match_id: body?.match_id as string | undefined,
        metadata: { selection: body?.selection, bet_market: body?.bet_market, confidence: body?.confidence },
      });
    }
    done();
  });

  app.post<{ Body: Partial<repo.RecommendationCreate>[] }>(
    '/api/recommendations/bulk',
    async (req) => {
      const count = await repo.bulkCreateRecommendations(req.body);
      return { inserted: count };
    },
  );

  app.put<{
    Params: { id: string };
    Body: { result: string; pnl: number; actual_outcome?: string };
  }>('/api/recommendations/:id/settle', async (req, reply) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'Invalid recommendation ID' });
    const rec = await repo.settleRecommendation(
      id,
      req.body.result,
      req.body.pnl,
      req.body.actual_outcome,
    );
    if (!rec) return reply.code(404).send({ error: 'Recommendation not found' });
    return rec;
  });

  // Mark legacy duplicates
  app.post('/api/recommendations/mark-duplicates', async () => {
    return repo.markLegacyDuplicates();
  });

  // Re-evaluate all results using real Football API scores
  app.post('/api/recommendations/re-evaluate', async () => {
    return reEvaluateAllResults();
  });
}
