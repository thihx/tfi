import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Toggle } from '@/components/ui/Toggle';
import { useToast } from '@/hooks/useToast';
import type { AuthUser } from '@/lib/services/auth';
import { updateCurrentUserProfile } from '@/lib/services/auth';
import {
  fetchNotificationChannels,
  persistNotificationChannel,
  userMessageForNotificationChannelFailure,
} from '@/lib/services/notification-channels';
import {
  getExistingSubscription,
  getNotificationPermission,
  isPushSupported,
  requestNotificationPermission,
  subscribePush,
  unsubscribePush,
} from '@/lib/services/push';
import { fetchMonitorConfig, persistMonitorConfig } from '@/features/live-monitor/config';
import {
  askAiQuickPromptItemsToLines,
  linesToAskAiQuickPromptItems,
  type AskAiQuickPromptItem,
} from '@/lib/askAiQuickPrompts';
import { buildTimeZoneOptions, DEFAULT_APP_TIMEZONE, detectBrowserTimeZone } from '@/lib/utils/timezone';
import type { NotificationChannelConfig, NotificationChannelType } from '@/types';
import { TelegramDeepLinkConnect } from '@/components/profile/TelegramDeepLinkConnect';

interface ProfileEditModalProps {
  open: boolean;
  onClose: () => void;
  user: AuthUser;
  onUserChange?: (user: AuthUser) => void;
}

type ProfileTab = 'identity' | 'preferences' | 'notifications' | 'watchlist';

const PROFILE_TAB_STORAGE_KEY = 'profile-edit-active-tab';

function getUserDisplayName(user: AuthUser): string {
  return user.displayName?.trim() || user.name || user.email;
}

function getUserAvatar(user: AuthUser): string {
  return user.avatarUrl?.trim() || user.picture || '';
}

function getUserInitials(user: AuthUser): string {
  return getUserDisplayName(user)
    .split(' ')
    .map((word) => word[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function getAvatarColor(email: string): string {
  const colors = ['#4285f4', '#ea4335', '#34a853', '#fbbc04', '#9c27b0'];
  return colors[(email.charCodeAt(0) || 0) % colors.length] ?? '#4285f4';
}

function getChannelDescription(channel: NotificationChannelConfig): string {
  if (channel.channelType === 'telegram') return 'Use “Open Telegram to link” (recommended) or paste your Chat ID.';
  if (channel.channelType === 'email') return 'Email destination for alert delivery.';
  if (channel.channelType === 'zalo') return 'Zalo destination identifier for future delivery support.';
  return 'Browser subscription status for Web Push delivery on this device.';
}

function getChannelPlaceholder(channelType: NotificationChannelType): string {
  if (channelType === 'telegram') return 'Telegram chat ID';
  if (channelType === 'email') return 'Email address';
  if (channelType === 'zalo') return 'Zalo recipient / user ID';
  return '';
}

function getChannelStatusColor(status: NotificationChannelConfig['status']): string {
  if (status === 'verified') return '#047857';
  if (status === 'pending') return '#1d4ed8';
  if (status === 'disabled') return '#6b7280';
  return '#92400e';
}

function roleBadgeClass(role: string | undefined): string {
  if (role === 'owner') return 'role-badge role-badge--owner';
  if (role === 'admin') return 'role-badge role-badge--admin';
  return 'role-badge role-badge--member';
}

function PrefRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="pref-row">
      <div className="pref-row__label">
        <div>{label}</div>
        {hint && <div className="pref-row__hint">{hint}</div>}
      </div>
      <div className="pref-row__control">{children}</div>
    </div>
  );
}

export function ProfileEditModal({ open, onClose, user, onUserChange }: ProfileEditModalProps) {
  const { showToast } = useToast();
  const detectedTimeZone = detectBrowserTimeZone();
  const [activeTab, setActiveTab] = useState<ProfileTab>('identity');
  const [displayNameDraft, setDisplayNameDraft] = useState(getUserDisplayName(user));
  const [savingProfile, setSavingProfile] = useState(false);
  const [loadingPrefs, setLoadingPrefs] = useState(false);
  const [uiLanguage, setUiLanguage] = useState<'en' | 'vi'>('vi');
  const [userTimeZone, setUserTimeZone] = useState(detectedTimeZone ?? DEFAULT_APP_TIMEZONE);
  const [userTimeZoneConfirmed, setUserTimeZoneConfirmed] = useState(false);
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [notificationLanguage, setNotificationLanguage] = useState<'vi' | 'en' | 'both'>('vi');
  const [autoApplyRecommendedCondition, setAutoApplyRecommendedCondition] = useState(true);
  const [webPushEnabled, setWebPushEnabled] = useState(false);
  const [hasWebPushSubscription, setHasWebPushSubscription] = useState(false);
  const [webPushLoading, setWebPushLoading] = useState(false);
  const [webPushPermission, setWebPushPermission] = useState<NotificationPermission>('default');
  const [notificationChannels, setNotificationChannels] = useState<NotificationChannelConfig[]>([]);
  const [channelAddresses, setChannelAddresses] = useState<Record<string, string>>({});
  const [channelSaving, setChannelSaving] = useState<Record<string, boolean>>({});
  const [enQuickLines, setEnQuickLines] = useState('');
  const [viQuickLines, setViQuickLines] = useState('');
  const [initialQuickLines, setInitialQuickLines] = useState({ en: '', vi: '' });
  const [savingQuickPrompts, setSavingQuickPrompts] = useState(false);

  const telegramChannel = notificationChannels.find((channel) => channel.channelType === 'telegram') ?? null;
  const emailChannel = notificationChannels.find((channel) => channel.channelType === 'email') ?? null;
  const zaloChannel = notificationChannels.find((channel) => channel.channelType === 'zalo') ?? null;
  const avatarUrl = getUserAvatar(user);
  const timeZoneOptions = useMemo(
    () => buildTimeZoneOptions(userTimeZone, detectedTimeZone, userTimeZone),
    [detectedTimeZone, userTimeZone],
  );

  useEffect(() => {
    setDisplayNameDraft(getUserDisplayName(user));
  }, [user]);

  useEffect(() => {
    if (!open) return;
    const saved = sessionStorage.getItem(PROFILE_TAB_STORAGE_KEY) as ProfileTab | null;
    if (saved === 'identity' || saved === 'preferences' || saved === 'notifications' || saved === 'watchlist') {
      setActiveTab(saved);
    }
  }, [open]);

  const handleTabChange = (tab: ProfileTab) => {
    setActiveTab(tab);
    sessionStorage.setItem(PROFILE_TAB_STORAGE_KEY, tab);
  };

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoadingPrefs(true);
    setWebPushPermission(getNotificationPermission());

    Promise.all([
      fetchMonitorConfig().catch(() => null),
      fetchNotificationChannels().catch(() => [] as NotificationChannelConfig[]),
      isPushSupported() ? getExistingSubscription().catch(() => null) : Promise.resolve(null),
    ])
      .then(([config, channels, existingSubscription]) => {
        if (!active) return;
        if (config) {
          setUiLanguage(config.UI_LANGUAGE === 'en' ? 'en' : 'vi');
          setUserTimeZone(config.USER_TIMEZONE || detectedTimeZone || DEFAULT_APP_TIMEZONE);
          setUserTimeZoneConfirmed(config.USER_TIMEZONE_CONFIRMED === true && typeof config.USER_TIMEZONE === 'string');
          setTelegramEnabled(config.TELEGRAM_ENABLED === true);
          setNotificationLanguage((config.NOTIFICATION_LANGUAGE as 'vi' | 'en' | 'both') || 'vi');
          setAutoApplyRecommendedCondition(config.AUTO_APPLY_RECOMMENDED_CONDITION !== false);
          setWebPushEnabled(config.WEB_PUSH_ENABLED === true);
          const by = config.ASK_AI_QUICK_PROMPTS_BY_LOCALE;
          const nextEn = by?.en?.length
            ? askAiQuickPromptItemsToLines(by.en as AskAiQuickPromptItem[])
            : '';
          const nextVi = by?.vi?.length
            ? askAiQuickPromptItemsToLines(by.vi as AskAiQuickPromptItem[])
            : '';
          setEnQuickLines(nextEn);
          setViQuickLines(nextVi);
          setInitialQuickLines({ en: nextEn, vi: nextVi });
        }
        setNotificationChannels(channels);
        setChannelAddresses(
          Object.fromEntries(
            channels
              .filter((channel) => channel.address)
              .map((channel) => [channel.channelType, channel.address ?? '']),
          ),
        );
        setHasWebPushSubscription(existingSubscription != null);
      })
      .finally(() => {
        if (active) setLoadingPrefs(false);
      });

    return () => { active = false; };
  }, [detectedTimeZone, open]);

  const syncChannel = useCallback((next: NotificationChannelConfig) => {
    setNotificationChannels((prev) => prev.map((channel) => (channel.channelType === next.channelType ? next : channel)));
    setChannelAddresses((prev) => ({
      ...prev,
      [next.channelType]: next.address ?? '',
    }));
  }, []);

  const handleSaveProfile = async () => {
    const nextDisplayName = displayNameDraft.trim();
    if (!nextDisplayName) {
      showToast('Display name is required', 'error');
      return;
    }
    setSavingProfile(true);
    try {
      const updated = await updateCurrentUserProfile({ displayName: nextDisplayName });
      onUserChange?.(updated);
      setDisplayNameDraft(getUserDisplayName(updated));
      showToast('Profile updated', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save profile', 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleUiLanguageChange = async (value: 'en' | 'vi') => {
    const previous = uiLanguage;
    setUiLanguage(value);
    try {
      await persistMonitorConfig({ UI_LANGUAGE: value });
      showToast(`UI language → ${value.toUpperCase()}`, 'success');
    } catch {
      setUiLanguage(previous);
      showToast('Failed to save UI language', 'error');
    }
  };

  const handleSaveAskAiQuickPrompts = async () => {
    setSavingQuickPrompts(true);
    try {
      await persistMonitorConfig({
        ASK_AI_QUICK_PROMPTS_BY_LOCALE: {
          en: linesToAskAiQuickPromptItems(enQuickLines),
          vi: linesToAskAiQuickPromptItems(viQuickLines),
        },
      });
      setInitialQuickLines({ en: enQuickLines, vi: viQuickLines });
      showToast('Ask AI quick prompts saved', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save quick prompts', 'error');
    } finally {
      setSavingQuickPrompts(false);
    }
  };

  const handleTimeZoneChange = async (next: string) => {
    const previousZone = userTimeZone;
    const previousConfirmed = userTimeZoneConfirmed;
    setUserTimeZone(next);
    setUserTimeZoneConfirmed(true);
    try {
      await persistMonitorConfig({ USER_TIMEZONE: next, USER_TIMEZONE_CONFIRMED: true });
      showToast('Timezone saved', 'success');
    } catch {
      setUserTimeZone(previousZone);
      setUserTimeZoneConfirmed(previousConfirmed);
      showToast('Failed to save timezone', 'error');
    }
  };

  const handleTelegramToggle = async (enabled: boolean) => {
    const previous = telegramEnabled;
    setTelegramEnabled(enabled);
    try {
      const saved = await persistNotificationChannel('telegram', { enabled });
      await persistMonitorConfig({ TELEGRAM_ENABLED: enabled });
      syncChannel(saved);
      showToast(`Telegram ${enabled ? 'enabled' : 'disabled'}`, 'success');
    } catch (err) {
      setTelegramEnabled(previous);
      try {
        const reverted = await persistNotificationChannel('telegram', { enabled: previous });
        syncChannel(reverted);
      } catch {
        /* ignore rollback failures */
      }
      await persistMonitorConfig({ TELEGRAM_ENABLED: previous }).catch(() => undefined);
      showToast(userMessageForNotificationChannelFailure(err, 'Không lưu được cài đặt Telegram.'), 'error');
    }
  };

  const handleNotificationLanguage = async (lang: 'vi' | 'en' | 'both') => {
    const previous = notificationLanguage;
    setNotificationLanguage(lang);
    try {
      await persistMonitorConfig({ NOTIFICATION_LANGUAGE: lang });
      if (telegramChannel) {
        const saved = await persistNotificationChannel('telegram', {
          config: { notificationLanguage: lang },
          metadata: {
            ...(telegramChannel.metadata ?? {}),
            notificationLanguage: lang,
          },
        });
        syncChannel(saved);
      }
      showToast(`Notification language → ${lang.toUpperCase()}`, 'success');
    } catch (err) {
      setNotificationLanguage(previous);
      showToast(userMessageForNotificationChannelFailure(err, 'Không lưu được ngôn ngữ thông báo.'), 'error');
    }
  };

  const handleAutoApplyRecommendedCondition = async (enabled: boolean) => {
    const previous = autoApplyRecommendedCondition;
    setAutoApplyRecommendedCondition(enabled);
    try {
      await persistMonitorConfig({ AUTO_APPLY_RECOMMENDED_CONDITION: enabled });
      showToast(enabled ? 'Suggested trigger auto-apply enabled' : 'Suggested trigger auto-apply disabled', 'success');
    } catch {
      setAutoApplyRecommendedCondition(previous);
      showToast('Failed to save watchlist preference', 'error');
    }
  };

  const handleWebPushToggle = async (enabled: boolean) => {
    if (!isPushSupported()) {
      showToast('Web Push is not supported in this browser.', 'error');
      return;
    }
    setWebPushLoading(true);
    try {
      let permission = getNotificationPermission();
      setWebPushPermission(permission);
      if (enabled && permission !== 'granted') {
        permission = await requestNotificationPermission();
        setWebPushPermission(permission);
        if (permission !== 'granted') {
          showToast('Notification permission denied. Enable it in browser settings.', 'error');
          return;
        }
      }
      if (enabled) {
        await subscribePush();
        setHasWebPushSubscription(true);
      } else {
        await unsubscribePush();
        setHasWebPushSubscription(false);
      }
      await persistMonitorConfig({ WEB_PUSH_ENABLED: enabled });
      const saved = await persistNotificationChannel('web_push', { enabled });
      syncChannel(saved);
      setWebPushEnabled(enabled);
      showToast(`Web Push ${enabled ? 'enabled' : 'disabled'}`, 'success');
    } catch (err) {
      showToast(userMessageForNotificationChannelFailure(err, 'Không lưu được cài đặt Web Push.'), 'error');
    } finally {
      setWebPushLoading(false);
    }
  };

  const handleChannelAddressSave = async (channel: NotificationChannelConfig) => {
    const nextAddress = (channelAddresses[channel.channelType] ?? '').trim();
    setChannelSaving((prev) => ({ ...prev, [channel.channelType]: true }));
    try {
      const saved = await persistNotificationChannel(channel.channelType, {
        address: nextAddress || null,
      });
      syncChannel(saved);
      showToast(`${channel.channelType === 'telegram' ? 'Telegram' : channel.channelType === 'email' ? 'Email' : 'Zalo'} target saved`, 'success');
    } catch (err) {
      showToast(userMessageForNotificationChannelFailure(err, 'Không lưu được kênh thông báo.'), 'error');
    } finally {
      setChannelSaving((prev) => ({ ...prev, [channel.channelType]: false }));
    }
  };

  const telegramReady = telegramEnabled && !!(channelAddresses.telegram ?? telegramChannel?.address ?? '').trim();
  const telegramStatusLabel = !telegramEnabled ? 'Off' : telegramReady ? 'Ready' : 'Setup required';
  const telegramStatusColor = telegramReady ? '#1d4ed8' : telegramEnabled ? '#92400e' : 'var(--gray-500)';
  const webPushReady = webPushEnabled && hasWebPushSubscription && webPushPermission === 'granted';
  const webPushStatusLabel = !webPushEnabled ? 'Off' : webPushReady ? 'Ready' : webPushPermission === 'denied' ? 'Blocked' : 'Setup required';
  const webPushStatusColor = webPushReady ? '#047857' : webPushPermission === 'denied' ? '#991b1b' : webPushEnabled ? '#92400e' : 'var(--gray-500)';
  const quickPromptsUnchanged = enQuickLines === initialQuickLines.en && viQuickLines === initialQuickLines.vi;
  const displayNameUnchanged = displayNameDraft.trim() === getUserDisplayName(user);
  const futureChannels = [emailChannel, zaloChannel].filter((channel): channel is NotificationChannelConfig => channel != null);
  const TABS: { id: ProfileTab; label: string }[] = [
    { id: 'identity',      label: 'Profile' },
    { id: 'preferences',   label: 'Preferences' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'watchlist',     label: 'Watchlist' },
  ];

  return (
    <Modal open={open} onClose={onClose} title="Edit Profile" size="lg">
      {/* Tab nav */}
      <div className="modal-tab-bar" role="tablist" aria-label="Profile sections">
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`modal-tab-button${active ? ' modal-tab-button--active' : ''}`}
              onClick={() => handleTabChange(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="modal-tab-panel">

      {/* ── Tab: Profile ── */}
      {activeTab === 'identity' && (
        <div className="profile-edit-modal profile-form-stack">
          <div className="profile-identity-row">
            <div className="profile-identity-row__avatar">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={getUserDisplayName(user)}
                  referrerPolicy="no-referrer"
                  className="profile-avatar"
                />
              ) : (
                <div
                  className="profile-avatar profile-avatar--initials"
                  style={{ background: getAvatarColor(user.email) }}
                >
                  {getUserInitials(user)}
                </div>
              )}
              <span className="profile-avatar-caption">Photo from Google sign-in</span>
            </div>

            <div className="profile-identity-row__meta">
              <div className="profile-identity-row__title">
                <span className="profile-identity-row__name">{getUserDisplayName(user)}</span>
                {user.role && (
                  <span className={roleBadgeClass(user.role)}>{user.role}</span>
                )}
              </div>
              <div className="profile-info-strip profile-info-strip--compact">
                <div className="profile-info-chip">
                  <div className="profile-info-chip__label">Email</div>
                  <div className="profile-info-chip__value">{user.email}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="card settings-panel-card">
            <div className="settings-panel-card__header">
              <div>Display Name</div>
              <div className="pref-row__hint" style={{ marginTop: 1 }}>Shown in the app header and notifications. Email and photo are managed by Google sign-in.</div>
            </div>
            <div className="settings-panel-card__body profile-display-name-row">
              <input
                className="filter-input"
                value={displayNameDraft}
                onChange={(e) => setDisplayNameDraft(e.target.value)}
                maxLength={80}
                placeholder="Your display name"
                aria-label="Display name"
                onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveProfile(); }}
              />
              <button
                className="btn btn-primary btn-sm"
                onClick={() => void handleSaveProfile()}
                disabled={savingProfile || displayNameUnchanged}
                title={displayNameUnchanged ? 'No changes to save' : undefined}
              >
                {savingProfile ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Preferences ── */}
      {activeTab === 'preferences' && (
        <div className="profile-edit-modal">
        <div className="card settings-panel-card">
          <div className="settings-panel-card__header">
            <div>Personal Preferences</div>
            <div className="pref-row__hint" style={{ marginTop: 1 }}>These settings follow you, not the system.</div>
          </div>
          <div className="settings-panel-card__body" style={{ paddingTop: 4, paddingBottom: 4 }}>
            <PrefRow
              label="UI Language"
              hint="Language used for AI reasoning text."
            >
              <select
                className="job-interval-select"
                value={uiLanguage}
                onChange={(e) => void handleUiLanguageChange(e.target.value as 'en' | 'vi')}
                style={{ minWidth: '140px' }}
              >
                <option value="vi">Vietnamese</option>
                <option value="en">English</option>
              </select>
            </PrefRow>
            <PrefRow
              label="Timezone"
              hint={userTimeZoneConfirmed ? 'Saved for this account.' : `Browser detected: ${detectedTimeZone ?? 'Unavailable'}`}
            >
              <select
                className="job-interval-select"
                value={userTimeZone}
                onChange={(e) => void handleTimeZoneChange(e.target.value)}
                style={{ minWidth: '220px' }}
              >
                {timeZoneOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </PrefRow>
          </div>
          <details className="profile-collapsible">
            <summary>Ask AI quick prompts</summary>
            <div className="profile-collapsible__body">
              <p className="profile-collapsible__hint">
                One line per chip (max 12 lines, 200 characters each). Leave empty to use the built-in defaults for that language.
              </p>
              <div className="profile-quick-prompts-grid">
                <div>
                  <div className="profile-quick-prompts-grid__label">English</div>
                  <textarea
                    className="filter-input"
                    value={enQuickLines}
                    onChange={(e) => setEnQuickLines(e.target.value)}
                    placeholder="e.g. Is the over/under still fair?"
                    rows={4}
                  />
                </div>
                <div>
                  <div className="profile-quick-prompts-grid__label">Vietnamese</div>
                  <textarea
                    className="filter-input"
                    value={viQuickLines}
                    onChange={(e) => setViQuickLines(e.target.value)}
                    placeholder="Ví dụ: Tài xỉu với tỷ số hiện tại còn hợp lý không?"
                    rows={4}
                  />
                </div>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={savingQuickPrompts || quickPromptsUnchanged}
                title={quickPromptsUnchanged ? 'No changes to save' : undefined}
                onClick={() => void handleSaveAskAiQuickPrompts()}
              >
                {savingQuickPrompts ? 'Saving…' : 'Save quick prompts'}
              </button>
            </div>
          </details>
        </div>
        </div>
      )}

      {/* ── Tab: Notifications ── */}
      {activeTab === 'notifications' && (
        <div className={`profile-edit-modal profile-notif-stack${loadingPrefs ? ' profile-notif-stack--loading' : ''}`}>
          {loadingPrefs && (
            <div className="pref-row__hint" style={{ textAlign: 'center', padding: '8px 0' }}>Loading preferences…</div>
          )}

          <div className="profile-notif-summary" aria-label="Notification channel status">
            <span className={`profile-notif-summary__chip profile-notif-summary__chip--${telegramReady ? 'ok' : telegramEnabled ? 'warn' : 'off'}`}>
              Telegram · {telegramStatusLabel}
            </span>
            {isPushSupported() && (
              <span className={`profile-notif-summary__chip profile-notif-summary__chip--${
                webPushReady ? 'ok' : webPushPermission === 'denied' ? 'blocked' : webPushEnabled ? 'warn' : 'off'
              }`}
              >
                Web Push · {webPushStatusLabel}
              </span>
            )}
          </div>

          <div className={`profile-channel-card${telegramReady ? ' profile-channel-card--ready' : telegramEnabled ? ' profile-channel-card--warn' : ''}`}>
            <div className="profile-channel-card__head">
              <div style={{ flex: '1 1 200px' }}>
                <div className="profile-channel-card__title-row">
                  <span className="profile-channel-card__title">Telegram</span>
                  <span className="profile-channel-status" style={{ color: telegramStatusColor, borderColor: `${telegramStatusColor}33` }}>
                    {telegramStatusLabel}
                  </span>
                </div>
                <div className="profile-channel-card__hint">
                  {telegramReady
                    ? 'Ready to receive recommendations via Telegram. Use “Open Telegram to change chat” below to relink without typing Chat ID.'
                    : telegramEnabled
                      ? 'Open the link below and tap Start in Telegram, or paste Chat ID manually.'
                      : 'Telegram delivery is off for this account.'}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <select
                  className="job-interval-select"
                  value={notificationLanguage}
                  onChange={(e) => void handleNotificationLanguage(e.target.value as 'vi' | 'en' | 'both')}
                  disabled={!telegramEnabled}
                  style={{ minWidth: '110px', opacity: telegramEnabled ? 1 : 0.4, fontSize: '12px' }}
                  aria-label="Telegram notification language"
                >
                  <option value="vi">Vietnamese</option>
                  <option value="en">English</option>
                  <option value="both">EN + VI</option>
                </select>
                <Toggle on={telegramEnabled} onChange={(value) => void handleTelegramToggle(value)} label="Toggle Telegram" />
              </div>
            </div>
            {telegramChannel && (
              <div className="profile-channel-card__body">
                <TelegramDeepLinkConnect
                  telegramEnabled={telegramEnabled}
                  telegramChannel={telegramChannel}
                  onToast={(msg, variant) => showToast(msg, variant)}
                  onChannelsRefresh={(channels) => {
                    setNotificationChannels(channels);
                    setChannelAddresses(
                      Object.fromEntries(
                        channels
                          .filter((channel) => channel.address)
                          .map((channel) => [channel.channelType, channel.address ?? '']),
                      ),
                    );
                  }}
                />
                <div className="profile-quick-prompts-grid__label" style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Manual Chat ID (optional)
                </div>
                <div className="profile-channel-card__actions">
                  <input
                    type="text"
                    className="filter-input"
                    value={channelAddresses.telegram ?? telegramChannel.address ?? ''}
                    placeholder={getChannelPlaceholder('telegram')}
                    onChange={(e) => setChannelAddresses((prev) => ({ ...prev, telegram: e.target.value }))}
                    aria-label="Telegram chat ID"
                  />
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={channelSaving.telegram === true}
                    onClick={() => { void handleChannelAddressSave(telegramChannel); }}
                  >
                    {channelSaving.telegram === true ? 'Saving…' : 'Save Chat ID'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {isPushSupported() && (
            <div className={`profile-channel-card${webPushReady ? ' profile-channel-card--ready-green' : webPushEnabled ? ' profile-channel-card--warn' : ''}`}>
              <div className="profile-channel-card__head">
                <div style={{ flex: '1 1 200px' }}>
                  <div className="profile-channel-card__title-row">
                    <span className="profile-channel-card__title">Web Push</span>
                    <span className="profile-channel-status" style={{ color: webPushStatusColor, borderColor: `${webPushStatusColor}33` }}>
                      {webPushStatusLabel}
                    </span>
                  </div>
                  <div className="profile-channel-card__hint">
                    {webPushReady
                      ? 'This browser is subscribed and ready to receive push alerts.'
                      : webPushPermission === 'denied'
                        ? 'Blocked — allow notifications in browser site settings.'
                        : webPushEnabled
                          ? 'Enabled, but this browser needs an active push subscription.'
                          : 'Browser push delivery is off for this device.'}
                  </div>
                </div>
                <Toggle
                  on={webPushEnabled}
                  onChange={(value) => void handleWebPushToggle(value)}
                  disabled={webPushLoading || webPushPermission === 'denied'}
                  label="Toggle Web Push"
                />
              </div>
            </div>
          )}

          {futureChannels.length > 0 && (
            <details className="profile-collapsible profile-collapsible--muted">
              <summary>More channels (coming soon)</summary>
              <div className="profile-collapsible__body">
                {futureChannels.map((channel) => (
                  <div key={channel.channelType} className="profile-channel-card">
                    <div className="profile-channel-card__head">
                      <div style={{ flex: '1 1 200px' }}>
                        <div className="profile-channel-card__title-row">
                          <span className="profile-channel-card__title">
                            {channel.channelType === 'email' ? 'Email' : 'Zalo'}
                          </span>
                          <span className="profile-channel-status" style={{ color: getChannelStatusColor(channel.status), borderColor: `${getChannelStatusColor(channel.status)}33` }}>
                            {channel.status.toUpperCase()}
                          </span>
                          {channel.channelType === 'email' && (
                            <span className="profile-channel-tag profile-channel-tag--pending">Sender pending</span>
                          )}
                          {channel.channelType === 'zalo' && (
                            <span className="profile-channel-tag profile-channel-tag--soon">Coming soon</span>
                          )}
                        </div>
                        <div className="profile-channel-card__hint">{getChannelDescription(channel)}</div>
                      </div>
                    </div>
                    <div className="profile-channel-card__body">
                      <div className="profile-channel-card__actions">
                        <input
                          type="text"
                          className="filter-input"
                          value={channelAddresses[channel.channelType] ?? channel.address ?? ''}
                          placeholder={getChannelPlaceholder(channel.channelType)}
                          onChange={(e) => setChannelAddresses((prev) => ({ ...prev, [channel.channelType]: e.target.value }))}
                          aria-label={channel.channelType === 'email' ? 'Email address' : 'Zalo recipient'}
                        />
                        <button
                          className="btn btn-secondary btn-sm"
                          disabled={channelSaving[channel.channelType] === true}
                          onClick={() => { void handleChannelAddressSave(channel); }}
                        >
                          {channelSaving[channel.channelType] === true ? 'Saving…' : `Save ${channel.channelType === 'email' ? 'Email' : 'Zalo'}`}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* ── Tab: Watchlist ── */}
      {activeTab === 'watchlist' && (
        <div className="profile-edit-modal">
        <div className="card settings-panel-card">
          <div className="settings-panel-card__header">
            <div>Watchlist Defaults</div>
            <div className="pref-row__hint" style={{ marginTop: 1 }}>
              Per-user defaults for new watchlist items. Bulk add by favorite leagues is on the Matches tab.
            </div>
          </div>
          <div className="settings-panel-card__body" style={{ paddingTop: 4, paddingBottom: 4 }}>
            <PrefRow
              label="Auto-apply suggested trigger condition"
              hint="For new or safely updatable watchlist entries, copy the suggested recommendation into Trigger Condition by default."
            >
              <Toggle
                on={autoApplyRecommendedCondition}
                onChange={(value) => void handleAutoApplyRecommendedCondition(value)}
                label="Toggle suggested trigger auto-apply"
              />
            </PrefRow>
          </div>
        </div>
        </div>
      )}

      </div>
    </Modal>
  );
}
