export type EntitlementValueType = 'boolean' | 'number' | 'string_array';

export interface EntitlementCatalogEntry {
  key: string;
  label: string;
  description: string;
  category: 'ai' | 'watchlist' | 'notifications' | 'recommendations' | 'reports' | 'history';
  valueType: EntitlementValueType;
  defaultValue: boolean | number | string[];
  enforced: boolean;
}

export type EntitlementMap = Record<string, unknown>;

export interface NormalizedEntitlementSummary {
  aiManualAskEnabled: boolean;
  aiManualAskDailyLimit: number;
  watchlistActiveMatchesLimit: number;
  notificationsAllowedChannelTypes: string[];
  notificationsMaxActiveChannels: number;
  proactiveFeedEnabled: boolean;
  proactiveFeedDailyLimit: number;
  watchlistFavoriteTeamsLimit: number;
  watchlistCustomConditionsLimit: number;
  reportsAdvancedEnabled: boolean;
  reportsExportEnabled: boolean;
  historyRetentionDays: number;
}

export const ENTITLEMENT_CATALOG: EntitlementCatalogEntry[] = [
  {
    key: 'ai.manual.ask.enabled',
    label: 'Manual AI enabled',
    description: 'Allows the user to run the manual Ask AI flow.',
    category: 'ai',
    valueType: 'boolean',
    defaultValue: true,
    enforced: true,
  },
  {
    key: 'ai.manual.ask.daily_limit',
    label: 'Manual AI daily limit',
    description: 'How many manual Ask AI requests the user may run per day.',
    category: 'ai',
    valueType: 'number',
    defaultValue: 3,
    enforced: true,
  },
  {
    key: 'watchlist.active_matches.limit',
    label: 'Active watchlist matches',
    description: 'Maximum number of active watched matches a user may keep at once.',
    category: 'watchlist',
    valueType: 'number',
    defaultValue: 5,
    enforced: true,
  },
  {
    key: 'notifications.channels.allowed_types',
    label: 'Allowed notification channels',
    description: 'List of notification channel types the plan may enable.',
    category: 'notifications',
    valueType: 'string_array',
    defaultValue: ['web_push'],
    enforced: true,
  },
  {
    key: 'notifications.channels.max_active',
    label: 'Maximum active channels',
    description: 'Maximum number of enabled notification channels at one time.',
    category: 'notifications',
    valueType: 'number',
    defaultValue: 1,
    enforced: true,
  },
  {
    key: 'recommendations.proactive.feed.enabled',
    label: 'Proactive picks enabled',
    description: 'Allows the user to receive system-picked recommendations without manually watching the match.',
    category: 'recommendations',
    valueType: 'boolean',
    defaultValue: true,
    enforced: false,
  },
  {
    key: 'recommendations.proactive.feed.daily_limit',
    label: 'Proactive picks daily limit',
    description: 'Maximum number of proactive picks shown per day.',
    category: 'recommendations',
    valueType: 'number',
    defaultValue: 2,
    enforced: false,
  },
  {
    key: 'watchlist.favorite_teams.limit',
    label: 'Favorite teams limit',
    description: 'Maximum number of favorite teams a user may auto-follow.',
    category: 'watchlist',
    valueType: 'number',
    defaultValue: 0,
    enforced: false,
  },
  {
    key: 'watchlist.custom_conditions.limit',
    label: 'Custom watch conditions limit',
    description: 'Maximum number of custom watch conditions a user may maintain.',
    category: 'watchlist',
    valueType: 'number',
    defaultValue: 1,
    enforced: false,
  },
  {
    key: 'reports.advanced.enabled',
    label: 'Advanced reports',
    description: 'Allows access to advanced report views.',
    category: 'reports',
    valueType: 'boolean',
    defaultValue: false,
    enforced: false,
  },
  {
    key: 'reports.export.enabled',
    label: 'Reports export',
    description: 'Allows export of reports and analytics data.',
    category: 'reports',
    valueType: 'boolean',
    defaultValue: false,
    enforced: false,
  },
  {
    key: 'history.retention.days',
    label: 'History retention days',
    description: 'How many days of history the user may access.',
    category: 'history',
    valueType: 'number',
    defaultValue: 14,
    enforced: false,
  },
];

export const ENTITLEMENT_DEFAULTS: EntitlementMap = Object.fromEntries(
  ENTITLEMENT_CATALOG.map((entry) => [entry.key, entry.defaultValue]),
);

function clampNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.floor(parsed));
}

function normalizeStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  );
}

function normalizeValue(entry: EntitlementCatalogEntry, rawValue: unknown): boolean | number | string[] {
  switch (entry.valueType) {
    case 'boolean':
      return typeof rawValue === 'boolean' ? rawValue : Boolean(entry.defaultValue);
    case 'number':
      return clampNumber(rawValue, Number(entry.defaultValue));
    case 'string_array':
      return normalizeStringArray(rawValue, entry.defaultValue as string[]);
  }
}

export function normalizeEntitlementMap(raw: unknown): EntitlementMap {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};

  return Object.fromEntries(
    ENTITLEMENT_CATALOG.map((entry) => [entry.key, normalizeValue(entry, source[entry.key])]),
  );
}

export function mergeEntitlements(...layers: Array<EntitlementMap | null | undefined>): EntitlementMap {
  let merged: Record<string, unknown> = { ...ENTITLEMENT_DEFAULTS };
  for (const layer of layers) {
    if (!layer) continue;
    const normalized = normalizeEntitlementMap(layer);
    merged = { ...merged, ...normalized };
  }
  return normalizeEntitlementMap(merged);
}

export function getBooleanEntitlement(entitlements: EntitlementMap, key: string): boolean {
  const entry = ENTITLEMENT_CATALOG.find((item) => item.key === key);
  if (!entry || entry.valueType !== 'boolean') return false;
  return Boolean(normalizeValue(entry, entitlements[key]));
}

export function getNumberEntitlement(entitlements: EntitlementMap, key: string): number {
  const entry = ENTITLEMENT_CATALOG.find((item) => item.key === key);
  if (!entry || entry.valueType !== 'number') return 0;
  return Number(normalizeValue(entry, entitlements[key]));
}

export function getStringArrayEntitlement(entitlements: EntitlementMap, key: string): string[] {
  const entry = ENTITLEMENT_CATALOG.find((item) => item.key === key);
  if (!entry || entry.valueType !== 'string_array') return [];
  return normalizeValue(entry, entitlements[key]) as string[];
}

export function summarizeEntitlements(entitlements: EntitlementMap): NormalizedEntitlementSummary {
  return {
    aiManualAskEnabled: getBooleanEntitlement(entitlements, 'ai.manual.ask.enabled'),
    aiManualAskDailyLimit: getNumberEntitlement(entitlements, 'ai.manual.ask.daily_limit'),
    watchlistActiveMatchesLimit: getNumberEntitlement(entitlements, 'watchlist.active_matches.limit'),
    notificationsAllowedChannelTypes: getStringArrayEntitlement(entitlements, 'notifications.channels.allowed_types'),
    notificationsMaxActiveChannels: getNumberEntitlement(entitlements, 'notifications.channels.max_active'),
    proactiveFeedEnabled: getBooleanEntitlement(entitlements, 'recommendations.proactive.feed.enabled'),
    proactiveFeedDailyLimit: getNumberEntitlement(entitlements, 'recommendations.proactive.feed.daily_limit'),
    watchlistFavoriteTeamsLimit: getNumberEntitlement(entitlements, 'watchlist.favorite_teams.limit'),
    watchlistCustomConditionsLimit: getNumberEntitlement(entitlements, 'watchlist.custom_conditions.limit'),
    reportsAdvancedEnabled: getBooleanEntitlement(entitlements, 'reports.advanced.enabled'),
    reportsExportEnabled: getBooleanEntitlement(entitlements, 'reports.export.enabled'),
    historyRetentionDays: getNumberEntitlement(entitlements, 'history.retention.days'),
  };
}

export function buildDailyPeriodKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}
