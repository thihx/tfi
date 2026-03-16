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
  app.post<{ Body: { matchIds: string[] } }>('/api/proxy/football/live-fixtures', async (req) => {
    const fixtures = await fetchFixturesByIds(req.body.matchIds);
    return fixtures;
  });

  // POST /api/proxy/football/odds
  app.post<{ Body: { matchId: string } }>('/api/proxy/football/odds', async (req) => {
    const odds = await fetchLiveOdds(req.body.matchId);
    return odds;
  });

  // POST /api/proxy/ai/analyze
  app.post<{ Body: { prompt: string; provider: string; model: string } }>(
    '/api/proxy/ai/analyze',
    async (req) => {
      const { prompt, provider, model } = req.body;

      if (provider === 'gemini') {
        const text = await callGemini(prompt, model);
        return { text };
      }

      // Extensible: add claude, openai etc. here in the future
      throw new Error(`AI provider "${provider}" not yet supported on server`);
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
      await sendTelegramMessage(req.body.chat_id, req.body.text);
      return { sent: true };
    },
  );
}
