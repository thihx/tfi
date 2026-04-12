import { config } from '../config.js';

let cachedUsername: string | null = null;
let cacheFailed = false;

/**
 * Bot username without @ for t.me deep links.
 * Uses TELEGRAM_BOT_USERNAME, or getMe once per process when token is set.
 */
export async function resolveTelegramBotUsername(): Promise<string | null> {
  const fromEnv = config.telegramBotUsername.trim().replace(/^@/, '');
  if (fromEnv) return fromEnv;
  if (!config.telegramBotToken.trim()) return null;
  if (cacheFailed) return null;
  if (cachedUsername) return cachedUsername;

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${config.telegramBotToken}/getMe`,
      { method: 'GET', signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) {
      cacheFailed = true;
      return null;
    }
    const data = (await res.json()) as { ok?: boolean; result?: { username?: string } };
    const u = data.result?.username?.trim();
    if (!u) {
      cacheFailed = true;
      return null;
    }
    cachedUsername = u;
    return u;
  } catch {
    cacheFailed = true;
    return null;
  }
}
