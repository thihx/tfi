import { useCallback, useEffect, useRef, useState } from 'react';
import { persistMonitorConfig } from '@/features/live-monitor/config';
import {
  fetchNotificationChannels,
  persistNotificationChannel,
  requestTelegramLinkOffer,
  userMessageForNotificationChannelFailure,
} from '@/lib/services/notification-channels';
import type { NotificationChannelConfig } from '@/types';

interface TelegramDeepLinkConnectProps {
  /** When true, show compact one-line variant (e.g. onboarding modal). */
  compact?: boolean;
  telegramEnabled: boolean;
  telegramChannel: NotificationChannelConfig | null;
  onChannelsRefresh?: (channels: NotificationChannelConfig[]) => void;
  onToast: (message: string, variant: 'success' | 'error' | 'info') => void;
  /** If set, enables polling after opening Telegram until chat is linked or timeout. */
  pollForAddressMs?: number;
  /**
   * If true, turns on Telegram in account settings before opening the deep link
   * (first-time onboarding when the user has not opened Profile yet).
   */
  autoEnableTelegram?: boolean;
  onTelegramEnabled?: (channel: NotificationChannelConfig) => void;
}

export function TelegramDeepLinkConnect({
  compact = false,
  telegramEnabled,
  telegramChannel,
  onChannelsRefresh,
  onToast,
  pollForAddressMs = 5 * 60 * 1000,
  autoEnableTelegram = false,
  onTelegramEnabled,
}: TelegramDeepLinkConnectProps) {
  const [linkBusy, setLinkBusy] = useState(false);
  const [polling, setPolling] = useState(false);
  const pollDeadlineRef = useRef(0);
  const pollAddressBaselineRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (timerRef.current != null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setPolling(false);
    pollDeadlineRef.current = 0;
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const hasAddress = !!(telegramChannel?.address ?? '').trim();

  const runPoll = useCallback(async () => {
    if (Date.now() > pollDeadlineRef.current) {
      stopPolling();
      onToast('Link window expired. Generate a new link if you still need Telegram.', 'info');
      return;
    }
    try {
      const channels = await fetchNotificationChannels();
      onChannelsRefresh?.(channels);
      const tg = channels.find((c) => c.channelType === 'telegram');
      const addr = (tg?.address ?? '').trim();
      if (addr && addr !== pollAddressBaselineRef.current) {
        stopPolling();
        onToast('Telegram connected.', 'success');
      }
    } catch {
      /* ignore transient errors while polling */
    }
  }, [onChannelsRefresh, onToast, stopPolling]);

  const handleOpenTelegram = async () => {
    setLinkBusy(true);
    try {
      if (autoEnableTelegram && !telegramEnabled) {
        const saved = await persistNotificationChannel('telegram', { enabled: true });
        await persistMonitorConfig({ TELEGRAM_ENABLED: true });
        onTelegramEnabled?.(saved);
      }
      pollAddressBaselineRef.current = (telegramChannel?.address ?? '').trim();
      const { deepLinkUrl } = await requestTelegramLinkOffer();
      window.open(deepLinkUrl, '_blank', 'noopener,noreferrer');
      onToast('In Telegram, tap Start. Then return here — we will detect the link automatically.', 'info');
      pollDeadlineRef.current = Date.now() + pollForAddressMs;
      setPolling(true);
      if (timerRef.current != null) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => void runPoll(), 3000);
      void runPoll();
    } catch (e) {
      onToast(userMessageForNotificationChannelFailure(e, 'Không tạo được liên kết Telegram.'), 'error');
    } finally {
      setLinkBusy(false);
    }
  };

  if (hasAddress) {
    if (compact) return null;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <p style={{ margin: 0, fontSize: '11px', color: 'var(--gray-500)', lineHeight: 1.45 }}>
          Chat ID is set. To use another Telegram account or device, tap the button below — no need to type the ID manually.
        </p>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={linkBusy}
          onClick={() => void handleOpenTelegram()}
        >
          {linkBusy ? 'Preparing…' : polling ? 'Waiting for Telegram…' : 'Open Telegram to change chat'}
        </button>
        {polling && (
          <span style={{ fontSize: '11px', color: 'var(--gray-500)' }}>Checking for connection…</span>
        )}
      </div>
    );
  }

  if (!telegramEnabled && !autoEnableTelegram) {
    return compact ? null : (
      <p style={{ margin: 0, fontSize: '11px', color: 'var(--gray-500)', lineHeight: 1.45 }}>
        Turn on Telegram above, then use the button below to link without typing Chat ID.
      </p>
    );
  }

  const btn = (
    <button
      type="button"
      className={compact ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-sm'}
      disabled={linkBusy}
      onClick={() => void handleOpenTelegram()}
    >
      {linkBusy ? 'Preparing…' : polling ? 'Waiting for Telegram…' : 'Open Telegram to link'}
    </button>
  );

  if (compact) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {btn}
        <span style={{ fontSize: '11px', color: 'var(--gray-500)', lineHeight: 1.45 }}>
          Or enter Chat ID manually below. You can finish later in Profile → Notifications.
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
      <div style={{ fontSize: '11px', color: 'var(--gray-600)', lineHeight: 1.45 }}>
        Link in one tap: we open Telegram with our bot — you press <strong>Start</strong> and this account is connected (no Chat ID).
      </div>
      {btn}
      {polling && (
        <span style={{ fontSize: '11px', color: 'var(--gray-500)' }}>Checking for connection…</span>
      )}
    </div>
  );
}
