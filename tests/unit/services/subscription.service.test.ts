/**
 * SubscriptionService Unit Tests
 * Phase 2: TDD - RED phase
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
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import type {
  SubscriptionService,
  SubscriptionServiceDb,
  SubscriptionServiceAudit,
} from '@/services/subscription.service.js';
import { createSubscriptionService } from '@/services/subscription.service.js';
import type {
  ActorContext,
  Plan,
  Subscription,
  UsageRecord,
  UsageSummary,
} from '@/types/index.js';
import { AI_ACTOR, SYSTEM_ACTOR } from '@/types/index.js';

// ─────────────────────────────────────────────────────────────
// TEST FIXTURES
// ─────────────────────────────────────────────────────────────

const TEST_USER_ID = 'test-user-123';
const TEST_OTHER_USER_ID = 'test-other-user-456';
const TEST_PLAN_ID = 'plan-pro-001';
const TEST_SUBSCRIPTION_ID = 'sub-test-789';
const TEST_REQUEST_ID = 'test-request-xyz';

const mockPlan: Plan = {
  id: TEST_PLAN_ID,
  name: 'Pro Plan',
  description: 'Professional tier with advanced features',
  isActive: true,
  entitlements: [
    { featureCode: 'max_file_size_mb', value: { limit: 100 } },
    { featureCode: 'total_storage_mb', value: { limit: 10000 } },
    { featureCode: 'api_calls_per_month', value: { limit: 10000 } },
    { featureCode: 'priority_support', value: { enabled: true } },
  ],
  metadata: {},
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const mockFreePlan: Plan = {
  id: 'plan-free-001',
  name: 'Free Plan',
  description: 'Basic free tier',
  isActive: true,
  entitlements: [
    { featureCode: 'max_file_size_mb', value: { limit: 10 } },
    { featureCode: 'total_storage_mb', value: { limit: 100 } },
    { featureCode: 'api_calls_per_month', value: { limit: 100 } },
  ],
  metadata: {},
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const mockSubscription: Subscription = {
  id: TEST_SUBSCRIPTION_ID,
  userId: TEST_USER_ID,
  planId: TEST_PLAN_ID,
  plan: mockPlan,
  status: 'active',
  currentPeriodStart: new Date('2024-01-01'),
  currentPeriodEnd: new Date('2024-02-01'),
  externalId: 'stripe_sub_123',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

function createTestActor(overrides?: Partial<ActorContext>): ActorContext {
  return {
    type: 'user',
    userId: TEST_USER_ID,
    requestId: TEST_REQUEST_ID,
    permissions: ['subscription:read'],
    ...overrides,
  };
}

function createAdminActor(overrides?: Partial<ActorContext>): ActorContext {
  return {
    type: 'admin',
    userId: 'admin-user-id',
    requestId: TEST_REQUEST_ID,
    permissions: ['subscription:read', 'subscription:manage'],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────
// MOCK SETUP
// ─────────────────────────────────────────────────────────────

function createMockDb(): SubscriptionServiceDb {
  return {
    listPlans: vi.fn(),
    getPlan: vi.fn(),
    getSubscription: vi.fn(),
    getSubscriptionByUserId: vi.fn(),
    createSubscription: vi.fn(),
    updateSubscriptionStatus: vi.fn(),
    updateSubscriptionPlan: vi.fn(),
    getUsageForPeriod: vi.fn(),
    recordUsage: vi.fn(),
    getUsageSummary: vi.fn(),
  };
}

function createMockAuditService(): SubscriptionServiceAudit {
  return {
    log: vi.fn().mockResolvedValue({ success: true, data: undefined }),
  };
}

// ─────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────

describe('SubscriptionService', () => {
  let subscriptionService: SubscriptionService;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockAuditService: ReturnType<typeof createMockAuditService>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockAuditService = createMockAuditService();
    subscriptionService = createSubscriptionService({
      db: mockDb,
      auditService: mockAuditService,
    });
  });

  // ─────────────────────────────────────────────────────────────
  // PLAN MANAGEMENT
  // ─────────────────────────────────────────────────────────────

  describe('listPlans', () => {
    it('should list all active plans', async () => {
      const actor = createTestActor();
      mockDb.listPlans.mockResolvedValue([mockPlan, mockFreePlan]);

      const result = await subscriptionService.listPlans(actor);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(2);
        expect(result.data[0].name).toBe('Pro Plan');
      }
      expect(mockDb.listPlans).toHaveBeenCalled();
    });

    it('should allow anonymous access to list plans', async () => {
      const actor: ActorContext = {
        type: 'user',
        requestId: TEST_REQUEST_ID,
        permissions: [],
      };
      mockDb.listPlans.mockResolvedValue([mockPlan]);

      const result = await subscriptionService.listPlans(actor);

      expect(result.success).toBe(true);
    });
  });

  describe('getPlan', () => {
    it('should get plan by ID', async () => {
      const actor = createTestActor();
      mockDb.getPlan.mockResolvedValue(mockPlan);

      const result = await subscriptionService.getPlan(actor, TEST_PLAN_ID);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(TEST_PLAN_ID);
        expect(result.data.name).toBe('Pro Plan');
      }
    });

    it('should return NOT_FOUND for non-existent plan', async () => {
      const actor = createTestActor();
      mockDb.getPlan.mockResolvedValue(null);

      const result = await subscriptionService.getPlan(actor, 'non-existent');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // SUBSCRIPTION MANAGEMENT
  // ─────────────────────────────────────────────────────────────

  describe('getSubscription', () => {
    it('should get user subscription', async () => {
      const actor = createTestActor();
      mockDb.getSubscriptionByUserId.mockResolvedValue(mockSubscription);

      const result = await subscriptionService.getSubscription(
        actor,
        TEST_USER_ID
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data?.id).toBe(TEST_SUBSCRIPTION_ID);
        expect(result.data?.plan.name).toBe('Pro Plan');
      }
    });

    it('should return null for user without subscription', async () => {
      const actor = createTestActor();
      mockDb.getSubscriptionByUserId.mockResolvedValue(null);

      const result = await subscriptionService.getSubscription(
        actor,
        TEST_USER_ID
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeNull();
      }
    });

    it('should deny access to another user subscription', async () => {
      const actor = createTestActor();
      mockDb.getSubscriptionByUserId.mockResolvedValue({
        ...mockSubscription,
        userId: TEST_OTHER_USER_ID,
      });

      const result = await subscriptionService.getSubscription(
        actor,
        TEST_OTHER_USER_ID
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow admin to get any user subscription', async () => {
      const actor = createAdminActor();
      mockDb.getSubscriptionByUserId.mockResolvedValue({
        ...mockSubscription,
        userId: TEST_OTHER_USER_ID,
      });

      const result = await subscriptionService.getSubscription(
        actor,
        TEST_OTHER_USER_ID
      );

      expect(result.success).toBe(true);
    });
  });

  describe('createSubscription', () => {
    it('should create subscription with SYSTEM_ACTOR', async () => {
      mockDb.getPlan.mockResolvedValue(mockPlan);
      mockDb.getSubscriptionByUserId.mockResolvedValue(null);
      mockDb.createSubscription.mockResolvedValue(mockSubscription);

      const result = await subscriptionService.createSubscription(
        SYSTEM_ACTOR,
        {
          userId: TEST_USER_ID,
          planId: TEST_PLAN_ID,
          periodStart: new Date('2024-01-01'),
          periodEnd: new Date('2024-02-01'),
          externalId: 'stripe_sub_123',
        }
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.userId).toBe(TEST_USER_ID);
      }
      expect(mockAuditService.log).toHaveBeenCalled();
    });

    it('should deny non-system actor from creating subscription', async () => {
      const actor = createTestActor();

      const result = await subscriptionService.createSubscription(actor, {
        userId: TEST_USER_ID,
        planId: TEST_PLAN_ID,
        periodStart: new Date('2024-01-01'),
        periodEnd: new Date('2024-02-01'),
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should deny AI_ACTOR from creating subscription', async () => {
      const result = await subscriptionService.createSubscription(AI_ACTOR, {
        userId: TEST_USER_ID,
        planId: TEST_PLAN_ID,
        periodStart: new Date('2024-01-01'),
        periodEnd: new Date('2024-02-01'),
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should return NOT_FOUND for invalid plan', async () => {
      mockDb.getPlan.mockResolvedValue(null);

      const result = await subscriptionService.createSubscription(
        SYSTEM_ACTOR,
        {
          userId: TEST_USER_ID,
          planId: 'invalid-plan',
          periodStart: new Date('2024-01-01'),
          periodEnd: new Date('2024-02-01'),
        }
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should return CONFLICT if user already has active subscription', async () => {
      mockDb.getPlan.mockResolvedValue(mockPlan);
      mockDb.getSubscriptionByUserId.mockResolvedValue(mockSubscription);

      const result = await subscriptionService.createSubscription(
        SYSTEM_ACTOR,
        {
          userId: TEST_USER_ID,
          planId: TEST_PLAN_ID,
          periodStart: new Date('2024-01-01'),
          periodEnd: new Date('2024-02-01'),
        }
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('CONFLICT');
      }
    });
  });

  describe('updateSubscriptionStatus', () => {
    it('should update subscription status with SYSTEM_ACTOR', async () => {
      mockDb.getSubscription.mockResolvedValue(mockSubscription);
      mockDb.updateSubscriptionStatus.mockResolvedValue({
        ...mockSubscription,
        status: 'canceled',
      });

      const result = await subscriptionService.updateSubscriptionStatus(
        SYSTEM_ACTOR,
        TEST_SUBSCRIPTION_ID,
        'canceled'
      );

      expect(result.success).toBe(true);
      expect(mockAuditService.log).toHaveBeenCalled();
    });

    it('should deny non-system actor from updating status', async () => {
      const actor = createTestActor();

      const result = await subscriptionService.updateSubscriptionStatus(
        actor,
        TEST_SUBSCRIPTION_ID,
        'canceled'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should return NOT_FOUND for non-existent subscription', async () => {
      mockDb.getSubscription.mockResolvedValue(null);

      const result = await subscriptionService.updateSubscriptionStatus(
        SYSTEM_ACTOR,
        'non-existent',
        'canceled'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });

  describe('changePlan', () => {
    it('should change subscription plan with SYSTEM_ACTOR', async () => {
      mockDb.getSubscription.mockResolvedValue(mockSubscription);
      mockDb.getPlan.mockResolvedValue(mockFreePlan);
      mockDb.updateSubscriptionPlan.mockResolvedValue({
        ...mockSubscription,
        planId: mockFreePlan.id,
        plan: mockFreePlan,
      });

      const result = await subscriptionService.changePlan(
        SYSTEM_ACTOR,
        TEST_SUBSCRIPTION_ID,
        mockFreePlan.id
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.plan.name).toBe('Free Plan');
      }
      expect(mockAuditService.log).toHaveBeenCalled();
    });

    it('should deny non-system actor from changing plan', async () => {
      const actor = createTestActor();

      const result = await subscriptionService.changePlan(
        actor,
        TEST_SUBSCRIPTION_ID,
        mockFreePlan.id
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should return NOT_FOUND for invalid new plan', async () => {
      mockDb.getSubscription.mockResolvedValue(mockSubscription);
      mockDb.getPlan.mockResolvedValue(null);

      const result = await subscriptionService.changePlan(
        SYSTEM_ACTOR,
        TEST_SUBSCRIPTION_ID,
        'invalid-plan'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // ENTITLEMENT CHECKS
  // ─────────────────────────────────────────────────────────────

  describe('hasEntitlement', () => {
    it('should return true if user has entitlement', async () => {
      const actor = createTestActor();
      mockDb.getSubscriptionByUserId.mockResolvedValue(mockSubscription);

      const result = await subscriptionService.hasEntitlement(
        actor,
        TEST_USER_ID,
        'priority_support'
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(true);
      }
    });

    it('should return false if user does not have entitlement', async () => {
      const actor = createTestActor();
      mockDb.getSubscriptionByUserId.mockResolvedValue(mockSubscription);

      const result = await subscriptionService.hasEntitlement(
        actor,
        TEST_USER_ID,
        'enterprise_feature'
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(false);
      }
    });

    it('should return false if user has no subscription', async () => {
      const actor = createTestActor();
      mockDb.getSubscriptionByUserId.mockResolvedValue(null);

      const result = await subscriptionService.hasEntitlement(
        actor,
        TEST_USER_ID,
        'priority_support'
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(false);
      }
    });

    it('should allow AI_ACTOR to check entitlements (for context)', async () => {
      mockDb.getSubscriptionByUserId.mockResolvedValue(mockSubscription);

      const result = await subscriptionService.hasEntitlement(
        AI_ACTOR,
        TEST_USER_ID,
        'priority_support'
      );

      expect(result.success).toBe(true);
    });
  });

  describe('getEntitlementValue', () => {
    it('should return entitlement value with limit', async () => {
      const actor = createTestActor();
      mockDb.getSubscriptionByUserId.mockResolvedValue(mockSubscription);

      const result = await subscriptionService.getEntitlementValue(
        actor,
        TEST_USER_ID,
        'max_file_size_mb'
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data?.limit).toBe(100);
      }
    });

    it('should return null for non-existent entitlement', async () => {
      const actor = createTestActor();
      mockDb.getSubscriptionByUserId.mockResolvedValue(mockSubscription);

      const result = await subscriptionService.getEntitlementValue(
        actor,
        TEST_USER_ID,
        'non_existent_feature'
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeNull();
      }
    });

    it('should return null if user has no subscription', async () => {
      const actor = createTestActor();
      mockDb.getSubscriptionByUserId.mockResolvedValue(null);

      const result = await subscriptionService.getEntitlementValue(
        actor,
        TEST_USER_ID,
        'max_file_size_mb'
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeNull();
      }
    });
  });

  describe('checkUsageLimit', () => {
    it('should return allowed=true when under limit', async () => {
      const actor = createTestActor();
      mockDb.getSubscriptionByUserId.mockResolvedValue(mockSubscription);
      mockDb.getUsageForPeriod.mockResolvedValue(5000); // 5000 of 10000 used

      const result = await subscriptionService.checkUsageLimit(
        actor,
        TEST_USER_ID,
        'api_calls_per_month'
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.allowed).toBe(true);
        expect(result.data.currentUsage).toBe(5000);
        expect(result.data.limit).toBe(10000);
        expect(result.data.remaining).toBe(5000);
      }
    });

    it('should return allowed=false when at limit', async () => {
      const actor = createTestActor();
      mockDb.getSubscriptionByUserId.mockResolvedValue(mockSubscription);
      mockDb.getUsageForPeriod.mockResolvedValue(10000); // At limit

      const result = await subscriptionService.checkUsageLimit(
        actor,
        TEST_USER_ID,
        'api_calls_per_month'
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.allowed).toBe(false);
        expect(result.data.remaining).toBe(0);
      }
    });

    it('should return allowed=true when no subscription (unlimited for non-limited features)', async () => {
      const actor = createTestActor();
      mockDb.getSubscriptionByUserId.mockResolvedValue(null);
      mockDb.getUsageForPeriod.mockResolvedValue(0);

      const result = await subscriptionService.checkUsageLimit(
        actor,
        TEST_USER_ID,
        'api_calls_per_month'
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBeNull();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // USAGE TRACKING
  // ─────────────────────────────────────────────────────────────

  describe('recordUsage', () => {
    it('should record usage successfully', async () => {
      const actor = createTestActor();
      mockDb.recordUsage.mockResolvedValue(undefined);

      const result = await subscriptionService.recordUsage(actor, {
        userId: TEST_USER_ID,
        featureCode: 'api_calls_per_month',
        quantity: 1,
        requestId: TEST_REQUEST_ID,
      });

      expect(result.success).toBe(true);
      expect(mockDb.recordUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: TEST_USER_ID,
          featureCode: 'api_calls_per_month',
          quantity: 1,
        })
      );
    });

    it('should be idempotent with same requestId', async () => {
      const actor = createTestActor();
      mockDb.recordUsage.mockResolvedValue(undefined);

      // Record twice with same requestId
      await subscriptionService.recordUsage(actor, {
        userId: TEST_USER_ID,
        featureCode: 'api_calls_per_month',
        quantity: 1,
        requestId: 'idempotent-request-123',
      });

      await subscriptionService.recordUsage(actor, {
        userId: TEST_USER_ID,
        featureCode: 'api_calls_per_month',
        quantity: 1,
        requestId: 'idempotent-request-123',
      });

      // DB should handle idempotency
      expect(mockDb.recordUsage).toHaveBeenCalledTimes(2);
    });

    it('should allow SYSTEM_ACTOR to record usage for any user', async () => {
      mockDb.recordUsage.mockResolvedValue(undefined);

      const result = await subscriptionService.recordUsage(SYSTEM_ACTOR, {
        userId: TEST_OTHER_USER_ID,
        featureCode: 'api_calls_per_month',
        quantity: 5,
      });

      expect(result.success).toBe(true);
    });

    it('should deny recording usage for another user (non-system)', async () => {
      const actor = createTestActor();

      const result = await subscriptionService.recordUsage(actor, {
        userId: TEST_OTHER_USER_ID,
        featureCode: 'api_calls_per_month',
        quantity: 1,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });

  describe('getUsageSummary', () => {
    it('should return usage summary for period', async () => {
      const actor = createTestActor();
      const summaries: UsageSummary[] = [
        {
          featureCode: 'api_calls_per_month',
          quantity: 5000,
          periodStart: new Date('2024-01-01'),
          periodEnd: new Date('2024-02-01'),
        },
        {
          featureCode: 'storage_mb',
          quantity: 500,
          periodStart: new Date('2024-01-01'),
          periodEnd: new Date('2024-02-01'),
        },
      ];
      mockDb.getUsageSummary.mockResolvedValue(summaries);

      const result = await subscriptionService.getUsageSummary(
        actor,
        TEST_USER_ID,
        {
          periodStart: new Date('2024-01-01'),
          periodEnd: new Date('2024-02-01'),
        }
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(2);
        expect(result.data[0].featureCode).toBe('api_calls_per_month');
      }
    });

    it('should deny access to another user usage', async () => {
      const actor = createTestActor();

      const result = await subscriptionService.getUsageSummary(
        actor,
        TEST_OTHER_USER_ID,
        {
          periodStart: new Date('2024-01-01'),
          periodEnd: new Date('2024-02-01'),
        }
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow admin to get any user usage', async () => {
      const actor = createAdminActor();
      mockDb.getUsageSummary.mockResolvedValue([]);

      const result = await subscriptionService.getUsageSummary(
        actor,
        TEST_OTHER_USER_ID,
        {
          periodStart: new Date('2024-01-01'),
          periodEnd: new Date('2024-02-01'),
        }
      );

      expect(result.success).toBe(true);
    });
  });
});
