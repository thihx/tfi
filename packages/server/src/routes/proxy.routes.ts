// ============================================================
// Proxy Routes — Football API, AI, Notifications
// Replaces Google Apps Script proxy layer
// ============================================================

import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { fetchFixturesByIds, fetchLiveOdds } from '../lib/football-api.js';

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
  app.post<{ Body: { matchId: string } }>('/api/proxy/football/odds', async (req, reply) => {
    try {
      const odds = await fetchLiveOdds(req.body.matchId);
      return odds;
    } catch (err) {
      app.log.error(err, 'proxy/football/odds failed');
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
