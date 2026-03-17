// ============================================================
// Proxy Routes — Football API, AI, Notifications
// Replaces Google Apps Script proxy layer
// ============================================================

import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import {
  fetchFixturesByIds, fetchLiveOdds, fetchPreMatchOdds, fetchPrediction,
  fetchFixtureEvents, fetchFixtureStatistics, fetchFixtureLineups, fetchStandings,
} from '../lib/football-api.js';

// ==================== AI (Gemini) ====================

async function callGemini(prompt: string, model: string): Promise<string> {
  if (!config.geminiApiKey) throw new Error('GEMINI_API_KEY not configured');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.geminiApiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API ${res.status}: ${text.substring(0, 300)}`);
  }

  const data = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

// ==================== Telegram ====================

async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  if (!config.telegramBotToken) throw new Error('TELEGRAM_BOT_TOKEN not configured');

  const url = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API ${res.status}: ${body.substring(0, 300)}`);
  }
}

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
  // Tries live odds first, normalizes format, falls back to pre-match odds
  app.post<{ Body: { matchId: string } }>('/api/proxy/football/odds', async (req, reply) => {
    try {
      // 1. Try live odds first
      let bookmakers: unknown[] = [];
      let oddsSource: 'live' | 'pre-match' = 'live';
      try {
        const liveOdds = await fetchLiveOdds(req.body.matchId) as Array<{
          fixture?: unknown;
          odds?: Array<{ id?: number; name?: string; values?: Array<{ value: string; odd: string }> }>;
          bookmakers?: Array<{ id: number; name: string; bets: unknown[] }>;
        }>;
        if (liveOdds.length > 0 && liveOdds[0]) {
          const entry = liveOdds[0];
          if (Array.isArray(entry.bookmakers) && entry.bookmakers.length > 0) {
            // Already in bookmaker format
            bookmakers = entry.bookmakers;
          } else if (Array.isArray(entry.odds) && entry.odds.length > 0) {
            // Live format: odds[] → convert to single bookmaker with bets
            bookmakers = [{
              id: 0,
              name: 'Live Odds',
              bets: entry.odds.map((o) => ({
                id: o.id ?? 0,
                name: o.name ?? '',
                values: o.values ?? [],
              })),
            }];
          }
        }
      } catch {
        // Live odds failed, will try pre-match
      }

      // 2. Fallback to pre-match odds if live returned nothing
      if (bookmakers.length === 0) {
        oddsSource = 'pre-match';
        try {
          const preMatch = await fetchPreMatchOdds(req.body.matchId) as Array<{
            bookmakers?: Array<{ id: number; name: string; bets: unknown[] }>;
          }>;
          if (preMatch.length > 0 && preMatch[0] && Array.isArray(preMatch[0].bookmakers)) {
            bookmakers = preMatch[0].bookmakers;
          }
        } catch {
          // Pre-match odds also failed
        }
      }

      // 3. Return in the format expected by frontend: { response: [{ bookmakers: [...] }] }
      return {
        odds_source: oddsSource,
        response: bookmakers.length > 0
          ? [{ fixture: { id: Number(req.body.matchId) }, bookmakers }]
          : [],
      };
    } catch (err) {
      app.log.error(err, 'proxy/football/odds failed');
      return reply.code(502).send({ error: err instanceof Error ? err.message : 'Football API error' });
    }
  });

  // POST /api/proxy/football/scout — aggregated match scout data
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

  // POST /api/proxy/ai/analyze
  app.post<{ Body: { prompt: string; provider: string; model: string } }>(
    '/api/proxy/ai/analyze',
    async (req, reply) => {
      try {
        const { prompt, provider, model } = req.body;

        if (provider === 'gemini') {
          const text = await callGemini(prompt, model);
          return { text };
        }

        return reply.code(400).send({ error: `AI provider "${provider}" not yet supported on server` });
      } catch (err) {
        app.log.error(err, 'proxy/ai/analyze failed');
        return reply.code(502).send({ error: err instanceof Error ? err.message : 'AI API error' });
      }
    },
  );

  // POST /api/proxy/notify/email  (placeholder — log only until SMTP configured)
  app.post<{ Body: { email_to: string; email_subject: string; email_body_html: string } }>(
    '/api/proxy/notify/email',
    async (req) => {
      const { email_to, email_subject } = req.body;
      console.log(`[notify/email] To: ${email_to}, Subject: ${email_subject} (SMTP not configured — logged only)`);
      return { sent: false, reason: 'SMTP not configured' };
    },
  );

  // POST /api/proxy/notify/telegram
  app.post<{ Body: { chat_id: string; text: string } }>(
    '/api/proxy/notify/telegram',
    async (req, reply) => {
      if (!config.telegramBotToken) {
        return reply.status(200).send({ sent: false, reason: 'TELEGRAM_BOT_TOKEN not configured' });
      }
      try {
        await sendTelegramMessage(req.body.chat_id, req.body.text);
        return { sent: true };
      } catch (err) {
        app.log.error(err, 'proxy/notify/telegram failed');
        return reply.code(502).send({ error: err instanceof Error ? err.message : 'Telegram API error' });
      }
    },
  );
}
