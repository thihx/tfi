// ============================================================
// Reports Routes — /api/reports
// ============================================================

import type { FastifyInstance } from 'fastify';
import { requireAdminOrOwner } from '../lib/authz.js';
import * as repo from '../repos/reports.repo.js';

interface PeriodQuery {
  dateFrom?: string;
  dateTo?: string;
  period?: 'today' | '7d' | '30d' | '90d' | 'this-week' | 'this-month' | 'all';
}

function parseFilter(q: PeriodQuery) {
  return {
    dateFrom: q.dateFrom || undefined,
    dateTo: q.dateTo || undefined,
    period: q.period || undefined,
  } as const;
}

export async function reportRoutes(app: FastifyInstance) {
  // Overview KPIs
  app.get<{ Querystring: PeriodQuery }>('/api/reports/overview', async (req, reply) => {
    const user = requireAdminOrOwner(req, reply);
    if (!user) return;
    return repo.getOverviewReport(parseFilter(req.query));
  });

  // League breakdown
  app.get<{ Querystring: PeriodQuery }>('/api/reports/by-league', async (req, reply) => {
    const user = requireAdminOrOwner(req, reply);
    if (!user) return;
    return repo.getLeagueReport(parseFilter(req.query));
  });

  // Market breakdown
  app.get<{ Querystring: PeriodQuery }>('/api/reports/by-market', async (req, reply) => {
    const user = requireAdminOrOwner(req, reply);
    if (!user) return;
    return repo.getMarketReport(parseFilter(req.query));
  });

  // Weekly time series
  app.get<{ Querystring: PeriodQuery }>('/api/reports/weekly', async (req, reply) => {
    const user = requireAdminOrOwner(req, reply);
    if (!user) return;
    return repo.getWeeklyReport(parseFilter(req.query));
  });

  // Monthly time series
  app.get<{ Querystring: PeriodQuery }>('/api/reports/monthly', async (req, reply) => {
    const user = requireAdminOrOwner(req, reply);
    if (!user) return;
    return repo.getMonthlyReport(parseFilter(req.query));
  });

  // Confidence calibration
  app.get<{ Querystring: PeriodQuery }>('/api/reports/confidence', async (req, reply) => {
    const user = requireAdminOrOwner(req, reply);
    if (!user) return;
    return repo.getConfidenceReport(parseFilter(req.query));
  });

  // Odds range analysis
  app.get<{ Querystring: PeriodQuery }>('/api/reports/odds-range', async (req, reply) => {
    const user = requireAdminOrOwner(req, reply);
    if (!user) return;
    return repo.getOddsRangeReport(parseFilter(req.query));
  });

  // Match minute timing
  app.get<{ Querystring: PeriodQuery }>('/api/reports/by-minute', async (req, reply) => {
    const user = requireAdminOrOwner(req, reply);
    if (!user) return;
    return repo.getMinuteReport(parseFilter(req.query));
  });

  // Daily P/L
  app.get<{ Querystring: PeriodQuery }>('/api/reports/daily-pnl', async (req, reply) => {
    const user = requireAdminOrOwner(req, reply);
    if (!user) return;
    return repo.getDailyPnlReport(parseFilter(req.query));
  });

  // Day of week aggregate
  app.get<{ Querystring: PeriodQuery }>('/api/reports/day-of-week', async (req, reply) => {
    const user = requireAdminOrOwner(req, reply);
    if (!user) return;
    return repo.getDayOfWeekReport(parseFilter(req.query));
  });

  // League × Market cross
  app.get<{ Querystring: PeriodQuery }>('/api/reports/league-market', async (req, reply) => {
    const user = requireAdminOrOwner(req, reply);
    if (!user) return;
    return repo.getLeagueMarketReport(parseFilter(req.query));
  });

  // AI Insights
  app.get<{ Querystring: PeriodQuery }>('/api/reports/ai-insights', async (req, reply) => {
    const user = requireAdminOrOwner(req, reply);
    if (!user) return;
    return repo.getAiInsights(parseFilter(req.query));
  });
}
