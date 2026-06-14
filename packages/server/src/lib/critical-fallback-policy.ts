import { config } from '../config.js';
import { query } from '../db/pool.js';

export type CriticalFallbackChannel = 'sms' | 'voice_call';

export interface CriticalFallbackPolicyResult {
  allowed: boolean;
  reason?: string;
}

function isE164PhoneNumber(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^\+[1-9]\d{7,14}$/.test(value.trim());
}

function channelEnabled(channel: CriticalFallbackChannel): boolean {
  return channel === 'sms'
    ? config.criticalFallbackSmsEnabled
    : config.criticalFallbackVoiceCallEnabled;
}

function userDailyLimit(channel: CriticalFallbackChannel): number {
  return channel === 'sms'
    ? config.criticalFallbackSmsMaxPerUserDay
    : config.criticalFallbackVoiceCallMaxPerUserDay;
}

function globalDailyLimit(channel: CriticalFallbackChannel): number {
  return channel === 'sms'
    ? config.criticalFallbackSmsMaxGlobalDay
    : config.criticalFallbackVoiceCallMaxGlobalDay;
}

async function countDeliveredToday(channel: CriticalFallbackChannel, userId?: string): Promise<number> {
  const userFilter = userId ? 'AND delivered.user_id = $2::uuid' : '';
  const params: unknown[] = [channel];
  if (userId) params.push(userId);

  const result = await query<{ count: string }>(
    `WITH delivered AS (
        SELECT d.user_id, c.delivered_at
          FROM user_match_alert_delivery_channels c
          JOIN user_match_alert_deliveries d ON d.id = c.delivery_id
         WHERE c.channel_type = $1
           AND c.status = 'delivered'
           AND c.delivered_at >= date_trunc('day', NOW())
        UNION ALL
        SELECT d.user_id, c.delivered_at
          FROM user_recommendation_delivery_channels c
          JOIN user_recommendation_deliveries d ON d.id = c.delivery_id
         WHERE c.channel_type = $1
           AND c.status = 'delivered'
           AND c.delivered_at >= date_trunc('day', NOW())
      )
      SELECT COUNT(*)::text AS count
        FROM delivered
       WHERE TRUE ${userFilter}`,
    params,
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function isPhoneVerified(
  channel: CriticalFallbackChannel,
  userId: string,
  address: string,
): Promise<boolean> {
  const result = await query<{ verified: boolean }>(
    `SELECT EXISTS (
        SELECT 1
          FROM user_notification_channel_configs
         WHERE user_id = $1
           AND channel_type = $2
           AND BTRIM(COALESCE(address, '')) = $3
           AND metadata->>'phoneVerificationStatus' = 'verified'
      ) AS verified`,
    [userId, channel, address.trim()],
  );
  return result.rows[0]?.verified === true;
}

export async function evaluateCriticalFallbackPolicy(
  channel: CriticalFallbackChannel,
  userId: string,
  address: string | null | undefined,
): Promise<CriticalFallbackPolicyResult> {
  if (!channelEnabled(channel)) {
    return { allowed: false, reason: `${channel} critical fallback is not enabled` };
  }

  const destination = address ?? '';
  if (!isE164PhoneNumber(destination)) {
    return { allowed: false, reason: `${channel} destination must be E.164` };
  }
  if (!await isPhoneVerified(channel, userId, destination)) {
    return { allowed: false, reason: `${channel} destination is not verified` };
  }

  const perUserLimit = userDailyLimit(channel);
  if (!Number.isFinite(perUserLimit) || perUserLimit <= 0) {
    return { allowed: false, reason: `${channel} per-user daily limit is not configured` };
  }
  const userCount = await countDeliveredToday(channel, userId);
  if (userCount >= perUserLimit) {
    return { allowed: false, reason: `${channel} per-user daily limit reached` };
  }

  const globalLimit = globalDailyLimit(channel);
  if (!Number.isFinite(globalLimit) || globalLimit <= 0) {
    return { allowed: false, reason: `${channel} global daily cost guard is not configured` };
  }
  const globalCount = await countDeliveredToday(channel);
  if (globalCount >= globalLimit) {
    return { allowed: false, reason: `${channel} global daily cost guard reached` };
  }

  return { allowed: true };
}
