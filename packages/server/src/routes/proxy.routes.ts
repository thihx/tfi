// ============================================================
// Proxy Routes - Football API, AI, Notifications
// Replaces Google Apps Script proxy layer
// ============================================================

import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { audit } from '../lib/audit.js';
import { requireCurrentUser } from '../lib/authz.js';
import { callGemini } from '../lib/gemini.js';
import { resolveMatchOdds } from '../lib/odds-resolver.js';
import { ensureFixturesForMatchIds, ensureScoutInsight } from '../lib/provider-insight-cache.js';
import { fetchLeagueFixturesFromReferenceProvider } from '../lib/reference-data-provider.js';
import { consumeManualAiQuota, resolveSubscriptionAccess, sendEntitlementError } from '../lib/subscription-access.js';
import { sendTelegramMessage, sendTelegramPhoto } from '../lib/telegram.js';
import { runPromptOnlyAnalysisForMatch, type MatchPipelineResult } from '../lib/server-pipeline.js';

function buildQuickChartUrl(chartConfig: Record<string, unknown>): string {
  return `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}&w=500&h=240&bkg=white`;
}

function toPromptOnlyAuditMetadata(
  matchId: string,
  provider: string,
  model: string,
  result: Awaited<ReturnType<typeof runPromptOnlyAnalysisForMatch>>['result'],
) {
  const debug: NonNullable<MatchPipelineResult['debug']> | null = result.debug ?? null;
  return {
    provider,
    model,
    matchId,
    success: result.success,
    shouldPush: result.shouldPush,
    saved: result.saved,
    notified: result.notified,
    decisionKind: result.decisionKind,
    selection: result.selection,
    confidence: result.confidence,
    error: result.error ?? null,
    analysisMode: debug?.analysisMode ?? null,
    evidenceMode: debug?.evidenceMode ?? null,
    promptVersion: debug?.promptVersion ?? null,
    promptDataLevel: debug?.promptDataLevel ?? null,
    prematchAvailability: debug?.prematchAvailability ?? null,
    prematchStrength: debug?.prematchStrength ?? null,
    prematchNoisePenalty: debug?.prematchNoisePenalty ?? null,
    structuredPrematchAskAi: debug?.structuredPrematchAskAi === true,
    structuredPrematchAskAiReason: debug?.structuredPrematchAskAiReason ?? null,
    skipReason: debug?.skipReason ?? null,
    llmLatencyMs: debug?.llmLatencyMs ?? null,
    totalLatencyMs: debug?.totalLatencyMs ?? null,
  };
}

// ==================== Routes ====================

export async function proxyRoutes(app: FastifyInstance) {

  // POST /api/proxy/football/live-fixtures
  app.post<{ Body: { matchIds: string[] } }>('/api/proxy/football/live-fixtures', async (req, reply) => {
    try {
      const fixtures = await ensureFixturesForMatchIds(req.body.matchIds, { freshnessMode: 'real_required' });
      return fixtures;
    } catch (err) {
      app.log.error(err, 'proxy/football/live-fixtures failed');
      return reply.code(502).send({ error: err instanceof Error ? err.message : 'Football API error' });
    }
  });

  // POST /api/proxy/football/odds
  // Cache-first semantic odds source: live -> fallback-live -> reference-prematch -> none
  app.post<{
    Body: {
      matchId: string;
      homeTeam?: string;
      awayTeam?: string;
      kickoffTimestamp?: number;
      leagueName?: string;
      leagueCountry?: string;
      status?: string;
      matchMinute?: number;
    };
  }>('/api/proxy/football/odds', async (req, reply) => {
    try {
      const liveStatus = String(req.body.status ?? '').toUpperCase();
      const freshnessMode = ['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'INT'].includes(liveStatus)
        ? 'real_required'
        : 'stale_safe';
      const resolved = await resolveMatchOdds({
        matchId: req.body.matchId,
        homeTeam: req.body.homeTeam,
        awayTeam: req.body.awayTeam,
        kickoffTimestamp: req.body.kickoffTimestamp,
        leagueName: req.body.leagueName,
        leagueCountry: req.body.leagueCountry,
        status: req.body.status,
        matchMinute: req.body.matchMinute,
        consumer: 'proxy-route',
        freshnessMode,
      });

      return {
        odds_source: resolved.oddsSource,
        odds_freshness: resolved.freshness,
        cache_status: resolved.cacheStatus,
        response: resolved.response,
      };
    } catch (err) {
      app.log.error(err, 'proxy/football/odds failed');
      return reply.code(502).send({ error: err instanceof Error ? err.message : 'Football API error' });
    }
  });

  // POST /api/proxy/football/scout - aggregated match scout data
  app.post<{
    Body: { fixtureId: string; leagueId?: number; season?: number; status?: string };
  }>('/api/proxy/football/scout', async (req, reply) => {
    const { fixtureId, leagueId, season, status } = req.body;
    const LIVE = ['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'INT'];
    const FINISHED = ['FT', 'AET', 'PEN'];
    const hasStarted = status ? (LIVE.includes(status) || FINISHED.includes(status)) : false;

    try {
      const freshnessMode = hasStarted ? 'real_required' : 'stale_safe';
      const fixtures = await ensureFixturesForMatchIds([fixtureId], { freshnessMode });
      const fixture = fixtures[0] ?? null;

      const seasonValue = season ?? (new Date().getMonth() < 6 ? new Date().getFullYear() - 1 : new Date().getFullYear());
      const scout = await ensureScoutInsight(fixtureId, {
        fixture,
        leagueId,
        season: seasonValue,
        status,
        consumer: hasStarted ? 'proxy-scout-live' : 'proxy-scout-prematch',
        sampleProviderData: false,
        freshnessMode,
      });

      return {
        fixture,
        prediction: scout.prediction.payload,
        events: scout.events.payload,
        statistics: scout.statistics.payload,
        lineups: scout.lineups.payload,
        standings: scout.standings.payload,
      };
    } catch (err) {
      app.log.error(err, 'football/scout failed');
      return reply.code(502).send({ error: err instanceof Error ? err.message : 'Football API error' });
    }
  });

  // GET /api/proxy/football/league-fixtures?leagueId=&season=&next=
  app.get<{ Querystring: { leagueId: string; season?: string; next?: string } }>(
    '/api/proxy/football/league-fixtures',
    async (req, reply) => {
      const leagueId = Number(req.query.leagueId);
      if (!leagueId || isNaN(leagueId)) return reply.code(400).send({ error: 'leagueId required' });
      const season = Number(req.query.season) || new Date().getFullYear() - (new Date().getMonth() < 7 ? 1 : 0);
      const next = Math.min(Number(req.query.next) || 10, 20);
      try {
        const fixtures = await fetchLeagueFixturesFromReferenceProvider(leagueId, season, next);
        return fixtures;
      } catch (err) {
        app.log.error(err, 'proxy/football/league-fixtures failed');
        return reply.code(502).send({ error: err instanceof Error ? err.message : 'Football API error' });
      }
    },
  );

  // POST /api/proxy/ai/analyze
  app.post<{
    Body: {
      prompt?: string;
      matchId?: string;
      provider: string;
      model?: string;
      forceAnalyze?: boolean;
    };
  }>(
    '/api/proxy/ai/analyze',
    async (req, reply) => {
      const aiStart = Date.now();
      try {
        const user = requireCurrentUser(req, reply);
        if (!user) return;
        const { prompt, matchId, provider, model, forceAnalyze } = req.body;

        if (provider === 'gemini') {
          if (!(typeof prompt === 'string' && prompt.trim()) && !(typeof matchId === 'string' && matchId.trim())) {
            return reply.code(400).send({ error: 'prompt or matchId is required' });
          }
          const resolvedModel = model || config.geminiModel;
          if (user.role !== 'admin' && user.role !== 'owner') {
            const access = await resolveSubscriptionAccess(user.userId);
            await consumeManualAiQuota(access, user.userId, {
              provider,
              model: resolvedModel,
              hasPrompt: typeof prompt === 'string' && prompt.trim().length > 0,
              matchId: typeof matchId === 'string' ? matchId.trim() : null,
              forceAnalyze: forceAnalyze === true,
            });
          }
          const promptOnlyResult = typeof matchId === 'string' && matchId.trim() && !(typeof prompt === 'string' && prompt.trim())
            ? await runPromptOnlyAnalysisForMatch(matchId.trim(), {
              forceAnalyze: forceAnalyze === true,
              modelOverride: resolvedModel,
            })
            : null;
          const text = typeof prompt === 'string' && prompt.trim()
            ? await callGemini(prompt, resolvedModel)
            : promptOnlyResult?.text ?? null;
          if (text == null) {
            return reply.code(502).send({ error: 'AI API returned an empty response' });
          }

          if (promptOnlyResult && typeof matchId === 'string' && matchId.trim()) {
            audit({
              category: 'PIPELINE',
              action: 'PROMPT_ONLY_MATCH_ANALYZED',
              outcome: promptOnlyResult.result.success
                ? (promptOnlyResult.result.shouldPush ? 'SUCCESS' : 'SKIPPED')
                : 'FAILURE',
              actor: 'manual-ask-ai',
              duration_ms: Date.now() - aiStart,
              metadata: toPromptOnlyAuditMetadata(matchId.trim(), provider, resolvedModel, promptOnlyResult.result),
              error: promptOnlyResult.result.error,
            });
          }

          audit({
            category: 'AI',
            action: 'AI_CALL',
            actor: 'pipeline',
            duration_ms: Date.now() - aiStart,
            metadata: {
              provider,
              model: resolvedModel,
              promptLength: typeof prompt === 'string' ? prompt.length : null,
              matchId: typeof matchId === 'string' ? matchId : null,
              responseLength: text.length,
            },
          });
          return { text };
        }

        return reply.code(400).send({ error: `AI provider "${provider}" not yet supported on server` });
      } catch (err) {
        const entitlement = sendEntitlementError(err);
        if (entitlement) {
          return reply.code(entitlement.statusCode).send(entitlement.payload);
        }
        audit({
          category: 'AI',
          action: 'AI_CALL',
          outcome: 'FAILURE',
          actor: 'pipeline',
          duration_ms: Date.now() - aiStart,
          error: err instanceof Error ? err.message : String(err),
        });
        app.log.error(err, 'proxy/ai/analyze failed');
        return reply.code(502).send({ error: err instanceof Error ? err.message : 'AI API error' });
      }
    },
  );

  // POST /api/proxy/notify/email  (placeholder - log only until SMTP configured)
  app.post<{ Body: { email_to: string; email_subject: string; email_body_html: string } }>(
    '/api/proxy/notify/email',
    async (req) => {
      const { email_to, email_subject } = req.body;
      console.log(`[notify/email] To: ${email_to}, Subject: ${email_subject} (SMTP not configured - logged only)`);
      return { sent: false, reason: 'SMTP not configured' };
    },
  );

  // POST /api/proxy/notify/telegram
  app.post<{ Body: { chat_id: string; text: string; photo_url?: string; chart_config?: Record<string, unknown> } }>(
    '/api/proxy/notify/telegram',
    async (req, reply) => {
      if (!config.telegramBotToken) {
        return reply.status(200).send({ sent: false, reason: 'TELEGRAM_BOT_TOKEN not configured' });
      }
      try {
        const { chat_id, text, photo_url, chart_config } = req.body;
        if (!chat_id) {
          return reply.status(200).send({ sent: false, reason: 'chat_id is empty' });
        }
        const resolvedPhotoUrl = photo_url || (chart_config ? buildQuickChartUrl(chart_config) : '');
        if (resolvedPhotoUrl) {
          await sendTelegramPhoto(chat_id, resolvedPhotoUrl, text);
        } else {
          await sendTelegramMessage(chat_id, text);
        }
        audit({ category: 'NOTIFICATION', action: 'TELEGRAM_SEND', actor: 'pipeline', metadata: { chatId: chat_id, hasPhoto: !!resolvedPhotoUrl } });
        return { sent: true };
      } catch (err) {
        audit({ category: 'NOTIFICATION', action: 'TELEGRAM_SEND', outcome: 'FAILURE', actor: 'pipeline', error: err instanceof Error ? err.message : String(err) });
        app.log.error(err, 'proxy/notify/telegram failed');
        return reply.code(502).send({ error: err instanceof Error ? err.message : 'Telegram API error' });
      }
    },
  );
}
