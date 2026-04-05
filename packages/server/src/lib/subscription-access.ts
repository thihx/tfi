import {
  ENTITLEMENT_CATALOG,
  buildDailyPeriodKey,
  getBooleanEntitlement,
  getNumberEntitlement,
  getStringArrayEntitlement,
  mergeEntitlements,
  type EntitlementMap,
} from './subscription-entitlements.js';
import { consumeUsageIfAvailable, getUsageCounter } from '../repos/entitlement-usage.repo.js';
import { getNotificationChannelConfigs, type NotificationChannelType } from '../repos/notification-channels.repo.js';
import { getCurrentUserSubscription, getSubscriptionPlan, type SubscriptionPlanRow, type SubscriptionStatus, type UserSubscriptionRow } from '../repos/subscriptions.repo.js';
import { countActiveWatchSubscriptionsByUser } from '../repos/watchlist.repo.js';

export interface SubscriptionAccessSnapshot {
  subscription: UserSubscriptionRow | null;
  plan: SubscriptionPlanRow;
  effectiveStatus: SubscriptionStatus | 'free_fallback';
  entitlements: EntitlementMap;
}

export class EntitlementError extends Error {
  statusCode: number;
  code: string;
  details: Record<string, unknown>;

  constructor(
    message: string,
    options: {
      statusCode?: number;
      code: string;
      details?: Record<string, unknown>;
    },
  ) {
    super(message);
    this.name = 'EntitlementError';
    this.statusCode = options.statusCode ?? 403;
    this.code = options.code;
    this.details = options.details ?? {};
  }

  toPayload() {
    return {
      error: this.message,
      code: this.code,
      ...this.details,
    };
  }
}

function formatPlanName(plan: SubscriptionPlanRow): string {
  return (plan.display_name || plan.plan_code || 'current').trim();
}

function buildFallbackFreePlan(): SubscriptionPlanRow {
  return {
    plan_code: 'free',
    display_name: 'Free',
    description: 'Fallback free access plan.',
    billing_interval: 'manual',
    price_amount: '0.00',
    currency: 'USD',
    active: true,
    public: true,
    display_order: 0,
    entitlements: {},
    metadata: { fallback: true },
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  };
}

export async function resolveSubscriptionAccess(userId: string): Promise<SubscriptionAccessSnapshot> {
  const subscription = await getCurrentUserSubscription(userId);
  const resolvedPlan = subscription
    ? await getSubscriptionPlan(subscription.plan_code)
    : await getSubscriptionPlan('free');
  const plan = resolvedPlan ?? buildFallbackFreePlan();

  return {
    subscription,
    plan,
    effectiveStatus: subscription?.status ?? 'free_fallback',
    entitlements: mergeEntitlements(plan.entitlements),
  };
}

export async function getManualAiUsage(userId: string, periodKey = buildDailyPeriodKey()) {
  return getUsageCounter(userId, 'ai.manual.ask.daily_limit', periodKey);
}

export async function consumeManualAiQuota(snapshot: SubscriptionAccessSnapshot, userId: string, context: Record<string, unknown>) {
  const planName = formatPlanName(snapshot.plan);
  if (!getBooleanEntitlement(snapshot.entitlements, 'ai.manual.ask.enabled')) {
    throw new EntitlementError(`Manual Ask AI is not included in the ${planName} plan. Upgrade your subscription to use this feature.`, {
      code: 'MANUAL_AI_DISABLED',
      details: {
        entitlementKey: 'ai.manual.ask.enabled',
        planCode: snapshot.plan.plan_code,
        planName,
      },
    });
  }

  const dailyLimit = getNumberEntitlement(snapshot.entitlements, 'ai.manual.ask.daily_limit');
  const periodKey = buildDailyPeriodKey();
  const consumed = await consumeUsageIfAvailable({
    userId,
    entitlementKey: 'ai.manual.ask.daily_limit',
    periodKey,
    limit: dailyLimit,
    quantity: 1,
    source: 'manual_ai',
    context,
  });

  if (!consumed.allowed) {
    throw new EntitlementError(`You have used ${consumed.usedCount}/${dailyLimit} Manual Ask AI requests today on the ${planName} plan. Try again tomorrow or upgrade your subscription.`, {
      statusCode: 429,
      code: 'MANUAL_AI_DAILY_LIMIT_REACHED',
      details: {
        entitlementKey: 'ai.manual.ask.daily_limit',
        planCode: snapshot.plan.plan_code,
        planName,
        periodKey,
        limit: dailyLimit,
        used: consumed.usedCount,
      },
    });
  }

  return {
    periodKey,
    limit: dailyLimit,
    used: consumed.usedCount,
  };
}

export async function assertWatchlistCapacityAvailable(snapshot: SubscriptionAccessSnapshot, userId: string) {
  return assertWatchlistCapacityForAdditional(snapshot, userId, 1);
}

export async function assertWatchlistCapacityForAdditional(
  snapshot: SubscriptionAccessSnapshot,
  userId: string,
  additionalCount: number,
) {
  const planName = formatPlanName(snapshot.plan);
  const requested = Math.max(0, Math.floor(additionalCount));
  if (requested <= 0) return;
  const limit = getNumberEntitlement(snapshot.entitlements, 'watchlist.active_matches.limit');
  const activeCount = await countActiveWatchSubscriptionsByUser(userId);
  if (activeCount + requested > limit) {
    throw new EntitlementError(`You have reached the active watchlist limit on the ${planName} plan (${activeCount}/${limit} used). Remove a watched match or upgrade your subscription.`, {
      code: 'WATCHLIST_ACTIVE_LIMIT_REACHED',
      details: {
        entitlementKey: 'watchlist.active_matches.limit',
        planCode: snapshot.plan.plan_code,
        planName,
        limit,
        used: activeCount,
        requested,
      },
    });
  }
}

export async function assertNotificationChannelAllowed(
  snapshot: SubscriptionAccessSnapshot,
  userId: string,
  channelType: NotificationChannelType,
  enabling: boolean,
) {
  if (!enabling) return;

  const planName = formatPlanName(snapshot.plan);
  const allowedTypes = getStringArrayEntitlement(snapshot.entitlements, 'notifications.channels.allowed_types');
  if (!allowedTypes.includes(channelType)) {
    throw new EntitlementError(`${channelType} notifications are not included in the ${planName} plan. Upgrade your subscription to enable this channel.`, {
      code: 'NOTIFICATION_CHANNEL_NOT_ALLOWED',
      details: {
        entitlementKey: 'notifications.channels.allowed_types',
        planCode: snapshot.plan.plan_code,
        planName,
        channelType,
        allowedTypes,
      },
    });
  }

  const configs = await getNotificationChannelConfigs(userId);
  const current = configs.find((item) => item.channelType === channelType) ?? null;
  const enabledCount = configs.filter((item) => item.enabled).length;
  const maxActive = getNumberEntitlement(snapshot.entitlements, 'notifications.channels.max_active');
  const nextEnabledCount = current?.enabled ? enabledCount : enabledCount + 1;

  if (nextEnabledCount > maxActive) {
    throw new EntitlementError(`You have already enabled ${enabledCount}/${maxActive} notification channels on the ${planName} plan. Disable one or upgrade your subscription.`, {
      code: 'NOTIFICATION_CHANNEL_LIMIT_REACHED',
      details: {
        entitlementKey: 'notifications.channels.max_active',
        planCode: snapshot.plan.plan_code,
        planName,
        limit: maxActive,
        used: enabledCount,
      },
    });
  }
}

export async function buildSubscriptionSnapshotResponse(userId: string) {
  const snapshot = await resolveSubscriptionAccess(userId);
  const periodKey = buildDailyPeriodKey();
  const manualUsage = await getManualAiUsage(userId, periodKey);

  return {
    plan: snapshot.plan,
    subscription: snapshot.subscription,
    effectiveStatus: snapshot.effectiveStatus,
    entitlements: snapshot.entitlements,
    usage: {
      manualAiDaily: {
        entitlementKey: 'ai.manual.ask.daily_limit',
        periodKey,
        limit: getNumberEntitlement(snapshot.entitlements, 'ai.manual.ask.daily_limit'),
        used: manualUsage?.used_count ?? 0,
      },
    },
    catalog: ENTITLEMENT_CATALOG,
  };
}

export function sendEntitlementError(error: unknown) {
  if (error instanceof EntitlementError) {
    return {
      statusCode: error.statusCode,
      payload: error.toPayload(),
    };
  }
  return null;
}
