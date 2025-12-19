/**
 * Rate Limit Middleware Unit Tests
 */

import { Hono } from 'hono';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  createRateLimitMiddleware,
  createInMemoryRateLimiter,
  type RateLimiter,
  type RateLimitConfig,
} from '@/api/middleware/rateLimit.js';
import type { ActorContext } from '@/types/index.js';

// Mock actor for testing
function createTestActor(overrides?: Partial<ActorContext>): ActorContext {
  return {
    type: 'user',
    userId: 'user-123',
    requestId: 'req-123',
    permissions: [],
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

describe('Rate Limit Middleware', () => {
  describe('createRateLimitMiddleware', () => {
    it('should allow requests within limit', async () => {
      const mockRateLimiter: RateLimiter = {
        limit: vi.fn().mockResolvedValue({
          success: true,
          limit: 100,
          remaining: 99,
          reset: 60,
        }),
      };

      const actor = createTestActor();
      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.use('*', createRateLimitMiddleware(mockRateLimiter));
      app.get('/test', (c) => c.json({ ok: true }));

      const res = await app.request('/test');

      expect(res.status).toBe(200);
      expect(res.headers.get('X-RateLimit-Limit')).toBe('100');
      expect(res.headers.get('X-RateLimit-Remaining')).toBe('99');
      expect(res.headers.get('X-RateLimit-Reset')).toBe('60');
    });

    it('should block requests exceeding limit', async () => {
      const mockRateLimiter: RateLimiter = {
        limit: vi.fn().mockResolvedValue({
          success: false,
          limit: 100,
          remaining: 0,
          reset: 30,
        }),
      };

      const actor = createTestActor();
      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.use('*', createRateLimitMiddleware(mockRateLimiter));
      app.get('/test', (c) => c.json({ ok: true }));

      const res = await app.request('/test');

      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body.error.code).toBe('RATE_LIMITED');
      expect(body.error.details.retryAfter).toBe(30);
    });

    it('should use userId as identifier when available', async () => {
      const mockRateLimiter: RateLimiter = {
        limit: vi.fn().mockResolvedValue({
          success: true,
          limit: 100,
          remaining: 99,
          reset: 60,
        }),
      };

      const actor = createTestActor({ userId: 'user-456' });
      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.use('*', createRateLimitMiddleware(mockRateLimiter));
      app.get('/test', (c) => c.json({ ok: true }));

      await app.request('/test');

      expect(mockRateLimiter.limit).toHaveBeenCalledWith('user:user-456');
    });

    it('should use custom identifier function', async () => {
      const mockRateLimiter: RateLimiter = {
        limit: vi.fn().mockResolvedValue({
          success: true,
          limit: 100,
          remaining: 99,
          reset: 60,
        }),
      };

      const config: RateLimitConfig = {
        limit: 100,
        window: 60,
        getIdentifier: () => 'custom-id',
      };

      const actor = createTestActor();
      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.use('*', createRateLimitMiddleware(mockRateLimiter, config));
      app.get('/test', (c) => c.json({ ok: true }));

      await app.request('/test');

      expect(mockRateLimiter.limit).toHaveBeenCalledWith('custom-id');
    });

    it('should include requestId in error response', async () => {
      const mockRateLimiter: RateLimiter = {
        limit: vi.fn().mockResolvedValue({
          success: false,
          limit: 100,
          remaining: 0,
          reset: 30,
        }),
      };

      const actor = createTestActor({ requestId: 'req-xyz' });
      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.use('*', createRateLimitMiddleware(mockRateLimiter));
      app.get('/test', (c) => c.json({ ok: true }));

      const res = await app.request('/test');

      const body = await res.json();
      expect(body.error.requestId).toBe('req-xyz');
    });
  });

  describe('createInMemoryRateLimiter', () => {
    it('should track requests per identifier', async () => {
      const config: RateLimitConfig = { limit: 3, window: 60 };
      const rateLimiter = createInMemoryRateLimiter(config);

      // First 3 requests should succeed
      const result1 = await rateLimiter.limit('test-id');
      expect(result1.success).toBe(true);
      expect(result1.remaining).toBe(2);

      const result2 = await rateLimiter.limit('test-id');
      expect(result2.success).toBe(true);
      expect(result2.remaining).toBe(1);

      const result3 = await rateLimiter.limit('test-id');
      expect(result3.success).toBe(true);
      expect(result3.remaining).toBe(0);

      // 4th request should fail
      const result4 = await rateLimiter.limit('test-id');
      expect(result4.success).toBe(false);
      expect(result4.remaining).toBe(0);
    });

    it('should track different identifiers separately', async () => {
      const config: RateLimitConfig = { limit: 2, window: 60 };
      const rateLimiter = createInMemoryRateLimiter(config);

      await rateLimiter.limit('id-1');
      await rateLimiter.limit('id-1');

      // id-1 is at limit
      const result1 = await rateLimiter.limit('id-1');
      expect(result1.success).toBe(false);

      // id-2 should still have quota
      const result2 = await rateLimiter.limit('id-2');
      expect(result2.success).toBe(true);
      expect(result2.remaining).toBe(1);
    });

    it('should return correct limit and reset values', async () => {
      const config: RateLimitConfig = { limit: 10, window: 120 };
      const rateLimiter = createInMemoryRateLimiter(config);

      const result = await rateLimiter.limit('test');

      expect(result.limit).toBe(10);
      expect(result.reset).toBeGreaterThan(0);
      expect(result.reset).toBeLessThanOrEqual(120);
    });
  });

  describe('Integration with Hono', () => {
    it('should work with in-memory rate limiter', async () => {
      const config: RateLimitConfig = { limit: 2, window: 60 };
      const rateLimiter = createInMemoryRateLimiter(config);

      const actor = createTestActor();
      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.use('*', createRateLimitMiddleware(rateLimiter, config));
      app.get('/test', (c) => c.json({ ok: true }));

      // First 2 requests succeed
      const res1 = await app.request('/test');
      expect(res1.status).toBe(200);

      const res2 = await app.request('/test');
      expect(res2.status).toBe(200);

      // 3rd request fails
      const res3 = await app.request('/test');
      expect(res3.status).toBe(429);
    });
  });
});
