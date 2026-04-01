import { transaction, query } from '../db/pool.js';

export interface EntitlementUsageCounterRow {
  user_id: string;
  entitlement_key: string;
  period_key: string;
  used_count: number;
  updated_at: string;
}

export interface ConsumeEntitlementUsageInput {
  userId: string;
  entitlementKey: string;
  periodKey: string;
  limit: number;
  quantity?: number;
  source?: string;
  context?: Record<string, unknown>;
}

function normalizeJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function getUsageCounter(
  userId: string,
  entitlementKey: string,
  periodKey: string,
): Promise<EntitlementUsageCounterRow | null> {
  const result = await query<EntitlementUsageCounterRow>(
    `SELECT *
       FROM entitlement_usage_counters
      WHERE user_id = $1
        AND entitlement_key = $2
        AND period_key = $3
      LIMIT 1`,
    [userId, entitlementKey, periodKey],
  );
  return result.rows[0] ?? null;
}

export async function consumeUsageIfAvailable(
  input: ConsumeEntitlementUsageInput,
): Promise<{ allowed: boolean; usedCount: number }> {
  const quantity = Math.max(1, Math.floor(input.quantity ?? 1));

  return transaction(async (client) => {
    const existing = await client.query<EntitlementUsageCounterRow>(
      `SELECT *
         FROM entitlement_usage_counters
        WHERE user_id = $1
          AND entitlement_key = $2
          AND period_key = $3
        FOR UPDATE`,
      [input.userId, input.entitlementKey, input.periodKey],
    );

    const currentUsed = existing.rows[0]?.used_count ?? 0;
    if (currentUsed + quantity > input.limit) {
      return { allowed: false, usedCount: currentUsed };
    }

    const nextUsed = currentUsed + quantity;
    await client.query(
      `INSERT INTO entitlement_usage_counters (
          user_id,
          entitlement_key,
          period_key,
          used_count,
          updated_at
       )
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id, entitlement_key, period_key) DO UPDATE
         SET used_count = EXCLUDED.used_count,
             updated_at = NOW()`,
      [input.userId, input.entitlementKey, input.periodKey, nextUsed],
    );

    await client.query(
      `INSERT INTO entitlement_usage_events (
          user_id,
          entitlement_key,
          period_key,
          quantity,
          source,
          context
       )
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.userId,
        input.entitlementKey,
        input.periodKey,
        quantity,
        input.source ?? 'runtime',
        JSON.stringify(normalizeJsonObject(input.context)),
      ],
    );

    return { allowed: true, usedCount: nextUsed };
  });
}
