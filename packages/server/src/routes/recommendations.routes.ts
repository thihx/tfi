// ============================================================
// Recommendations Routes
// ============================================================

import type { FastifyInstance } from 'fastify';
import * as repo from '../repos/recommendations.repo.js';
import * as aiPerfRepo from '../repos/ai-performance.repo.js';
import { reEvaluateAllResults } from '../jobs/re-evaluate.job.js';
import { audit } from '../lib/audit.js';
import { isFinalSettlementResult, settlementWasCorrect } from '../lib/settle-types.js';
import { requireAnyRole } from '../lib/authz.js';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parsePositiveNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function getRecommendationValidationError(rec: Partial<repo.RecommendationCreate>): string | null {
  const selection = normalizeText(rec.selection);
  if (!selection || /^(none|no\s*bet|-)$/i.test(selection)) {
    return 'selection is empty or non-actionable';
  }

  const betMarket = normalizeText(rec.bet_market);
  if (!betMarket) {
    return 'bet_market is required for actionable recommendations';
  }

  const betType = normalizeText(rec.bet_type);
  if (/^(none|no_bet)$/i.test(betType)) {
    return 'bet_type cannot be none/NO_BET for actionable recommendations';
  }

  if (parsePositiveNumber(rec.odds) == null || Number(rec.odds) <= 1) {
    return 'odds must be a valid price above 1.00';
  }

  if (parsePositiveNumber(rec.confidence) == null) {
    return 'confidence must be greater than 0';
  }

  if (parsePositiveNumber(rec.stake_percent) == null) {
    return 'stake_percent must be greater than 0';
  }

  return null;
}

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
      const validationError = getRecommendationValidationError(req.body);
      if (validationError) return reply.code(400).send({ error: `Recommendation is not actionable: ${validationError}` });

      const normalizedBody: Partial<repo.RecommendationCreate> = {
        ...req.body,
        bet_type: normalizeText(req.body.bet_type) || 'AI',
      };

      let rec: repo.RecommendationRow;
      try {
        rec = await repo.createRecommendation(normalizedBody);
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
      const actionable = req.body
        .filter((rec) => !getRecommendationValidationError(rec))
        .map((rec) => ({
          ...rec,
          bet_type: normalizeText(rec.bet_type) || 'AI',
        }));
      const count = actionable.length > 0 ? await repo.bulkCreateRecommendations(actionable) : 0;
      return { inserted: count, skipped: req.body.length - actionable.length };
    },
  );

  app.put<{
    Params: { id: string };
    Body: { result: string; pnl: number; actual_outcome?: string };
  }>('/api/recommendations/:id/settle', async (req, reply) => {
    if (!requireAnyRole(req, reply, ['admin'])) return;
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'Invalid recommendation ID' });
    const rec = await repo.settleRecommendation(
      id,
      req.body.result,
      req.body.pnl,
      req.body.actual_outcome,
      {
        status: 'resolved',
        method: 'manual',
        note: req.body.actual_outcome ?? '',
      },
    );
    if (!rec) return reply.code(404).send({ error: 'Recommendation not found' });
    const wasCorrect = isFinalSettlementResult(req.body.result)
      ? settlementWasCorrect(req.body.result)
      : null;
    await aiPerfRepo.settleAiPerformance(
      id,
      req.body.result,
      req.body.pnl,
      wasCorrect,
      {
        status: 'resolved',
        method: 'manual',
        trusted: true,
        note: req.body.actual_outcome ?? '',
      },
    ).catch(() => null);
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
