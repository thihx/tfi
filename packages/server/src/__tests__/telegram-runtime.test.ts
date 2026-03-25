import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../repos/settings.repo.js', () => ({
  getSettings: vi.fn(),
}));

import { getSettings } from '../repos/settings.repo.js';
import { loadOperationalTelegramSettings } from '../lib/telegram-runtime.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('telegram runtime settings', () => {
  test('defaults Telegram to disabled when DB toggle is missing', async () => {
    vi.mocked(getSettings).mockResolvedValueOnce({
      TELEGRAM_CHAT_ID: '123456',
    });

    await expect(loadOperationalTelegramSettings()).resolves.toEqual({
      chatId: '123456',
      enabled: false,
    });
  });

  test('respects an explicit enabled Telegram toggle from DB settings', async () => {
    vi.mocked(getSettings).mockResolvedValueOnce({
      TELEGRAM_CHAT_ID: '123456',
      TELEGRAM_ENABLED: true,
    });

    await expect(loadOperationalTelegramSettings()).resolves.toEqual({
      chatId: '123456',
      enabled: true,
    });
  });
});