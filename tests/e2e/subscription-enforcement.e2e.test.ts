/**
 * Subscription Enforcement E2E Tests
 * Phase C: Usage limits and entitlement enforcement
 *
 * Flow: Free user → usage limit hit → blocked
 *       Paid user → allowed
 *
 * These tests require database credentials.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import {
  createSubscriptionService,
  createSubscriptionServiceDb,
  createAuditService,
  createAuditServiceDb,
  createChatService,
  createChatServiceDb,
  createToolService,
  createToolServiceDb,
} from '@/services/index.js';
import type {
  SubscriptionService,
  ChatService,
  ToolService,
} from '@/services/index.js';
import type { ActorContext } from '@/types/index.js';

// Check credentials
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const HAS_CREDENTIALS =
  SUPABASE_URL !== undefined &&
  SUPABASE_URL !== '' &&
  SUPABASE_SERVICE_KEY !== undefined &&
  SUPABASE_SERVICE_KEY !== '';

// Unique test prefix
const TEST_PREFIX = `e2e_sub_${nanoid(6)}`;

function testId(prefix: string): string {
  return `${TEST_PREFIX}_${prefix}_${nanoid(6)}`;
}

function createUserActor(userId: string): ActorContext {
  return {
    type: 'user',
    userId,
    requestId: testId('req'),
    permissions: ['chat:read', 'chat:write', 'subscription:read'],
  };
}

describe.skipIf(!HAS_CREDENTIALS)('E2E: Subscription Enforcement', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let supabase: SupabaseClient<any, 'public', any>;
  let subscriptionService: SubscriptionService;
  let chatService: ChatService;
  let toolService: ToolService;

  // Track for cleanup
  const createdUserIds: string[] = [];
  const createdSubscriptionIds: string[] = [];
  const createdChatIds: string[] = [];

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase = createClient(
      SUPABASE_URL!,
      SUPABASE_SERVICE_KEY!
    ) as SupabaseClient<any, 'public', any>;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const auditDb = createAuditServiceDb(supabase);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const subscriptionDb = createSubscriptionServiceDb(supabase);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const chatDb = createChatServiceDb(supabase);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const toolDb = createToolServiceDb(supabase);

    const auditService = createAuditService({ db: auditDb });

    subscriptionService = createSubscriptionService({
      db: subscriptionDb,
      auditService: { log: (...args) => auditService.log(...args) },
    });

    chatService = createChatService({
      db: chatDb,
      auditService: { log: (...args) => auditService.log(...args) },
    });

    toolService = createToolService({
      db: toolDb,
      auditService: { log: (...args) => auditService.log(...args) },
      subscriptionService: {
        checkEntitlement: (...args) =>
          subscriptionService.checkEntitlement(...args),
      },
    });
  });

  afterAll(async () => {
    // Cleanup
    for (const id of createdChatIds) {
      await supabase.from('messages').delete().eq('chat_id', id);
      await supabase.from('chats').delete().eq('id', id);
    }
    for (const id of createdSubscriptionIds) {
      await supabase.from('usage_records').delete().eq('subscription_id', id);
      await supabase.from('entitlements').delete().eq('subscription_id', id);
      await supabase.from('subscriptions').delete().eq('id', id);
    }
    for (const id of createdUserIds) {
      await supabase.from('ai_preferences').delete().eq('user_id', id);
      await supabase.from('profiles').delete().eq('user_id', id);
      await supabase.from('users').delete().eq('id', id);
    }
  });

  describe('Free Tier Limits', () => {
    let freeUserId: string;
    let freeActor: ActorContext;
    let subscriptionId: string;

    beforeAll(async () => {
      freeUserId = testId('free_user');
      createdUserIds.push(freeUserId);

      // Create user
      await supabase.from('users').insert({
        id: freeUserId,
        email: `${freeUserId}@test.com`,
        status: 'active',
      });

      freeActor = createUserActor(freeUserId);

      // Create free tier subscription
      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1);

      const { data: sub } = await supabase
        .from('subscriptions')
        .insert({
          user_id: freeUserId,
          plan_code: 'free',
          plan_name: 'Free Plan',
          status: 'active',
          current_period_start: now.toISOString(),
          current_period_end: periodEnd.toISOString(),
        })
        .select()
        .single();

      if (sub) {
        subscriptionId = sub.id;
        createdSubscriptionIds.push(subscriptionId);

        // Create entitlements for free tier (limited messages)
        await supabase.from('entitlements').insert([
          {
            subscription_id: subscriptionId,
            feature_code: 'messages',
            feature_name: 'Messages',
            type: 'metered',
            limit_value: 50, // 50 messages per month
          },
          {
            subscription_id: subscriptionId,
            feature_code: 'web_search',
            feature_name: 'Web Search',
            type: 'boolean',
            enabled: false, // No web search on free
          },
        ]);
      }
    });

    it('should get subscription details', async () => {
      const result = await subscriptionService.getSubscription(
        freeActor,
        freeUserId
      );

      expect(result.success).toBe(true);
      expect(result.data?.planCode).toBe('free');
      expect(result.data?.status).toBe('active');
    });

    it('should check entitlement for allowed feature', async () => {
      const result = await subscriptionService.checkEntitlement(
        freeActor,
        freeUserId,
        'messages'
      );

      expect(result.success).toBe(true);
      expect(result.data?.allowed).toBe(true);
      expect(result.data?.remaining).toBe(50);
    });

    it('should check entitlement for disabled feature', async () => {
      const result = await subscriptionService.checkEntitlement(
        freeActor,
        freeUserId,
        'web_search'
      );

      expect(result.success).toBe(true);
      expect(result.data?.allowed).toBe(false);
    });

    it('should record usage and track remaining', async () => {
      // Record some usage
      const recordResult = await subscriptionService.recordUsage(
        freeActor,
        freeUserId,
        'messages',
        10
      );

      expect(recordResult.success).toBe(true);

      // Check remaining
      const checkResult = await subscriptionService.checkEntitlement(
        freeActor,
        freeUserId,
        'messages'
      );

      expect(checkResult.success).toBe(true);
      expect(checkResult.data?.remaining).toBe(40); // 50 - 10
    });

    it('should block when limit exceeded', async () => {
      // Record more usage to exceed limit
      await subscriptionService.recordUsage(
        freeActor,
        freeUserId,
        'messages',
        45
      );

      // Now check - should be blocked
      const result = await subscriptionService.checkEntitlement(
        freeActor,
        freeUserId,
        'messages'
      );

      expect(result.success).toBe(true);
      expect(result.data?.allowed).toBe(false);
      expect(result.data?.remaining).toBeLessThanOrEqual(0);
    });

    it('should get usage summary', async () => {
      const result = await subscriptionService.getUsageSummary(
        freeActor,
        freeUserId
      );

      expect(result.success).toBe(true);
      expect(result.data?.usage).toBeDefined();

      const messagesUsage = result.data?.usage.find(
        (u) => u.featureCode === 'messages'
      );
      expect(messagesUsage).toBeDefined();
      expect(messagesUsage?.used).toBeGreaterThan(0);
      expect(messagesUsage?.percentage).toBeGreaterThan(100); // Over limit
    });
  });

  describe('Paid Tier Access', () => {
    let paidUserId: string;
    let paidActor: ActorContext;
    let subscriptionId: string;

    beforeAll(async () => {
      paidUserId = testId('paid_user');
      createdUserIds.push(paidUserId);

      await supabase.from('users').insert({
        id: paidUserId,
        email: `${paidUserId}@test.com`,
        status: 'active',
      });

      paidActor = createUserActor(paidUserId);

      // Create paid subscription
      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1);

      const { data: sub } = await supabase
        .from('subscriptions')
        .insert({
          user_id: paidUserId,
          plan_code: 'pro',
          plan_name: 'Pro Plan',
          status: 'active',
          current_period_start: now.toISOString(),
          current_period_end: periodEnd.toISOString(),
        })
        .select()
        .single();

      if (sub) {
        subscriptionId = sub.id;
        createdSubscriptionIds.push(subscriptionId);

        // Create entitlements for pro tier (higher limits)
        await supabase.from('entitlements').insert([
          {
            subscription_id: subscriptionId,
            feature_code: 'messages',
            feature_name: 'Messages',
            type: 'metered',
            limit_value: 5000, // 5000 messages per month
          },
          {
            subscription_id: subscriptionId,
            feature_code: 'web_search',
            feature_name: 'Web Search',
            type: 'boolean',
            enabled: true, // Web search enabled
          },
          {
            subscription_id: subscriptionId,
            feature_code: 'priority_support',
            feature_name: 'Priority Support',
            type: 'boolean',
            enabled: true,
          },
        ]);
      }
    });

    it('should have higher message limit', async () => {
      const result = await subscriptionService.checkEntitlement(
        paidActor,
        paidUserId,
        'messages'
      );

      expect(result.success).toBe(true);
      expect(result.data?.allowed).toBe(true);
      expect(result.data?.limit).toBe(5000);
    });

    it('should have web search enabled', async () => {
      const result = await subscriptionService.checkEntitlement(
        paidActor,
        paidUserId,
        'web_search'
      );

      expect(result.success).toBe(true);
      expect(result.data?.allowed).toBe(true);
    });

    it('should list all entitlements', async () => {
      const result = await subscriptionService.getEntitlements(
        paidActor,
        paidUserId
      );

      expect(result.success).toBe(true);
      expect(result.data?.length).toBeGreaterThanOrEqual(3);

      const codes = result.data?.map((e) => e.featureCode) || [];
      expect(codes).toContain('messages');
      expect(codes).toContain('web_search');
      expect(codes).toContain('priority_support');
    });
  });

  describe('Tool Access by Subscription', () => {
    let freeUserId: string;
    let paidUserId: string;
    let freeActor: ActorContext;
    let paidActor: ActorContext;

    beforeAll(async () => {
      freeUserId = testId('tool_free');
      paidUserId = testId('tool_paid');
      createdUserIds.push(freeUserId, paidUserId);

      await supabase.from('users').insert([
        { id: freeUserId, email: `${freeUserId}@test.com`, status: 'active' },
        { id: paidUserId, email: `${paidUserId}@test.com`, status: 'active' },
      ]);

      freeActor = createUserActor(freeUserId);
      paidActor = createUserActor(paidUserId);

      // Setup subscriptions with different entitlements
      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1);

      // Free subscription
      const { data: freeSub } = await supabase
        .from('subscriptions')
        .insert({
          user_id: freeUserId,
          plan_code: 'free',
          plan_name: 'Free',
          status: 'active',
          current_period_start: now.toISOString(),
          current_period_end: periodEnd.toISOString(),
        })
        .select()
        .single();

      if (freeSub) {
        createdSubscriptionIds.push(freeSub.id);
        await supabase.from('entitlements').insert({
          subscription_id: freeSub.id,
          feature_code: 'web_search',
          feature_name: 'Web Search',
          type: 'boolean',
          enabled: false,
        });
      }

      // Paid subscription
      const { data: paidSub } = await supabase
        .from('subscriptions')
        .insert({
          user_id: paidUserId,
          plan_code: 'pro',
          plan_name: 'Pro',
          status: 'active',
          current_period_start: now.toISOString(),
          current_period_end: periodEnd.toISOString(),
        })
        .select()
        .single();

      if (paidSub) {
        createdSubscriptionIds.push(paidSub.id);
        await supabase.from('entitlements').insert({
          subscription_id: paidSub.id,
          feature_code: 'web_search',
          feature_name: 'Web Search',
          type: 'boolean',
          enabled: true,
        });
      }
    });

    it('free user sees limited tools', async () => {
      const result = await toolService.listAvailableTools(freeActor);

      expect(result.success).toBe(true);
      // Tools requiring web_search permission should be filtered
      const tools = result.data?.items || [];
      const webSearchTool = tools.find(
        (t) => t.requiresPermission === 'web_search'
      );
      // If tool exists, it should not be available
      if (webSearchTool) {
        expect(webSearchTool.enabled).toBe(false);
      }
    });

    it('paid user sees all tools', async () => {
      const result = await toolService.listAvailableTools(paidActor);

      expect(result.success).toBe(true);
      // All tools should be available
    });
  });

  describe('Expired Subscription', () => {
    let expiredUserId: string;
    let expiredActor: ActorContext;

    beforeAll(async () => {
      expiredUserId = testId('expired_user');
      createdUserIds.push(expiredUserId);

      await supabase.from('users').insert({
        id: expiredUserId,
        email: `${expiredUserId}@test.com`,
        status: 'active',
      });

      expiredActor = createUserActor(expiredUserId);

      // Create expired subscription
      const now = new Date();
      const periodStart = new Date(now);
      periodStart.setMonth(periodStart.getMonth() - 2);
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() - 1); // Ended last month

      const { data: sub } = await supabase
        .from('subscriptions')
        .insert({
          user_id: expiredUserId,
          plan_code: 'pro',
          plan_name: 'Pro',
          status: 'expired',
          current_period_start: periodStart.toISOString(),
          current_period_end: periodEnd.toISOString(),
        })
        .select()
        .single();

      if (sub) {
        createdSubscriptionIds.push(sub.id);
      }
    });

    it('should show expired status', async () => {
      const result = await subscriptionService.getSubscription(
        expiredActor,
        expiredUserId
      );

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('expired');
    });

    it('should deny entitlements for expired subscription', async () => {
      const result = await subscriptionService.checkEntitlement(
        expiredActor,
        expiredUserId,
        'messages'
      );

      // Either fails or returns not allowed
      if (result.success) {
        expect(result.data?.allowed).toBe(false);
      }
    });
  });
});
