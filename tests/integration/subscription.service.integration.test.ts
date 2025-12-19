/**
 * SubscriptionService Integration Tests
 * Phase 2: Tests with real Supabase database
 *
 * These tests require:
 * - SUPABASE_URL environment variable
 * - SUPABASE_SERVICE_KEY environment variable
 * - Database with plans, subscriptions, usage_records tables
 *
 * Tests are skipped if credentials are not available.
 *
 * SCOPE: Billing, plans, and entitlement enforcement
 *
 * GUARDRAILS:
 * - Only SYSTEM_ACTOR can create/modify subscriptions (payment webhooks)
 * - Users can only access their own subscription
 * - AI_ACTOR cannot modify subscriptions
 * - Admins can access any subscription
 * - Usage recording is idempotent (requestId/invocationId)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import {
  createSubscriptionService,
  createSubscriptionServiceDb,
  createAuditService,
  createAuditServiceDb,
  createUserService,
  createUserServiceDb,
} from '@/services/index.js';
import type {
  SubscriptionService,
  AuditService,
  UserService,
} from '@/services/index.js';
import type { ActorContext } from '@/types/index.js';
import { AI_ACTOR, SYSTEM_ACTOR } from '@/types/index.js';

// Check if we have database credentials
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const HAS_CREDENTIALS =
  SUPABASE_URL !== undefined &&
  SUPABASE_URL !== '' &&
  SUPABASE_SERVICE_KEY !== undefined &&
  SUPABASE_SERVICE_KEY !== '';

// Test fixtures - use nanoid for unique test identifiers
const TEST_PREFIX = `sub_test_${nanoid(6)}`;

// Known plan IDs from migration seed data
const FREE_PLAN_ID = 'a0000000-0000-0000-0000-000000000001';
const PRO_PLAN_ID = 'a0000000-0000-0000-0000-000000000002';

// Helper to create unique test IDs
function testId(prefix: string): string {
  return `${TEST_PREFIX}_${prefix}_${nanoid(6)}`;
}

// Helper to create test actor
function createTestActor(
  userId: string,
  overrides?: Partial<ActorContext>
): ActorContext {
  return {
    type: 'user',
    userId,
    requestId: testId('req'),
    permissions: ['subscription:read'],
    ...overrides,
  };
}

// Helper to create admin actor
function createAdminActor(overrides?: Partial<ActorContext>): ActorContext {
  return {
    type: 'admin',
    userId: testId('admin'),
    requestId: testId('req'),
    permissions: ['subscription:read', 'subscription:manage'],
    ...overrides,
  };
}

describe.skipIf(!HAS_CREDENTIALS)('SubscriptionService Integration', () => {
  let supabase: SupabaseClient;
  let subscriptionService: SubscriptionService;
  let auditService: AuditService;
  let userService: UserService;

  // Track created resources for cleanup
  const createdUserIds: string[] = [];
  const createdSubscriptionIds: string[] = [];

  beforeAll(async () => {
    // Create Supabase client with service key (bypasses RLS)
    supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);

    // Create database adapters and services
    const auditDb = createAuditServiceDb(supabase);
    auditService = createAuditService({ db: auditDb });

    const userDb = createUserServiceDb(supabase);
    userService = createUserService({ db: userDb, auditService });

    const subscriptionDb = createSubscriptionServiceDb(supabase);
    subscriptionService = createSubscriptionService({
      db: subscriptionDb,
      auditService,
    });
  });

  afterAll(async () => {
    // Cleanup in reverse order (subscriptions first, then users)

    // Delete subscriptions
    if (createdSubscriptionIds.length > 0) {
      await supabase
        .from('subscriptions')
        .delete()
        .in('id', createdSubscriptionIds);
    }

    // Delete usage records for test users
    if (createdUserIds.length > 0) {
      await supabase
        .from('usage_records')
        .delete()
        .in('user_id', createdUserIds);
    }

    // Delete test users
    if (createdUserIds.length > 0) {
      await supabase.from('users').delete().in('id', createdUserIds);
    }
  });

  // Helper to create a test user
  async function createTestUser(): Promise<string> {
    const userId = testId('user');
    const email = `${userId}@test.example.com`;
    await userService.onUserSignup(
      { type: 'system', requestId: testId('req'), permissions: ['*'] },
      {
        authUserId: userId,
        email,
      }
    );
    createdUserIds.push(userId);
    return userId;
  }

  // ─────────────────────────────────────────────────────────────
  // Plan Management
  // ─────────────────────────────────────────────────────────────

  describe('Plan Management', () => {
    it('should list all active plans', async () => {
      const actor = createTestActor(testId('user'));

      const result = await subscriptionService.listPlans(actor);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBeGreaterThanOrEqual(3); // Free, Pro, Enterprise
        const planNames = result.data.map((p) => p.name);
        expect(planNames).toContain('Free');
        expect(planNames).toContain('Pro');
      }
    });

    it('should get plan by ID', async () => {
      const actor = createTestActor(testId('user'));

      const result = await subscriptionService.getPlan(actor, PRO_PLAN_ID);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Pro');
        expect(result.data.entitlements.length).toBeGreaterThan(0);
        const storageLimitEntitlement = result.data.entitlements.find(
          (e) => e.featureCode === 'total_storage_mb'
        );
        expect(storageLimitEntitlement?.value.limit).toBe(10000);
      }
    });

    it('should return NOT_FOUND for non-existent plan', async () => {
      const actor = createTestActor(testId('user'));

      // Use a valid UUID format that doesn't exist
      const result = await subscriptionService.getPlan(
        actor,
        '00000000-0000-0000-0000-000000000000'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Subscription Management
  // ─────────────────────────────────────────────────────────────

  describe('Subscription Management', () => {
    it('should create subscription with SYSTEM_ACTOR', async () => {
      const userId = await createTestUser();

      const result = await subscriptionService.createSubscription(
        SYSTEM_ACTOR,
        {
          userId,
          planId: FREE_PLAN_ID,
          periodStart: new Date(),
          periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
          externalId: `stripe_sub_${testId('ext')}`,
        }
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.userId).toBe(userId);
        expect(result.data.plan.name).toBe('Free');
        expect(result.data.status).toBe('active');
        createdSubscriptionIds.push(result.data.id);
      }
    });

    it('should deny non-system actor from creating subscription', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      const result = await subscriptionService.createSubscription(actor, {
        userId,
        planId: FREE_PLAN_ID,
        periodStart: new Date(),
        periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should deny AI_ACTOR from creating subscription', async () => {
      const userId = await createTestUser();

      const result = await subscriptionService.createSubscription(AI_ACTOR, {
        userId,
        planId: FREE_PLAN_ID,
        periodStart: new Date(),
        periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should get user subscription', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      // Create subscription first
      const createResult = await subscriptionService.createSubscription(
        SYSTEM_ACTOR,
        {
          userId,
          planId: PRO_PLAN_ID,
          periodStart: new Date(),
          periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        }
      );

      expect(createResult.success).toBe(true);
      if (createResult.success) {
        createdSubscriptionIds.push(createResult.data.id);
      }

      // Get subscription as user
      const result = await subscriptionService.getSubscription(actor, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).not.toBeNull();
        expect(result.data?.plan.name).toBe('Pro');
      }
    });

    it('should deny access to another user subscription', async () => {
      const userId1 = await createTestUser();
      const userId2 = await createTestUser();
      const actor2 = createTestActor(userId2);

      // Create subscription for user1
      const createResult = await subscriptionService.createSubscription(
        SYSTEM_ACTOR,
        {
          userId: userId1,
          planId: FREE_PLAN_ID,
          periodStart: new Date(),
          periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        }
      );

      if (createResult.success) {
        createdSubscriptionIds.push(createResult.data.id);
      }

      // Try to access as user2
      const result = await subscriptionService.getSubscription(actor2, userId1);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow admin to get any user subscription', async () => {
      const userId = await createTestUser();
      const adminActor = createAdminActor();

      // Create subscription
      const createResult = await subscriptionService.createSubscription(
        SYSTEM_ACTOR,
        {
          userId,
          planId: FREE_PLAN_ID,
          periodStart: new Date(),
          periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        }
      );

      if (createResult.success) {
        createdSubscriptionIds.push(createResult.data.id);
      }

      // Admin gets subscription
      const result = await subscriptionService.getSubscription(
        adminActor,
        userId
      );

      expect(result.success).toBe(true);
    });

    it('should update subscription status with SYSTEM_ACTOR', async () => {
      const userId = await createTestUser();

      // Create subscription
      const createResult = await subscriptionService.createSubscription(
        SYSTEM_ACTOR,
        {
          userId,
          planId: FREE_PLAN_ID,
          periodStart: new Date(),
          periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        }
      );

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdSubscriptionIds.push(createResult.data.id);

      // Update status
      const updateResult = await subscriptionService.updateSubscriptionStatus(
        SYSTEM_ACTOR,
        createResult.data.id,
        'canceled'
      );

      expect(updateResult.success).toBe(true);
    });

    it('should change subscription plan with SYSTEM_ACTOR', async () => {
      const userId = await createTestUser();

      // Create subscription with Free plan
      const createResult = await subscriptionService.createSubscription(
        SYSTEM_ACTOR,
        {
          userId,
          planId: FREE_PLAN_ID,
          periodStart: new Date(),
          periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        }
      );

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdSubscriptionIds.push(createResult.data.id);

      // Change to Pro plan
      const changeResult = await subscriptionService.changePlan(
        SYSTEM_ACTOR,
        createResult.data.id,
        PRO_PLAN_ID
      );

      expect(changeResult.success).toBe(true);
      if (changeResult.success) {
        expect(changeResult.data.plan.name).toBe('Pro');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Entitlement Checks
  // ─────────────────────────────────────────────────────────────

  describe('Entitlement Checks', () => {
    it('should check if user has entitlement', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      // Create Pro subscription
      const createResult = await subscriptionService.createSubscription(
        SYSTEM_ACTOR,
        {
          userId,
          planId: PRO_PLAN_ID,
          periodStart: new Date(),
          periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        }
      );

      if (createResult.success) {
        createdSubscriptionIds.push(createResult.data.id);
      }

      // Check priority support entitlement
      const result = await subscriptionService.hasEntitlement(
        actor,
        userId,
        'priority_support'
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(true);
      }
    });

    it('should return false for missing entitlement', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      // Create Free subscription (no priority_support)
      const createResult = await subscriptionService.createSubscription(
        SYSTEM_ACTOR,
        {
          userId,
          planId: FREE_PLAN_ID,
          periodStart: new Date(),
          periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        }
      );

      if (createResult.success) {
        createdSubscriptionIds.push(createResult.data.id);
      }

      // Check priority support entitlement (not in Free plan)
      const result = await subscriptionService.hasEntitlement(
        actor,
        userId,
        'priority_support'
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(false);
      }
    });

    it('should get entitlement value', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      // Create Pro subscription
      const createResult = await subscriptionService.createSubscription(
        SYSTEM_ACTOR,
        {
          userId,
          planId: PRO_PLAN_ID,
          periodStart: new Date(),
          periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        }
      );

      if (createResult.success) {
        createdSubscriptionIds.push(createResult.data.id);
      }

      // Get storage limit
      const result = await subscriptionService.getEntitlementValue(
        actor,
        userId,
        'total_storage_mb'
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data?.limit).toBe(10000); // Pro plan: 10GB
      }
    });

    it('should allow AI_ACTOR to check entitlements', async () => {
      const userId = await createTestUser();

      // Create subscription
      const createResult = await subscriptionService.createSubscription(
        SYSTEM_ACTOR,
        {
          userId,
          planId: PRO_PLAN_ID,
          periodStart: new Date(),
          periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        }
      );

      if (createResult.success) {
        createdSubscriptionIds.push(createResult.data.id);
      }

      // AI checks entitlement
      const result = await subscriptionService.hasEntitlement(
        AI_ACTOR,
        userId,
        'priority_support'
      );

      expect(result.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Usage Tracking
  // ─────────────────────────────────────────────────────────────

  describe('Usage Tracking', () => {
    it('should record usage successfully', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      const result = await subscriptionService.recordUsage(actor, {
        userId,
        featureCode: 'api_calls_per_month',
        quantity: 1,
        requestId: testId('req'),
      });

      expect(result.success).toBe(true);
    });

    it('should check usage limit', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      // Create Free subscription (100 API calls limit)
      const createResult = await subscriptionService.createSubscription(
        SYSTEM_ACTOR,
        {
          userId,
          planId: FREE_PLAN_ID,
          periodStart: new Date(),
          periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        }
      );

      if (createResult.success) {
        createdSubscriptionIds.push(createResult.data.id);
      }

      // Record some usage
      await subscriptionService.recordUsage(actor, {
        userId,
        featureCode: 'api_calls_per_month',
        quantity: 50,
        requestId: testId('req'),
      });

      // Check limit
      const result = await subscriptionService.checkUsageLimit(
        actor,
        userId,
        'api_calls_per_month'
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.allowed).toBe(true);
        expect(result.data.currentUsage).toBe(50);
        expect(result.data.limit).toBe(100);
        expect(result.data.remaining).toBe(50);
      }
    });

    it('should get usage summary', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      // Record usage
      await subscriptionService.recordUsage(actor, {
        userId,
        featureCode: 'api_calls_per_month',
        quantity: 10,
        requestId: testId('req1'),
      });

      await subscriptionService.recordUsage(actor, {
        userId,
        featureCode: 'storage_mb',
        quantity: 5,
        requestId: testId('req2'),
      });

      // Get summary
      const periodStart = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day ago
      const periodEnd = new Date(Date.now() + 24 * 60 * 60 * 1000); // 1 day ahead

      const result = await subscriptionService.getUsageSummary(actor, userId, {
        periodStart,
        periodEnd,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBeGreaterThanOrEqual(2);
        const apiCalls = result.data.find(
          (s) => s.featureCode === 'api_calls_per_month'
        );
        expect(apiCalls?.quantity).toBe(10);
      }
    });

    it('should deny access to another user usage', async () => {
      const userId1 = await createTestUser();
      const userId2 = await createTestUser();
      const actor2 = createTestActor(userId2);

      const periodStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const periodEnd = new Date(Date.now() + 24 * 60 * 60 * 1000);

      // Try to access user1's usage as user2
      const result = await subscriptionService.getUsageSummary(
        actor2,
        userId1,
        {
          periodStart,
          periodEnd,
        }
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow SYSTEM_ACTOR to record usage for any user', async () => {
      const userId = await createTestUser();

      const result = await subscriptionService.recordUsage(SYSTEM_ACTOR, {
        userId,
        featureCode: 'api_calls_per_month',
        quantity: 100,
        requestId: testId('sys_req'),
      });

      expect(result.success).toBe(true);
    });
  });
});
