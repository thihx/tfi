import { query, transaction } from '../db/pool.js';
import type { EntitlementMap } from '../lib/subscription-entitlements.js';
import type { UserRow } from './users.repo.js';

export type SubscriptionBillingInterval = 'manual' | 'month' | 'year';
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired' | 'paused';

export interface SubscriptionPlanRow {
  plan_code: string;
  display_name: string;
  description: string;
  billing_interval: SubscriptionBillingInterval;
  price_amount: string;
  currency: string;
  active: boolean;
  public: boolean;
  display_order: number;
  entitlements: EntitlementMap;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface UserSubscriptionRow {
  id: number;
  user_id: string;
  plan_code: string;
  status: SubscriptionStatus;
  provider: string;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  started_at: string;
  current_period_start: string | null;
  current_period_end: string | null;
  trial_ends_at: string | null;
  cancel_at_period_end: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AdminSubscriptionUserRow extends UserRow {
  subscription_plan_code: string | null;
  subscription_status: SubscriptionStatus | null;
  subscription_provider: string | null;
  subscription_current_period_end: string | null;
  subscription_cancel_at_period_end: boolean | null;
  subscription_updated_at: string | null;
}

export interface AdminSubscriptionPlanPatch {
  display_name?: string;
  description?: string;
  billing_interval?: SubscriptionBillingInterval;
  price_amount?: number;
  currency?: string;
  active?: boolean;
  public?: boolean;
  display_order?: number;
  entitlements?: EntitlementMap;
  metadata?: Record<string, unknown>;
}

export interface AdminUserSubscriptionInput {
  planCode: string;
  status: SubscriptionStatus;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  metadata?: Record<string, unknown>;
}

const CURRENT_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = ['trialing', 'active', 'past_due', 'paused'];

function normalizeJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function mapPlanRow(row: Omit<SubscriptionPlanRow, 'entitlements' | 'metadata'> & {
  entitlements: EntitlementMap | null;
  metadata: Record<string, unknown> | null;
}): SubscriptionPlanRow {
  return {
    ...row,
    entitlements: normalizeJsonObject(row.entitlements),
    metadata: normalizeJsonObject(row.metadata),
  };
}

function mapSubscriptionRow(row: Omit<UserSubscriptionRow, 'metadata'> & {
  metadata: Record<string, unknown> | null;
}): UserSubscriptionRow {
  return {
    ...row,
    metadata: normalizeJsonObject(row.metadata),
  };
}

export async function listSubscriptionPlans(): Promise<SubscriptionPlanRow[]> {
  const result = await query<SubscriptionPlanRow>(
    `SELECT *
       FROM subscription_plans
      ORDER BY display_order ASC, plan_code ASC`,
  );
  return result.rows.map((row) => mapPlanRow(row));
}

export async function getSubscriptionPlan(planCode: string): Promise<SubscriptionPlanRow | null> {
  const result = await query<SubscriptionPlanRow>(
    `SELECT *
       FROM subscription_plans
      WHERE plan_code = $1
      LIMIT 1`,
    [planCode],
  );
  return result.rows[0] ? mapPlanRow(result.rows[0]) : null;
}

export async function updateSubscriptionPlan(
  planCode: string,
  patch: AdminSubscriptionPlanPatch,
): Promise<SubscriptionPlanRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [planCode];

  const pushSet = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  if (patch.display_name !== undefined) pushSet('display_name', patch.display_name.trim());
  if (patch.description !== undefined) pushSet('description', patch.description);
  if (patch.billing_interval !== undefined) pushSet('billing_interval', patch.billing_interval);
  if (patch.price_amount !== undefined) pushSet('price_amount', patch.price_amount);
  if (patch.currency !== undefined) pushSet('currency', patch.currency.trim().toUpperCase());
  if (patch.active !== undefined) pushSet('active', patch.active);
  if (patch.public !== undefined) pushSet('public', patch.public);
  if (patch.display_order !== undefined) pushSet('display_order', patch.display_order);
  if (patch.entitlements !== undefined) pushSet('entitlements', JSON.stringify(normalizeJsonObject(patch.entitlements)));
  if (patch.metadata !== undefined) pushSet('metadata', JSON.stringify(normalizeJsonObject(patch.metadata)));

  if (sets.length === 0) {
    return getSubscriptionPlan(planCode);
  }

  const result = await query<SubscriptionPlanRow>(
    `UPDATE subscription_plans
        SET ${sets.join(', ')},
            updated_at = NOW()
      WHERE plan_code = $1
      RETURNING *`,
    values,
  );
  return result.rows[0] ? mapPlanRow(result.rows[0]) : null;
}

export async function getCurrentUserSubscription(userId: string): Promise<UserSubscriptionRow | null> {
  const result = await query<UserSubscriptionRow>(
    `SELECT *
       FROM user_subscriptions
      WHERE user_id = $1
        AND status = ANY($2::text[])
      ORDER BY updated_at DESC, id DESC
      LIMIT 1`,
    [userId, CURRENT_SUBSCRIPTION_STATUSES],
  );
  return result.rows[0] ? mapSubscriptionRow(result.rows[0]) : null;
}

export async function getLatestUserSubscription(userId: string): Promise<UserSubscriptionRow | null> {
  const result = await query<UserSubscriptionRow>(
    `SELECT *
       FROM user_subscriptions
      WHERE user_id = $1
      ORDER BY updated_at DESC, id DESC
      LIMIT 1`,
    [userId],
  );
  return result.rows[0] ? mapSubscriptionRow(result.rows[0]) : null;
}

export async function listAdminUserSubscriptions(): Promise<AdminSubscriptionUserRow[]> {
  const result = await query<AdminSubscriptionUserRow>(
    `SELECT
        u.*,
        latest_sub.plan_code AS subscription_plan_code,
        latest_sub.status AS subscription_status,
        latest_sub.provider AS subscription_provider,
        latest_sub.current_period_end AS subscription_current_period_end,
        latest_sub.cancel_at_period_end AS subscription_cancel_at_period_end,
        latest_sub.updated_at AS subscription_updated_at
       FROM users u
       LEFT JOIN LATERAL (
         SELECT s.*
           FROM user_subscriptions s
          WHERE s.user_id = u.id
          ORDER BY s.updated_at DESC, s.id DESC
          LIMIT 1
       ) latest_sub ON TRUE
      ORDER BY
        CASE u.role
          WHEN 'owner' THEN 0
          WHEN 'admin' THEN 1
          ELSE 2
        END,
        LOWER(u.email) ASC`,
  );
  return result.rows;
}

export async function assignUserSubscription(
  userId: string,
  input: AdminUserSubscriptionInput,
): Promise<UserSubscriptionRow> {
  return transaction(async (client) => {
    const planResult = await client.query<{ plan_code: string }>(
      'SELECT plan_code FROM subscription_plans WHERE plan_code = $1 LIMIT 1',
      [input.planCode],
    );
    if (!planResult.rows[0]) {
      throw new Error('Unknown subscription plan');
    }

    const currentResult = await client.query<UserSubscriptionRow>(
      `SELECT *
         FROM user_subscriptions
        WHERE user_id = $1
          AND status = ANY($2::text[])
        ORDER BY updated_at DESC, id DESC
        LIMIT 1`,
      [userId, CURRENT_SUBSCRIPTION_STATUSES],
    );
    const current = currentResult.rows[0] ? mapSubscriptionRow(currentResult.rows[0]) : null;

    const isCurrentStatus = CURRENT_SUBSCRIPTION_STATUSES.includes(input.status);
    const metadata = JSON.stringify(normalizeJsonObject(input.metadata));

    if (current && current.plan_code === input.planCode) {
      const updated = await client.query<UserSubscriptionRow>(
        `UPDATE user_subscriptions
            SET status = $2,
                current_period_end = $3,
                cancel_at_period_end = $4,
                metadata = $5,
                updated_at = NOW()
          WHERE id = $1
        RETURNING *`,
        [
          current.id,
          input.status,
          input.currentPeriodEnd ?? null,
          input.cancelAtPeriodEnd ?? false,
          metadata,
        ],
      );
      return mapSubscriptionRow(updated.rows[0]!);
    }

    if (current) {
      await client.query(
        `UPDATE user_subscriptions
            SET status = 'expired',
                updated_at = NOW()
          WHERE id = $1`,
        [current.id],
      );
    }

    const inserted = await client.query<UserSubscriptionRow>(
      `INSERT INTO user_subscriptions (
          user_id,
          plan_code,
          status,
          provider,
          started_at,
          current_period_start,
          current_period_end,
          cancel_at_period_end,
          metadata
       )
       VALUES (
         $1,
         $2,
         $3,
         'manual',
         NOW(),
         CASE WHEN $3 = 'trialing' OR $3 = 'active' OR $3 = 'past_due' OR $3 = 'paused' THEN NOW() ELSE NULL END,
         $4,
         $5,
         $6
       )
       RETURNING *`,
      [
        userId,
        input.planCode,
        isCurrentStatus ? input.status : input.status,
        input.currentPeriodEnd ?? null,
        input.cancelAtPeriodEnd ?? false,
        metadata,
      ],
    );
    return mapSubscriptionRow(inserted.rows[0]!);
  });
}
