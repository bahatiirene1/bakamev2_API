/**
 * Subscription Routes Unit Tests
 */

import { Hono } from 'hono';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createSubscriptionRoutes } from '@/api/routes/subscription.js';
import type { ActorContext } from '@/types/index.js';

// Mock actor for testing
function createTestActor(overrides?: Partial<ActorContext>): ActorContext {
  return {
    type: 'user',
    userId: 'user-123',
    requestId: 'req-123',
    permissions: ['subscription:read'],
    ...overrides,
  };
}

// Mock middleware that sets actor
function mockAuthMiddleware(actor: ActorContext) {
  return async (c: any, next: any) => {
    c.set('actor', actor);
    c.set('requestId', actor.requestId);
    await next();
  };
}

describe('Subscription Routes', () => {
  let mockSubscriptionService: {
    getSubscription: ReturnType<typeof vi.fn>;
    getUsageSummary: ReturnType<typeof vi.fn>;
    getEntitlements: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockSubscriptionService = {
      getSubscription: vi.fn(),
      getUsageSummary: vi.fn(),
      getEntitlements: vi.fn(),
    };
  });

  describe('GET /subscription', () => {
    it('should return current subscription', async () => {
      const actor = createTestActor();
      mockSubscriptionService.getSubscription.mockResolvedValue({
        success: true,
        data: {
          id: 'sub-123',
          userId: 'user-123',
          planCode: 'pro',
          planName: 'Professional',
          status: 'active',
          currentPeriodStart: new Date('2024-01-01T00:00:00Z'),
          currentPeriodEnd: new Date('2024-02-01T00:00:00Z'),
          cancelAtPeriodEnd: false,
        },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route(
        '/api/v1',
        createSubscriptionRoutes({
          subscriptionService: mockSubscriptionService,
        })
      );

      const res = await app.request('/api/v1/subscription');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.planCode).toBe('pro');
      expect(body.data.status).toBe('active');
    });

    it('should call service with actor userId', async () => {
      const actor = createTestActor({ userId: 'user-456' });
      mockSubscriptionService.getSubscription.mockResolvedValue({
        success: true,
        data: {
          id: 'sub-123',
          userId: 'user-456',
          planCode: 'free',
          planName: 'Free',
          status: 'active',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(),
          cancelAtPeriodEnd: false,
        },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route(
        '/api/v1',
        createSubscriptionRoutes({
          subscriptionService: mockSubscriptionService,
        })
      );

      await app.request('/api/v1/subscription');

      expect(mockSubscriptionService.getSubscription).toHaveBeenCalledWith(
        actor,
        'user-456'
      );
    });
  });

  describe('GET /subscription/usage', () => {
    it('should return usage summary', async () => {
      const actor = createTestActor();
      mockSubscriptionService.getUsageSummary.mockResolvedValue({
        success: true,
        data: {
          period: {
            start: new Date('2024-01-01T00:00:00Z'),
            end: new Date('2024-02-01T00:00:00Z'),
          },
          usage: [
            {
              featureCode: 'ai_tokens',
              featureName: 'AI Tokens',
              used: 125000,
              limit: 500000,
              percentage: 25,
            },
            {
              featureCode: 'tool_invocations',
              featureName: 'Tool Calls',
              used: 45,
              limit: 1000,
              percentage: 4.5,
            },
          ],
        },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route(
        '/api/v1',
        createSubscriptionRoutes({
          subscriptionService: mockSubscriptionService,
        })
      );

      const res = await app.request('/api/v1/subscription/usage');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.usage).toHaveLength(2);
      expect(body.data.usage[0].featureCode).toBe('ai_tokens');
    });

    it('should pass period param to service', async () => {
      const actor = createTestActor();
      mockSubscriptionService.getUsageSummary.mockResolvedValue({
        success: true,
        data: { period: {}, usage: [] },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route(
        '/api/v1',
        createSubscriptionRoutes({
          subscriptionService: mockSubscriptionService,
        })
      );

      await app.request('/api/v1/subscription/usage?period=previous');

      expect(mockSubscriptionService.getUsageSummary).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({ period: 'previous' })
      );
    });
  });

  describe('GET /subscription/entitlements', () => {
    it('should return entitlements', async () => {
      const actor = createTestActor();
      mockSubscriptionService.getEntitlements.mockResolvedValue({
        success: true,
        data: [
          {
            featureCode: 'ai_tokens',
            type: 'metered',
            limit: 500000,
            resetPeriod: 'monthly',
          },
          {
            featureCode: 'priority_support',
            type: 'boolean',
            enabled: true,
          },
        ],
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route(
        '/api/v1',
        createSubscriptionRoutes({
          subscriptionService: mockSubscriptionService,
        })
      );

      const res = await app.request('/api/v1/subscription/entitlements');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(2);
      expect(body.data[0].featureCode).toBe('ai_tokens');
    });
  });

  describe('Response Format', () => {
    it('should include requestId in all responses', async () => {
      const actor = createTestActor({ requestId: 'req-xyz' });
      mockSubscriptionService.getSubscription.mockResolvedValue({
        success: true,
        data: {
          id: 'sub-123',
          userId: 'user-123',
          planCode: 'free',
          planName: 'Free',
          status: 'active',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(),
          cancelAtPeriodEnd: false,
        },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route(
        '/api/v1',
        createSubscriptionRoutes({
          subscriptionService: mockSubscriptionService,
        })
      );

      const res = await app.request('/api/v1/subscription');

      const body = await res.json();
      expect(body.meta.requestId).toBe('req-xyz');
    });

    it('should format dates as ISO 8601', async () => {
      const actor = createTestActor();
      mockSubscriptionService.getSubscription.mockResolvedValue({
        success: true,
        data: {
          id: 'sub-123',
          userId: 'user-123',
          planCode: 'pro',
          planName: 'Professional',
          status: 'active',
          currentPeriodStart: new Date('2024-01-01T00:00:00.000Z'),
          currentPeriodEnd: new Date('2024-02-01T00:00:00.000Z'),
          cancelAtPeriodEnd: false,
        },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route(
        '/api/v1',
        createSubscriptionRoutes({
          subscriptionService: mockSubscriptionService,
        })
      );

      const res = await app.request('/api/v1/subscription');

      const body = await res.json();
      expect(body.data.currentPeriodStart).toBe('2024-01-01T00:00:00.000Z');
      expect(body.data.currentPeriodEnd).toBe('2024-02-01T00:00:00.000Z');
    });
  });
});
