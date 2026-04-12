import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
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

const DEFAULT_ROLE_BADGE = { bg: 'var(--gray-100)', color: 'var(--gray-600)' } as const;
const ROLE_BADGE: Record<string, { bg: string; color: string }> = {
  owner:  { bg: '#ede9fe', color: '#6d28d9' },
  admin:  { bg: '#dbeafe', color: '#1d4ed8' },
  member: DEFAULT_ROLE_BADGE,
};

const tabBarStyle: CSSProperties = {
  display: 'flex',
  gap: '2px',
  borderBottom: '1px solid var(--gray-200)',
  marginBottom: '16px',
  flexShrink: 0,
};

function tabBtnStyle(active: boolean): CSSProperties {
  return {
    padding: '8px 14px',
    fontSize: '11px',
    fontWeight: active ? 700 : 500,
    letterSpacing: '0.5px',
    textTransform: 'uppercase',
    color: active ? '#2563eb' : 'var(--gray-400)',
    background: active ? 'rgba(37,99,235,0.06)' : 'none',
    border: 'none',
    borderBottom: active ? '2px solid #2563eb' : '2px solid transparent',
    borderRadius: '4px 4px 0 0',
    cursor: 'pointer',
    marginBottom: '-1px',
    transition: 'color 0.15s, background 0.15s',
    whiteSpace: 'nowrap',
  };
}

function PrefRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', padding: '10px 0', borderBottom: '1px solid var(--gray-100)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--gray-800)' }}>{label}</div>
        {hint && <div style={{ fontSize: '11px', color: 'var(--gray-500)', marginTop: '2px' }}>{hint}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
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
          if (by?.en?.length) {
            setEnQuickLines(askAiQuickPromptItemsToLines(by.en as AskAiQuickPromptItem[]));
          } else {
            setEnQuickLines('');
          }
          if (by?.vi?.length) {
            setViQuickLines(askAiQuickPromptItemsToLines(by.vi as AskAiQuickPromptItem[]));
          } else {
            setViQuickLines('');
          }
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
  const roleStyle = ROLE_BADGE[user.role ?? 'member'] ?? DEFAULT_ROLE_BADGE;

  const TABS: { id: ProfileTab; label: string }[] = [
    { id: 'identity',      label: 'Profile' },
    { id: 'preferences',   label: 'Preferences' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'watchlist',     label: 'Watchlist' },
  ];

  return (
    <Modal open={open} onClose={onClose} title="Edit Profile" size="lg">
      {/* Tab nav */}
      <div style={tabBarStyle}>
        {TABS.map((tab) => (
          <button key={tab.id} style={tabBtnStyle(activeTab === tab.id)} onClick={() => setActiveTab(tab.id)}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content — fixed height so modal never resizes between tabs */}
      <div style={{ height: '440px', overflowY: 'auto', paddingRight: '2px' }}>

      {/* ── Tab: Profile ── */}
      {activeTab === 'identity' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Avatar + identity */}
          <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flexShrink: 0 }}>
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={getUserDisplayName(user)}
                  referrerPolicy="no-referrer"
                  style={{ width: 88, height: 88, borderRadius: '50%', objectFit: 'cover', border: '3px solid var(--gray-200)', display: 'block' }}
                />
              ) : (
                <div style={{
                  width: 88, height: 88, borderRadius: '50%',
                  background: getAvatarColor(user.email), color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '30px', fontWeight: 700, border: '3px solid var(--gray-200)',
                }}>
                  {getUserInitials(user)}
                </div>
              )}
            </div>

            <div style={{ flex: '1 1 240px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '18px', fontWeight: 700, color: 'var(--gray-900)' }}>
                  {getUserDisplayName(user)}
                </span>
                {user.role && (
                  <span style={{
                    fontSize: '11px', fontWeight: 600, padding: '2px 8px',
                    borderRadius: '999px', background: roleStyle.bg, color: roleStyle.color,
                  }}>
                    {user.role}
                  </span>
                )}
              </div>
              <div style={{ fontSize: '13px', color: 'var(--gray-500)' }}>{user.email}</div>
            </div>
          </div>

          {/* Edit display name */}
          <div style={{ border: '1px solid var(--gray-200)', borderRadius: '12px', overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-100)' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gray-700)' }}>Display Name</div>
              <div style={{ fontSize: '11px', color: 'var(--gray-500)', marginTop: '1px' }}>Shown in the app header and notifications. Email is managed by Google sign-in.</div>
            </div>
            <div style={{ padding: '14px 16px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                className="filter-input"
                value={displayNameDraft}
                onChange={(e) => setDisplayNameDraft(e.target.value)}
                maxLength={80}
                placeholder="Your display name"
                style={{ flex: '1 1 200px' }}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveProfile(); }}
              />
              <button
                className="btn btn-primary btn-sm"
                onClick={() => void handleSaveProfile()}
                disabled={savingProfile || displayNameDraft.trim() === getUserDisplayName(user)}
              >
                {savingProfile ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>

          {/* Read-only identity info */}
          <div style={{ border: '1px solid var(--gray-200)', borderRadius: '12px', overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-100)' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gray-700)' }}>Account Info</div>
            </div>
            <div style={{ padding: '4px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--gray-100)' }}>
                <span style={{ fontSize: '12px', color: 'var(--gray-500)' }}>Email</span>
                <span style={{ fontSize: '13px', color: 'var(--gray-800)', fontWeight: 500 }}>{user.email}</span>
              </div>
              {user.role && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--gray-100)' }}>
                  <span style={{ fontSize: '12px', color: 'var(--gray-500)' }}>Role</span>
                  <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '999px', background: roleStyle.bg, color: roleStyle.color }}>
                    {user.role}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Preferences ── */}
      {activeTab === 'preferences' && (
        <div style={{ border: '1px solid var(--gray-200)', borderRadius: '12px', overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-100)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gray-700)' }}>Personal Preferences</div>
            <div style={{ fontSize: '11px', color: 'var(--gray-500)', marginTop: '1px' }}>These settings follow you, not the system.</div>
          </div>
          <div style={{ padding: '0 16px' }}>
            <PrefRow
              label="UI Language"
              hint="Controls which language reasoning text is displayed in."
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
          <div style={{ padding: '12px 16px 16px', borderTop: '1px solid var(--gray-100)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gray-700)', marginBottom: '4px' }}>
              Ask AI — quick prompts
            </div>
            <div style={{ fontSize: '11px', color: 'var(--gray-500)', marginBottom: '10px', lineHeight: 1.45 }}>
              One line per chip (max 12 lines, 200 characters each). Leave empty to use the built-in defaults for that language.
            </div>
            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-600)', marginBottom: '4px' }}>English</div>
              <textarea
                className="filter-input"
                value={enQuickLines}
                onChange={(e) => setEnQuickLines(e.target.value)}
                placeholder="e.g. Is the over/under still fair?"
                rows={4}
                style={{ width: '100%', fontSize: '12px', lineHeight: 1.4, resize: 'vertical', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-600)', marginBottom: '4px' }}>Vietnamese</div>
              <textarea
                className="filter-input"
                value={viQuickLines}
                onChange={(e) => setViQuickLines(e.target.value)}
                placeholder="Ví dụ: Tài xỉu với tỷ số hiện tại còn hợp lý không?"
                rows={4}
                style={{ width: '100%', fontSize: '12px', lineHeight: 1.4, resize: 'vertical', boxSizing: 'border-box' }}
              />
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={savingQuickPrompts}
              onClick={() => void handleSaveAskAiQuickPrompts()}
            >
              {savingQuickPrompts ? 'Saving…' : 'Save quick prompts'}
            </button>
          </div>
        </div>
      )}

      {/* ── Tab: Notifications ── */}
      {activeTab === 'notifications' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', opacity: loadingPrefs ? 0.65 : 1, transition: 'opacity 0.2s' }}>
          {loadingPrefs && (
            <div style={{ fontSize: '12px', color: 'var(--gray-400)', textAlign: 'center', padding: '8px 0' }}>Loading preferences…</div>
          )}

          {/* Telegram */}
          <div style={{
            borderRadius: '12px',
            border: `1px solid ${telegramReady ? '#bfdbfe' : telegramEnabled ? '#fcd34d' : 'var(--gray-200)'}`,
            background: telegramReady ? '#eff6ff' : telegramEnabled ? '#fffbeb' : '#fafafa',
            overflow: 'hidden',
          }}>
            <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 200px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gray-900)' }}>Telegram</span>
                  <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '999px', background: 'white', color: telegramStatusColor, border: `1px solid ${telegramStatusColor}20` }}>
                    {telegramStatusLabel}
                  </span>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--gray-500)', marginTop: '3px' }}>
                  {telegramReady
                    ? 'Ready to receive recommendations via Telegram. Use “Open Telegram to change chat” below to relink without typing Chat ID.'
                    : telegramEnabled
                      ? 'Open the link below and tap Start in Telegram, or paste Chat ID manually.'
                      : 'Telegram delivery is off for this account.'}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <select
                  className="job-interval-select"
                  value={notificationLanguage}
                  onChange={(e) => void handleNotificationLanguage(e.target.value as 'vi' | 'en' | 'both')}
                  disabled={!telegramEnabled}
                  style={{ minWidth: '110px', opacity: telegramEnabled ? 1 : 0.4, fontSize: '12px' }}
                >
                  <option value="vi">Vietnamese</option>
                  <option value="en">English</option>
                  <option value="both">EN + VI</option>
                </select>
                <Toggle on={telegramEnabled} onChange={(value) => void handleTelegramToggle(value)} label="Toggle Telegram" />
              </div>
            </div>
            {telegramChannel && (
              <div style={{ padding: '0 16px 12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
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
                <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Manual Chat ID (optional)
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    className="filter-input"
                    value={channelAddresses.telegram ?? telegramChannel.address ?? ''}
                    placeholder={getChannelPlaceholder('telegram')}
                    onChange={(e) => setChannelAddresses((prev) => ({ ...prev, telegram: e.target.value }))}
                    style={{ flex: '1 1 200px', background: 'white', fontSize: '12px' }}
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

          {/* Web Push */}
          {isPushSupported() && (
            <div style={{
              borderRadius: '12px',
              border: `1px solid ${webPushReady ? '#bbf7d0' : webPushEnabled ? '#fcd34d' : 'var(--gray-200)'}`,
              background: webPushReady ? '#f0fdf4' : webPushEnabled ? '#fffbeb' : '#fafafa',
              overflow: 'hidden',
            }}>
              <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 200px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gray-900)' }}>Web Push</span>
                    <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '999px', background: 'white', color: webPushStatusColor, border: `1px solid ${webPushStatusColor}20` }}>
                      {webPushStatusLabel}
                    </span>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--gray-500)', marginTop: '3px' }}>
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

          {/* Email + Zalo — future channels */}
          {[emailChannel, zaloChannel].filter((channel): channel is NotificationChannelConfig => channel != null).map((channel) => (
            <div
              key={channel.channelType}
              style={{
                borderRadius: '12px',
                border: '1px solid var(--gray-200)',
                background: '#fafafa',
                overflow: 'hidden',
              }}
            >
              <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 200px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gray-700)' }}>
                      {channel.channelType === 'email' ? 'Email' : 'Zalo'}
                    </span>
                    <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '999px', background: 'white', color: getChannelStatusColor(channel.status), border: `1px solid ${getChannelStatusColor(channel.status)}20` }}>
                      {channel.status.toUpperCase()}
                    </span>
                    {channel.channelType === 'email' && (
                      <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 6px', borderRadius: '999px', background: '#fef3c7', color: '#92400e' }}>Sender pending</span>
                    )}
                    {channel.channelType === 'zalo' && (
                      <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 6px', borderRadius: '999px', background: '#fde68a', color: '#92400e' }}>Coming soon</span>
                    )}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--gray-400)', marginTop: '3px' }}>{getChannelDescription(channel)}</div>
                </div>
              </div>
              <div style={{ padding: '0 16px 12px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  className="filter-input"
                  value={channelAddresses[channel.channelType] ?? channel.address ?? ''}
                  placeholder={getChannelPlaceholder(channel.channelType)}
                  onChange={(e) => setChannelAddresses((prev) => ({ ...prev, [channel.channelType]: e.target.value }))}
                  style={{ flex: '1 1 200px', background: 'white', fontSize: '12px' }}
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
          ))}
        </div>
      )}

      {/* ── Tab: Watchlist ── */}
      {activeTab === 'watchlist' && (
        <div style={{ border: '1px solid var(--gray-200)', borderRadius: '12px', overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-100)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gray-700)' }}>Watchlist Defaults</div>
            <div style={{ fontSize: '11px', color: 'var(--gray-500)', marginTop: '1px' }}>Per-user defaults that influence how new watchlist items are created.</div>
          </div>
          <div style={{ padding: '0 16px' }}>
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
      )}

      </div>
    </Modal>
  );
}
