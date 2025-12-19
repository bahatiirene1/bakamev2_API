/**
 * SubscriptionService Database Adapter
 * Implements SubscriptionServiceDb interface using Supabase
 *
 * Reference: docs/stage-2-service-layer.md Section 3.8
 *
 * SCOPE: Billing, plans, and entitlement enforcement
 *
 * Policy Enforcement: File storage quotas (Stage 1 Section 9.5)
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  Plan,
  Subscription,
  SubscriptionStatus,
  UsageSummary,
  Entitlement,
} from '@/types/index.js';

import type { SubscriptionServiceDb } from './subscription.service.js';

/**
 * Database row types
 */
interface PlanRow {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  entitlements: Array<{
    featureCode: string;
    value: {
      enabled?: boolean;
      limit?: number;
      config?: Record<string, unknown>;
    };
  }>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface SubscriptionRow {
  id: string;
  user_id: string;
  plan_id: string;
  status: string;
  current_period_start: string;
  current_period_end: string;
  external_id: string | null;
  created_at: string;
  updated_at: string;
  plan?: PlanRow;
}

interface UsageRecordRow {
  feature_code: string;
  quantity: number;
}

/**
 * Map database row to Plan entity
 */
function mapRowToPlan(row: PlanRow): Plan {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isActive: row.is_active,
    entitlements: row.entitlements as Entitlement[],
    metadata: row.metadata,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Map database row to Subscription entity
 */
function mapRowToSubscription(row: SubscriptionRow, plan: Plan): Subscription {
  return {
    id: row.id,
    userId: row.user_id,
    planId: row.plan_id,
    plan,
    status: row.status as SubscriptionStatus,
    currentPeriodStart: new Date(row.current_period_start),
    currentPeriodEnd: new Date(row.current_period_end),
    externalId: row.external_id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Create SubscriptionServiceDb implementation using Supabase
 */
export function createSubscriptionServiceDb(
  supabase: SupabaseClient
): SubscriptionServiceDb {
  return {
    /**
     * List all active plans
     */
    async listPlans(): Promise<Plan[]> {
      const { data, error } = await supabase
        .from('plans')
        .select('*')
        .eq('is_active', true)
        .order('name', { ascending: true });

      if (error !== null) {
        throw new Error(`Failed to list plans: ${error.message}`);
      }

      return (data as PlanRow[]).map(mapRowToPlan);
    },

    /**
     * Get plan by ID
     */
    async getPlan(planId: string): Promise<Plan | null> {
      const { data, error } = await supabase
        .from('plans')
        .select('*')
        .eq('id', planId)
        .single();

      if (error !== null) {
        if (error.code === 'PGRST116') {
          return null; // Not found
        }
        throw new Error(`Failed to get plan: ${error.message}`);
      }

      return mapRowToPlan(data as PlanRow);
    },

    /**
     * Get subscription by ID
     */
    async getSubscription(
      subscriptionId: string
    ): Promise<Subscription | null> {
      const { data, error } = await supabase
        .from('subscriptions')
        .select('*, plan:plans(*)')
        .eq('id', subscriptionId)
        .single();

      if (error !== null) {
        if (error.code === 'PGRST116') {
          return null; // Not found
        }
        throw new Error(`Failed to get subscription: ${error.message}`);
      }

      const row = data as SubscriptionRow & { plan: PlanRow };
      const plan = mapRowToPlan(row.plan);
      return mapRowToSubscription(row, plan);
    },

    /**
     * Get subscription by user ID
     */
    async getSubscriptionByUserId(
      userId: string
    ): Promise<Subscription | null> {
      const { data, error } = await supabase
        .from('subscriptions')
        .select('*, plan:plans(*)')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error !== null) {
        throw new Error(`Failed to get subscription by user: ${error.message}`);
      }

      if (data === null) {
        return null;
      }

      const row = data as SubscriptionRow & { plan: PlanRow };
      const plan = mapRowToPlan(row.plan);
      return mapRowToSubscription(row, plan);
    },

    /**
     * Create a new subscription
     */
    async createSubscription(params: {
      userId: string;
      planId: string;
      externalId?: string;
      periodStart: Date;
      periodEnd: Date;
    }): Promise<Subscription> {
      const insertData: Record<string, unknown> = {
        user_id: params.userId,
        plan_id: params.planId,
        current_period_start: params.periodStart.toISOString(),
        current_period_end: params.periodEnd.toISOString(),
        status: 'active',
      };

      if (params.externalId !== undefined) {
        insertData.external_id = params.externalId;
      }

      const { data, error } = await supabase
        .from('subscriptions')
        .insert(insertData)
        .select('*, plan:plans(*)')
        .single();

      if (error !== null) {
        throw new Error(`Failed to create subscription: ${error.message}`);
      }

      const row = data as SubscriptionRow & { plan: PlanRow };
      const plan = mapRowToPlan(row.plan);
      return mapRowToSubscription(row, plan);
    },

    /**
     * Update subscription status
     */
    async updateSubscriptionStatus(
      subscriptionId: string,
      status: SubscriptionStatus
    ): Promise<Subscription> {
      const { data, error } = await supabase
        .from('subscriptions')
        .update({ status })
        .eq('id', subscriptionId)
        .select('*, plan:plans(*)')
        .single();

      if (error !== null) {
        throw new Error(
          `Failed to update subscription status: ${error.message}`
        );
      }

      const row = data as SubscriptionRow & { plan: PlanRow };
      const plan = mapRowToPlan(row.plan);
      return mapRowToSubscription(row, plan);
    },

    /**
     * Update subscription plan
     */
    async updateSubscriptionPlan(
      subscriptionId: string,
      newPlanId: string
    ): Promise<Subscription> {
      const { data, error } = await supabase
        .from('subscriptions')
        .update({ plan_id: newPlanId })
        .eq('id', subscriptionId)
        .select('*, plan:plans(*)')
        .single();

      if (error !== null) {
        throw new Error(`Failed to update subscription plan: ${error.message}`);
      }

      const row = data as SubscriptionRow & { plan: PlanRow };
      const plan = mapRowToPlan(row.plan);
      return mapRowToSubscription(row, plan);
    },

    /**
     * Get usage for a feature during a period
     */
    async getUsageForPeriod(
      userId: string,
      featureCode: string,
      periodStart: Date,
      periodEnd: Date
    ): Promise<number> {
      const { data, error } = await supabase
        .from('usage_records')
        .select('quantity')
        .eq('user_id', userId)
        .eq('feature_code', featureCode)
        .gte('recorded_at', periodStart.toISOString())
        .lt('recorded_at', periodEnd.toISOString());

      if (error !== null) {
        throw new Error(`Failed to get usage: ${error.message}`);
      }

      const rows = data as UsageRecordRow[];
      return rows.reduce((sum, row) => sum + row.quantity, 0);
    },

    /**
     * Record usage (idempotent with requestId/invocationId)
     */
    async recordUsage(params: {
      userId: string;
      featureCode: string;
      quantity: number;
      requestId?: string;
      invocationId?: string;
    }): Promise<void> {
      const insertData: Record<string, unknown> = {
        user_id: params.userId,
        feature_code: params.featureCode,
        quantity: params.quantity,
      };

      if (params.requestId !== undefined) {
        insertData.request_id = params.requestId;
      }

      if (params.invocationId !== undefined) {
        insertData.invocation_id = params.invocationId;
      }

      // Use insert with ON CONFLICT DO NOTHING for idempotency
      // When requestId or invocationId is provided, the unique indexes handle deduplication
      const { error } = await supabase.from('usage_records').insert(insertData);

      if (error !== null) {
        // Ignore unique constraint violations (idempotent)
        if (error.code !== '23505') {
          throw new Error(`Failed to record usage: ${error.message}`);
        }
      }
    },

    /**
     * Get usage summary for a period
     */
    async getUsageSummary(
      userId: string,
      periodStart: Date,
      periodEnd: Date
    ): Promise<UsageSummary[]> {
      const { data, error } = await supabase
        .from('usage_records')
        .select('feature_code, quantity')
        .eq('user_id', userId)
        .gte('recorded_at', periodStart.toISOString())
        .lt('recorded_at', periodEnd.toISOString());

      if (error !== null) {
        throw new Error(`Failed to get usage summary: ${error.message}`);
      }

      // Group by feature_code and sum quantities
      const summaryMap = new Map<string, number>();
      for (const row of data as UsageRecordRow[]) {
        const current = summaryMap.get(row.feature_code) ?? 0;
        summaryMap.set(row.feature_code, current + row.quantity);
      }

      const summaries: UsageSummary[] = [];
      for (const [featureCode, quantity] of summaryMap) {
        summaries.push({
          featureCode,
          quantity,
          periodStart,
          periodEnd,
        });
      }

      return summaries;
    },
  };
}
