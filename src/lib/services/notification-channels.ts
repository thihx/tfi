import type { NotificationChannelConfig, NotificationChannelType } from '@/types';
import { internalApiUrl } from '@/lib/internal-api';
import { getToken } from './auth';

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Thrown when a notification-channel API returns 4xx/5xx; carries server `code` when present. */
export class NotificationChannelRequestError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'NotificationChannelRequestError';
    this.code = code;
  }
}

/** User-facing toast text: ưu tiên giải thích gói/limit bằng tiếng Việt khi server gửi `code`. */
export function userMessageForNotificationChannelFailure(err: unknown, fallbackVi: string): string {
  const code = err instanceof NotificationChannelRequestError ? err.code : undefined;
  if (code === 'NOTIFICATION_CHANNEL_LIMIT_REACHED') {
    return 'Gói hiện tại giới hạn số kênh thông báo bật cùng lúc. Hãy tắt kênh khác (ví dụ Web Push) hoặc nâng cấp gói để bật thêm Telegram.';
  }
  if (code === 'NOTIFICATION_CHANNEL_NOT_ALLOWED') {
    return 'Gói hiện tại không bật được kênh này. Nâng cấp gói để dùng Telegram (hoặc kênh tương ứng).';
  }
  if (code === 'TELEGRAM_BOT_DISABLED') {
    return 'Máy chủ chưa cấu hình bot Telegram. Liên hệ quản trị.';
  }
  if (code === 'TELEGRAM_BOT_USERNAME_UNAVAILABLE') {
    return 'Không lấy được tên bot Telegram trên máy chủ. Thử lại sau hoặc liên hệ quản trị.';
  }
  if (err instanceof Error && err.message.trim()) return err.message;
  return fallbackVi;
}

function throwChannelRequestError(
  defaultMessage: string,
  body: { error?: string; code?: string } | null | undefined,
): never {
  const message =
    typeof body?.error === 'string' && body.error.trim() ? body.error.trim() : defaultMessage;
  const code = typeof body?.code === 'string' && body.code.trim() ? body.code.trim() : undefined;
  throw new NotificationChannelRequestError(message, code);
}

export async function fetchNotificationChannels(): Promise<NotificationChannelConfig[]> {
  const res = await fetch(internalApiUrl('/api/me/notification-channels'), {
    headers: { Accept: 'application/json', ...authHeaders() },
    credentials: 'include',
  });
  if (!res.ok) {
    try {
      const body = (await res.json()) as { error?: string; code?: string };
      throwChannelRequestError(`Load notification channels failed: ${res.status}`, body);
    } catch (e) {
      if (e instanceof NotificationChannelRequestError) throw e;
      throw new NotificationChannelRequestError(`Load notification channels failed: ${res.status}`);
    }
  }
  return res.json() as Promise<NotificationChannelConfig[]>;
}

export interface TelegramLinkOfferResponse {
  deepLinkUrl: string;
  expiresAt: string;
}

/** Opens t.me/bot?start=… — user taps Start; server webhook stores chat_id. */
export async function requestTelegramLinkOffer(): Promise<TelegramLinkOfferResponse> {
  const res = await fetch(internalApiUrl('/api/me/notification-channels/telegram/link-offer'), {
    method: 'POST',
    headers: { Accept: 'application/json', ...authHeaders() },
    credentials: 'include',
  });
  if (!res.ok) {
    try {
      const body = (await res.json()) as { error?: string; code?: string };
      throwChannelRequestError(`Link offer failed: ${res.status}`, body);
    } catch (e) {
      if (e instanceof NotificationChannelRequestError) throw e;
      throw new NotificationChannelRequestError(`Link offer failed: ${res.status}`);
    }
  }
  return res.json() as Promise<TelegramLinkOfferResponse>;
}

export async function persistNotificationChannel(
  channelType: NotificationChannelType,
  patch: {
    enabled?: boolean;
    address?: string | null;
    config?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  },
): Promise<NotificationChannelConfig> {
  const res = await fetch(internalApiUrl(`/api/me/notification-channels/${channelType}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(patch),
    credentials: 'include',
  });
  if (!res.ok) {
    try {
      const body = (await res.json()) as { error?: string; code?: string };
      throwChannelRequestError(`Save notification channel failed: ${res.status}`, body);
    } catch (e) {
      if (e instanceof NotificationChannelRequestError) throw e;
      throw new NotificationChannelRequestError(`Save notification channel failed: ${res.status}`);
    }
  }
  return res.json() as Promise<NotificationChannelConfig>;
}