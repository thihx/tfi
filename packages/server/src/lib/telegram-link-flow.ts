import {
  assertNotificationChannelAllowed,
  EntitlementError,
  resolveSubscriptionAccess,
} from './subscription-access.js';
import {
  mergeNotificationSettings,
  resolveNotificationSettings,
} from './user-personalization-settings.js';
import * as notificationSettingsRepo from '../repos/notification-settings.repo.js';
import { saveNotificationChannelConfig } from '../repos/notification-channels.repo.js';
import {
  consumeTelegramLinkToken,
  peekTelegramLinkToken,
} from '../repos/telegram-link-tokens.repo.js';
import { sendTelegramMessage } from './telegram.js';

export interface TelegramLinkAttemptResult {
  /** Whether to respond to Telegram with userMessage */
  respond: boolean;
  userMessage: string;
}

/**
 * Handle deep-link payload from /start after user opens t.me/bot?start=TOKEN
 */
export async function processTelegramDeepLinkStart(
  startPayload: string,
  telegramChatId: string,
): Promise<TelegramLinkAttemptResult> {
  const payload = typeof startPayload === 'string' ? startPayload.trim() : '';
  if (!payload) {
    return {
      respond: true,
      userMessage:
        'Chào bạn. Để liên kết TFI, mở ứng dụng web TFI → Hồ sơ → Thông báo → nút mở Telegram, rồi nhấn Start tại đây.',
    };
  }

  const userId = await peekTelegramLinkToken(payload);
  if (!userId) {
    return {
      respond: true,
      userMessage:
        'Liên kết hết hạn hoặc không hợp lệ. Hãy tạo liên kết mới trong ứng dụng TFI (Hồ sơ → Thông báo → Telegram).',
    };
  }

  try {
    const access = await resolveSubscriptionAccess(userId);
    await assertNotificationChannelAllowed(access, userId, 'telegram', true);
  } catch (e) {
    if (e instanceof EntitlementError) {
      return {
        respond: true,
        userMessage:
          'Gói hiện tại chưa bật thông báo Telegram. Vui lòng nâng cấp trong ứng dụng TFI rồi tạo liên kết mới.',
      };
    }
    throw e;
  }

  const existingNs = await resolveNotificationSettings(userId);
  await notificationSettingsRepo.saveNotificationSettings(
    userId,
    mergeNotificationSettings(existingNs, { telegramEnabled: true }),
  );

  await saveNotificationChannelConfig(userId, 'telegram', {
    enabled: true,
    address: telegramChatId,
    status: 'verified',
    metadata: {
      setupState: 'linked_via_deeplink',
      linkedAt: new Date().toISOString(),
    },
  });

  const consumed = await consumeTelegramLinkToken(payload);
  if (!consumed) {
    return {
      respond: true,
      userMessage:
        'Liên kết không hoàn tất (token đã dùng hoặc hết hạn). Hãy tạo liên kết mới trong ứng dụng TFI.',
    };
  }

  return {
    respond: true,
    userMessage:
      'Đã kết nối TFI với Telegram này. Bạn có thể đóng chat và quay lại ứng dụng.',
  };
}

export async function replyTelegramUser(chatId: string, text: string): Promise<void> {
  await sendTelegramMessage(chatId, text);
}
