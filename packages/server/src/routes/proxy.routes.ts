// ============================================================
// Proxy Routes - Football API, AI, Notifications
// Replaces Google Apps Script proxy layer
// ============================================================

import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { audit } from '../lib/audit.js';
import {
  fetchFixturesByIds,
  fetchPrediction,
  fetchFixtureEvents,
  fetchFixtureStatistics,
  fetchFixtureLineups,
  fetchStandings,
  fetchFixturesByLeague,
} from '../lib/football-api.js';
import { callGemini } from '../lib/gemini.js';
import { resolveMatchOdds } from '../lib/odds-resolver.js';
import { sendTelegramMessage, sendTelegramPhoto } from '../lib/telegram.js';
import { runPromptOnlyAnalysisForMatch } from '../lib/server-pipeline.js';

// ==================== Routes ====================

export async function proxyRoutes(app: FastifyInstance) {

  // POST /api/proxy/football/live-fixtures
  app.post<{ Body: { matchIds: string[] } }>('/api/proxy/football/live-fixtures', async (req, reply) => {
    try {
      const fixtures = await fetchFixturesByIds(req.body.matchIds);
      return fixtures;
    } catch (err) {
      app.log.error(err, 'proxy/football/live-fixtures failed');
      return reply.code(502).send({ error: err instanceof Error ? err.message : 'Football API error' });
    }
  });

  // POST /api/proxy/football/odds
  // Fallback chain: API-Sports live -> The Odds exact-event -> API-Sports pre-match
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
      });

      return {
        odds_source: resolved.oddsSource === 'none' ? 'pre-match' : resolved.oddsSource,
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
      const fixtures = await fetchFixturesByIds([fixtureId]);
      const fixture = fixtures[0] ?? null;

      let prediction = null;
      let events: unknown[] = [];
      let statistics: unknown[] = [];
      let lineups: unknown[] = [];
      let standings: unknown[] = [];

      if (hasStarted) {
        [events, statistics, lineups] = await Promise.all([
          fetchFixtureEvents(fixtureId).catch(() => []),
          fetchFixtureStatistics(fixtureId).catch(() => []),
          fetchFixtureLineups(fixtureId).catch(() => []),
        ]);
      } else {
        const seasonStr = season ? String(season) : String(new Date().getFullYear() - (new Date().getMonth() < 6 ? 1 : 0));
        [prediction, standings] = await Promise.all([
          fetchPrediction(fixtureId).catch(() => null),
          leagueId ? fetchStandings(String(leagueId), seasonStr).catch(() => []) : Promise.resolve([]),
        ]);
      }

      return { fixture, prediction, events, statistics, lineups, standings };
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
        const fixtures = await fetchFixturesByLeague(leagueId, season, next);
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
        const { prompt, matchId, provider, model, forceAnalyze } = req.body;

        if (provider === 'gemini') {
          const resolvedModel = model || config.geminiModel;
          const text = typeof prompt === 'string' && prompt.trim()
            ? await callGemini(prompt, resolvedModel)
            : typeof matchId === 'string' && matchId.trim()
              ? (
                  await runPromptOnlyAnalysisForMatch(matchId.trim(), {
                    forceAnalyze: forceAnalyze === true,
                    modelOverride: resolvedModel,
                  })
                ).text
              : null;

          if (text == null) {
            return reply.code(400).send({ error: 'prompt or matchId is required' });
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
  app.post<{ Body: { chat_id: string; text: string; photo_url?: string } }>(
    '/api/proxy/notify/telegram',
    async (req, reply) => {
      if (!config.telegramBotToken) {
        return reply.status(200).send({ sent: false, reason: 'TELEGRAM_BOT_TOKEN not configured' });
      }
      try {
        const { chat_id, text, photo_url } = req.body;
        if (!chat_id) {
          return reply.status(200).send({ sent: false, reason: 'chat_id is empty' });
        }
        if (photo_url) {
          await sendTelegramPhoto(chat_id, photo_url, text);
        } else {
          await sendTelegramMessage(chat_id, text);
        }
        audit({ category: 'NOTIFICATION', action: 'TELEGRAM_SEND', actor: 'pipeline', metadata: { chatId: chat_id, hasPhoto: !!photo_url } });
        return { sent: true };
      } catch (err) {
        audit({ category: 'NOTIFICATION', action: 'TELEGRAM_SEND', outcome: 'FAILURE', actor: 'pipeline', error: err instanceof Error ? err.message : String(err) });
        app.log.error(err, 'proxy/notify/telegram failed');
        return reply.code(502).send({ error: err instanceof Error ? err.message : 'Telegram API error' });
      }
    },
  );
}
