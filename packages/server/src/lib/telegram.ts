// ============================================================
// Telegram API Client — shared across proxy routes and pipeline
// ============================================================

import { config } from '../config.js';

export async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
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
