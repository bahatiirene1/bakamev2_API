/**
 * Rate Limiting Middleware
 * Uses Upstash Redis for distributed rate limiting
 *
 * Reference: docs/stage-3b-expand-api.md Section 11.3
 */

import type { Context, Next } from 'hono';

import type { ActorContext } from '@/types/index.js';

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /**
   * Maximum requests allowed in the window
   */
  limit: number;

  /**
   * Window duration in seconds
   */
  window: number;

  /**
   * Optional: Get identifier from context (defaults to IP)
   */
  getIdentifier?: (c: Context) => string;
}

/**
 * Rate limit result from Upstash
 */
export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
}

/**
 * Rate limiter interface (injectable for testing)
 */
export interface RateLimiter {
  limit: (identifier: string) => Promise<RateLimitResult>;
}

/**
 * Default rate limit config
 */
export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  limit: 100,
  window: 60, // 100 requests per minute
};

/**
 * Get identifier from context
 * Priority: userId > IP > 'anonymous'
 */
function defaultGetIdentifier(c: Context): string {
  const actor = c.get('actor') as ActorContext | undefined;
  if (actor?.userId) {
    return `user:${actor.userId}`;
  }
  const ip =
    c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
  return `ip:${ip}`;
}

/**
 * Create rate limit middleware
 *
 * @param rateLimiter - Rate limiter instance (from Upstash)
 * @param config - Rate limit configuration
 */
export function createRateLimitMiddleware(
  rateLimiter: RateLimiter,
  config: RateLimitConfig = DEFAULT_RATE_LIMIT_CONFIG
) {
  const getIdentifier = config.getIdentifier || defaultGetIdentifier;

  return async function rateLimitMiddleware(c: Context, next: Next) {
    const identifier = getIdentifier(c);

    const result = await rateLimiter.limit(identifier);

    // Set rate limit headers
    c.header('X-RateLimit-Limit', result.limit.toString());
    c.header('X-RateLimit-Remaining', result.remaining.toString());
    c.header('X-RateLimit-Reset', result.reset.toString());

    if (!result.success) {
      const actor = c.get('actor') as ActorContext | undefined;
      const requestId =
        actor?.requestId ??
        (c.get('requestId') as string | undefined) ??
        'unknown';

      return c.json(
        {
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests',
            details: {
              retryAfter: result.reset,
              limit: result.limit,
            },
            requestId,
          },
        },
        429
      );
    }

    return next();
  };
}

/**
 * Create Upstash rate limiter
 * This is the production implementation using @upstash/ratelimit
 *
 * Usage:
 * ```typescript
 * import { Ratelimit } from '@upstash/ratelimit';
 * import { Redis } from '@upstash/redis';
 *
 * const ratelimit = new Ratelimit({
 *   redis: Redis.fromEnv(),
 *   limiter: Ratelimit.slidingWindow(100, '1 m'),
 *   analytics: true,
 * });
 *
 * const rateLimiter = createUpstashRateLimiter(ratelimit);
 * ```
 */
export function createUpstashRateLimiter(upstashRatelimit: any): RateLimiter {
  return {
    async limit(identifier: string): Promise<RateLimitResult> {
      const result = await upstashRatelimit.limit(identifier);
      return {
        success: result.success,
        limit: result.limit,
        remaining: result.remaining,
        reset: result.reset,
      };
    },
  };
}

/**
 * Create in-memory rate limiter (for testing/development)
 */
export function createInMemoryRateLimiter(
  config: RateLimitConfig
): RateLimiter {
  const store = new Map<string, { count: number; resetAt: number }>();

  return {
    async limit(identifier: string): Promise<RateLimitResult> {
      const now = Date.now();
      const windowMs = config.window * 1000;
      const resetAt = now + windowMs;

      let entry = store.get(identifier);

      // Check if window has expired
      if (entry && entry.resetAt <= now) {
        entry = undefined;
        store.delete(identifier);
      }

      if (!entry) {
        entry = { count: 0, resetAt };
        store.set(identifier, entry);
      }

      entry.count++;

      const remaining = Math.max(0, config.limit - entry.count);
      const success = entry.count <= config.limit;

      return {
        success,
        limit: config.limit,
        remaining,
        reset: Math.ceil((entry.resetAt - now) / 1000),
      };
    },
  };
}
