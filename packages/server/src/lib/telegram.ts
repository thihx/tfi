// ============================================================
// Telegram API Client — shared across proxy routes and pipeline
// ============================================================

import { config } from '../config.js';

const TELEGRAM_TIMEOUT_MS = 15_000;

async function telegramFetch(url: string, body: Record<string, unknown>): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Telegram API ${res.status}: ${text.substring(0, 300)}`);
  }
}

export async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  if (!config.telegramBotToken) throw new Error('TELEGRAM_BOT_TOKEN not configured');
  const url = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;
  await telegramFetch(url, { chat_id: chatId, text, parse_mode: 'HTML' });
}

export async function sendTelegramPhoto(chatId: string, photoUrl: string, caption: string): Promise<void> {
  if (!config.telegramBotToken) throw new Error('TELEGRAM_BOT_TOKEN not configured');
  const url = `https://api.telegram.org/bot${config.telegramBotToken}/sendPhoto`;
  await telegramFetch(url, { chat_id: chatId, photo: photoUrl, caption, parse_mode: 'HTML' });
}
