// ============================================================
// Audit Logs Routes — /api/audit-logs
// ============================================================

import type { FastifyInstance } from 'fastify';
import { requireAdminOrOwner, requireCurrentUser } from '../lib/authz.js';
import * as repo from '../repos/audit-logs.repo.js';

export async function auditLogRoutes(app: FastifyInstance) {
  // GET /api/audit-logs — list with filters
  app.get<{
    Querystring: {
      category?: string;
      action?: string;
      outcome?: string;
      matchId?: string;
      prematchStrength?: string;
      prematchNoiseMin?: string;
      fromDate?: string;
      toDate?: string;
      limit?: string;
      offset?: string;
    };
  }>('/api/audit-logs', async (req, reply) => {
    const user = requireAdminOrOwner(req, reply);
    if (!user) return;
    return repo.getAuditLogs({
      category: req.query.category,
      action: req.query.action,
      outcome: req.query.outcome,
      matchId: req.query.matchId,
      prematchStrength: req.query.prematchStrength,
      prematchNoiseMin: req.query.prematchNoiseMin ? Number(req.query.prematchNoiseMin) : undefined,
      fromDate: req.query.fromDate,
      toDate: req.query.toDate,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    });
  });

  // GET /api/audit-logs/stats — summary stats
  app.get('/api/audit-logs/stats', async (req, reply) => {
    const user = requireAdminOrOwner(req, reply);
    if (!user) return;
    return repo.getAuditLogStats();
  });

  // POST /api/audit-logs — write a log entry (for frontend-side events)
  app.post<{ Body: repo.AuditLogInput }>('/api/audit-logs', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    await repo.insertAuditLog(req.body);
    return reply.code(201).send({ ok: true });
  });

  // DELETE /api/audit-logs/purge — remove old logs
  app.delete<{ Querystring: { keepDays?: string } }>(
    '/api/audit-logs/purge',
    async (req, reply) => {
      const user = requireAdminOrOwner(req, reply);
      if (!user) return;
      const keepDays = Number(req.query.keepDays) || 30;
      const deleted = await repo.purgeAuditLogs(keepDays);
      return { deleted };
    },
  );
}
