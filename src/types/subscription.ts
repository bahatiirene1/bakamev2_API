/**
 * Subscription Domain Types
 * Phase 2: TDD - Type definitions for SubscriptionService
 *
 * Reference: docs/stage-2-service-layer.md Section 3.8
 *
 * SCOPE: Billing, plans, and entitlement enforcement
 *
 * Policy Enforcement: File storage quotas (Stage 1 Section 9.5)
 */

/**
 * Subscription status
 */
export type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'expired';

/**
 * Entitlement value - can be a boolean, numeric limit, or config object
 */
export interface EntitlementValue {
  enabled?: boolean;
  limit?: number;
  config?: Record<string, unknown>;
}

/**
 * Entitlement - a feature with its value
 */
export interface Entitlement {
  featureCode: string;
  value: EntitlementValue;
}

/**
 * Plan entity - defines what features a subscription includes
 */
export interface Plan {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  entitlements: Entitlement[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Subscription entity - user's active subscription
 */
export interface Subscription {
  id: string;
  userId: string;
  planId: string;
  plan: Plan;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  externalId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Usage limit check result
 */
export interface UsageLimitCheck {
  allowed: boolean;
  currentUsage: number;
  limit: number | null; // null = unlimited
  remaining: number | null;
  resetsAt: Date;
}

/**
 * Usage summary for a feature
 */
export interface UsageSummary {
  featureCode: string;
  quantity: number;
  periodStart: Date;
  periodEnd: Date;
}

/**
 * Usage record entity
 */
export interface UsageRecord {
  id: string;
  userId: string;
  featureCode: string;
  quantity: number;
  requestId: string | null;
  invocationId: string | null;
  recordedAt: Date;
}

/**
 * Parameters for creating a subscription
 */
export interface CreateSubscriptionParams {
  userId: string;
  planId: string;
  externalId?: string;
  periodStart: Date;
  periodEnd: Date;
}

/**
 * Parameters for recording usage
 */
export interface RecordUsageParams {
  userId: string;
  featureCode: string;
  quantity: number;
  requestId?: string;
  invocationId?: string;
}

/**
 * Parameters for getting usage summary
 */
export interface GetUsageSummaryParams {
  periodStart: Date;
  periodEnd: Date;
}
