import { getSettings } from '../repos/settings.repo.js';

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return fallback;
}

function parseChatId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export interface OperationalTelegramSettings {
  chatId: string;
  enabled: boolean;
}

export async function loadOperationalTelegramSettings(): Promise<OperationalTelegramSettings> {
  const settings = await getSettings().catch(() => ({} as Record<string, unknown>));
  return {
    chatId: parseChatId(settings['TELEGRAM_CHAT_ID']),
    enabled: parseBoolean(settings['TELEGRAM_ENABLED'], false),
  };
}