/**
 * SubscriptionService Implementation
 * Phase 2: TDD - RED phase (stub only)
 *
 * Reference: docs/stage-2-service-layer.md Section 3.8
 *
 * SCOPE: Billing, plans, and entitlement enforcement
 *
 * Policy Enforcement: File storage quotas (Stage 1 Section 9.5)
 *
 * GUARDRAILS:
 * - Only SYSTEM_ACTOR can create/modify subscriptions (payment webhooks)
 * - Users can only access their own subscription
 * - AI_ACTOR cannot modify subscriptions
 * - Admins can access any subscription
 * - Usage recording is idempotent (requestId/invocationId)
 *
 * Dependencies: AuditService
 */

import type {
  ActorContext,
  Plan,
  Subscription,
  SubscriptionStatus,
  EntitlementValue,
  UsageLimitCheck,
  UsageSummary,
  CreateSubscriptionParams,
  RecordUsageParams,
  GetUsageSummaryParams,
  Result,
  AuditEvent,
} from '@/types/index.js';
import { success, failure } from '@/types/index.js';

/**
 * Database abstraction interface for SubscriptionService
 */
export interface SubscriptionServiceDb {
  listPlans: () => Promise<Plan[]>;
  getPlan: (planId: string) => Promise<Plan | null>;
  getSubscription: (subscriptionId: string) => Promise<Subscription | null>;
  getSubscriptionByUserId: (userId: string) => Promise<Subscription | null>;
  createSubscription: (params: {
    userId: string;
    planId: string;
    externalId?: string;
    periodStart: Date;
    periodEnd: Date;
  }) => Promise<Subscription>;
  updateSubscriptionStatus: (
    subscriptionId: string,
    status: SubscriptionStatus
  ) => Promise<Subscription>;
  updateSubscriptionPlan: (
    subscriptionId: string,
    newPlanId: string
  ) => Promise<Subscription>;
  getUsageForPeriod: (
    userId: string,
    featureCode: string,
    periodStart: Date,
    periodEnd: Date
  ) => Promise<number>;
  recordUsage: (params: {
    userId: string;
    featureCode: string;
    quantity: number;
    requestId?: string;
    invocationId?: string;
  }) => Promise<void>;
  getUsageSummary: (
    userId: string,
    periodStart: Date,
    periodEnd: Date
  ) => Promise<UsageSummary[]>;
}

/**
 * Minimal AuditService interface
 */
export interface SubscriptionServiceAudit {
  log: (actor: ActorContext, event: AuditEvent) => Promise<Result<void>>;
}

/**
 * SubscriptionService interface
 */
export interface SubscriptionService {
  listPlans(actor: ActorContext): Promise<Result<Plan[]>>;
  getPlan(actor: ActorContext, planId: string): Promise<Result<Plan>>;
  getSubscription(
    actor: ActorContext,
    userId: string
  ): Promise<Result<Subscription | null>>;
  createSubscription(
    actor: ActorContext,
    params: CreateSubscriptionParams
  ): Promise<Result<Subscription>>;
  updateSubscriptionStatus(
    actor: ActorContext,
    subscriptionId: string,
    status: SubscriptionStatus
  ): Promise<Result<void>>;
  changePlan(
    actor: ActorContext,
    subscriptionId: string,
    newPlanId: string
  ): Promise<Result<Subscription>>;
  hasEntitlement(
    actor: ActorContext,
    userId: string,
    featureCode: string
  ): Promise<Result<boolean>>;
  getEntitlementValue(
    actor: ActorContext,
    userId: string,
    featureCode: string
  ): Promise<Result<EntitlementValue | null>>;
  checkUsageLimit(
    actor: ActorContext,
    userId: string,
    featureCode: string
  ): Promise<Result<UsageLimitCheck>>;
  recordUsage(
    actor: ActorContext,
    params: RecordUsageParams
  ): Promise<Result<void>>;
  getUsageSummary(
    actor: ActorContext,
    userId: string,
    params: GetUsageSummaryParams
  ): Promise<Result<UsageSummary[]>>;
}

/**
 * Create SubscriptionService instance
 */
export function createSubscriptionService(deps: {
  db: SubscriptionServiceDb;
  auditService: SubscriptionServiceAudit;
}): SubscriptionService {
  const { db, auditService } = deps;

  // ─────────────────────────────────────────────────────────────
  // HELPER FUNCTIONS
  // ─────────────────────────────────────────────────────────────

  function isSystemActor(actor: ActorContext): boolean {
    return actor.type === 'system';
  }

  function isAdminActor(actor: ActorContext): boolean {
    return actor.type === 'admin';
  }

  function canAccessUserData(
    actor: ActorContext,
    targetUserId: string
  ): boolean {
    if (isSystemActor(actor) || isAdminActor(actor)) {
      return true;
    }
    return actor.userId === targetUserId;
  }

  function findEntitlement(
    plan: Plan,
    featureCode: string
  ): EntitlementValue | null {
    const entitlement = plan.entitlements.find(
      (e) => e.featureCode === featureCode
    );
    return entitlement?.value ?? null;
  }

  // ─────────────────────────────────────────────────────────────
  // SERVICE IMPLEMENTATION
  // ─────────────────────────────────────────────────────────────

  return {
    async listPlans(_actor: ActorContext): Promise<Result<Plan[]>> {
      const plans = await db.listPlans();
      return success(plans);
    },

    async getPlan(_actor: ActorContext, planId: string): Promise<Result<Plan>> {
      const plan = await db.getPlan(planId);
      if (plan === null) {
        return failure('NOT_FOUND', `Plan not found: ${planId}`);
      }
      return success(plan);
    },

    async getSubscription(
      actor: ActorContext,
      userId: string
    ): Promise<Result<Subscription | null>> {
      if (!canAccessUserData(actor, userId)) {
        return failure(
          'PERMISSION_DENIED',
          'Cannot access subscription for another user'
        );
      }

      const subscription = await db.getSubscriptionByUserId(userId);
      return success(subscription);
    },

    async createSubscription(
      actor: ActorContext,
      params: CreateSubscriptionParams
    ): Promise<Result<Subscription>> {
      if (!isSystemActor(actor)) {
        return failure(
          'PERMISSION_DENIED',
          'Only SYSTEM_ACTOR can create subscriptions'
        );
      }

      const plan = await db.getPlan(params.planId);
      if (plan === null) {
        return failure('NOT_FOUND', `Plan not found: ${params.planId}`);
      }

      const existingSubscription = await db.getSubscriptionByUserId(
        params.userId
      );
      if (
        existingSubscription !== null &&
        existingSubscription.status === 'active'
      ) {
        return failure('CONFLICT', 'User already has an active subscription');
      }

      const createParams: Parameters<typeof db.createSubscription>[0] = {
        userId: params.userId,
        planId: params.planId,
        periodStart: params.periodStart,
        periodEnd: params.periodEnd,
      };
      if (params.externalId !== undefined) {
        createParams.externalId = params.externalId;
      }
      const subscription = await db.createSubscription(createParams);

      await auditService.log(actor, {
        action: 'subscription.created',
        resourceType: 'subscription',
        resourceId: subscription.id,
        details: {
          userId: params.userId,
          planId: params.planId,
        },
      });

      return success(subscription);
    },

    async updateSubscriptionStatus(
      actor: ActorContext,
      subscriptionId: string,
      status: SubscriptionStatus
    ): Promise<Result<void>> {
      if (!isSystemActor(actor)) {
        return failure(
          'PERMISSION_DENIED',
          'Only SYSTEM_ACTOR can update subscription status'
        );
      }

      const subscription = await db.getSubscription(subscriptionId);
      if (subscription === null) {
        return failure(
          'NOT_FOUND',
          `Subscription not found: ${subscriptionId}`
        );
      }

      await db.updateSubscriptionStatus(subscriptionId, status);

      await auditService.log(actor, {
        action: 'subscription.status_updated',
        resourceType: 'subscription',
        resourceId: subscriptionId,
        details: {
          previousStatus: subscription.status,
          newStatus: status,
        },
      });

      return success(undefined);
    },

    async changePlan(
      actor: ActorContext,
      subscriptionId: string,
      newPlanId: string
    ): Promise<Result<Subscription>> {
      if (!isSystemActor(actor)) {
        return failure(
          'PERMISSION_DENIED',
          'Only SYSTEM_ACTOR can change subscription plan'
        );
      }

      const subscription = await db.getSubscription(subscriptionId);
      if (subscription === null) {
        return failure(
          'NOT_FOUND',
          `Subscription not found: ${subscriptionId}`
        );
      }

      const newPlan = await db.getPlan(newPlanId);
      if (newPlan === null) {
        return failure('NOT_FOUND', `Plan not found: ${newPlanId}`);
      }

      const updatedSubscription = await db.updateSubscriptionPlan(
        subscriptionId,
        newPlanId
      );

      await auditService.log(actor, {
        action: 'subscription.plan_changed',
        resourceType: 'subscription',
        resourceId: subscriptionId,
        details: {
          previousPlanId: subscription.planId,
          newPlanId,
        },
      });

      return success(updatedSubscription);
    },

    async hasEntitlement(
      _actor: ActorContext,
      userId: string,
      featureCode: string
    ): Promise<Result<boolean>> {
      const subscription = await db.getSubscriptionByUserId(userId);
      if (subscription === null || subscription.status !== 'active') {
        return success(false);
      }

      const entitlementValue = findEntitlement(subscription.plan, featureCode);
      if (entitlementValue === null) {
        return success(false);
      }

      // If entitlement exists, check if it's explicitly enabled or has a limit
      if (entitlementValue.enabled !== undefined) {
        return success(entitlementValue.enabled);
      }

      // If there's a limit or config, entitlement exists
      return success(
        entitlementValue.limit !== undefined ||
          entitlementValue.config !== undefined
      );
    },

    async getEntitlementValue(
      _actor: ActorContext,
      userId: string,
      featureCode: string
    ): Promise<Result<EntitlementValue | null>> {
      const subscription = await db.getSubscriptionByUserId(userId);
      if (subscription === null || subscription.status !== 'active') {
        return success(null);
      }

      const entitlementValue = findEntitlement(subscription.plan, featureCode);
      return success(entitlementValue);
    },

    async checkUsageLimit(
      _actor: ActorContext,
      userId: string,
      featureCode: string
    ): Promise<Result<UsageLimitCheck>> {
      const subscription = await db.getSubscriptionByUserId(userId);

      // Calculate period dates
      const now = new Date();
      const periodStart =
        subscription?.currentPeriodStart ??
        new Date(now.getFullYear(), now.getMonth(), 1);
      const periodEnd =
        subscription?.currentPeriodEnd ??
        new Date(now.getFullYear(), now.getMonth() + 1, 1);

      const currentUsage = await db.getUsageForPeriod(
        userId,
        featureCode,
        periodStart,
        periodEnd
      );

      if (subscription === null || subscription.status !== 'active') {
        // No subscription - return unlimited (null limit)
        return success({
          allowed: true,
          currentUsage,
          limit: null,
          remaining: null,
          resetsAt: periodEnd,
        });
      }

      const entitlementValue = findEntitlement(subscription.plan, featureCode);
      const limit = entitlementValue?.limit ?? null;

      if (limit === null) {
        // Feature has no limit
        return success({
          allowed: true,
          currentUsage,
          limit: null,
          remaining: null,
          resetsAt: periodEnd,
        });
      }

      const remaining = Math.max(0, limit - currentUsage);
      const allowed = currentUsage < limit;

      return success({
        allowed,
        currentUsage,
        limit,
        remaining,
        resetsAt: periodEnd,
      });
    },

    async recordUsage(
      actor: ActorContext,
      params: RecordUsageParams
    ): Promise<Result<void>> {
      if (!canAccessUserData(actor, params.userId)) {
        return failure(
          'PERMISSION_DENIED',
          'Cannot record usage for another user'
        );
      }

      const usageParams: Parameters<typeof db.recordUsage>[0] = {
        userId: params.userId,
        featureCode: params.featureCode,
        quantity: params.quantity,
      };
      if (params.requestId !== undefined) {
        usageParams.requestId = params.requestId;
      }
      if (params.invocationId !== undefined) {
        usageParams.invocationId = params.invocationId;
      }
      await db.recordUsage(usageParams);

      return success(undefined);
    },

    async getUsageSummary(
      actor: ActorContext,
      userId: string,
      params: GetUsageSummaryParams
    ): Promise<Result<UsageSummary[]>> {
      if (!canAccessUserData(actor, userId)) {
        return failure(
          'PERMISSION_DENIED',
          'Cannot access usage summary for another user'
        );
      }

      const summaries = await db.getUsageSummary(
        userId,
        params.periodStart,
        params.periodEnd
      );
      return success(summaries);
    },
  };
}
