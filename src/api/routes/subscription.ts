/**
 * Subscription Routes
 * Endpoints for subscription and usage information
 *
 * Reference: docs/stage-3b-expand-api.md Section 8
 */

import type { Context } from 'hono';
import { Hono } from 'hono';

import type { ActorContext, Result } from '@/types/index.js';

import { errorResponse } from '../utils/response.js';

/**
 * Subscription data shape
 */
interface Subscription {
  id: string;
  userId: string;
  planCode: string;
  planName: string;
  status: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
}

/**
 * Usage data shape
 */
interface UsageSummary {
  period: {
    start?: Date;
    end?: Date;
  };
  usage: Array<{
    featureCode: string;
    featureName: string;
    used: number;
    limit: number;
    percentage: number;
  }>;
}

/**
 * Entitlement data shape
 */
interface Entitlement {
  featureCode: string;
  type: 'metered' | 'boolean';
  limit?: number;
  enabled?: boolean;
  resetPeriod?: string;
}

/**
 * Subscription service interface (minimal for routes)
 */
interface SubscriptionServiceDep {
  getSubscription: (
    actor: ActorContext,
    userId: string
  ) => Promise<Result<Subscription>>;
  getUsageSummary: (
    actor: ActorContext,
    params: { userId: string; period?: string }
  ) => Promise<Result<UsageSummary>>;
  getEntitlements: (
    actor: ActorContext,
    userId: string
  ) => Promise<Result<Entitlement[]>>;
}

interface SubscriptionRoutesDeps {
  subscriptionService: SubscriptionServiceDep;
}

/**
 * Helper to get actor from context
 */
function getActor(c: Context): ActorContext {
  return c.get('actor');
}

/**
 * Helper to get request ID from context
 */
function getRequestId(c: Context): string {
  return c.get('requestId') || getActor(c).requestId;
}

/**
 * Format date to ISO string
 */
function formatDate(date: Date): string {
  return date.toISOString();
}

/**
 * Create subscription routes
 */
export function createSubscriptionRoutes(deps: SubscriptionRoutesDeps): Hono {
  const { subscriptionService } = deps;
  const app = new Hono();

  /**
   * GET /subscription
   * Get current subscription
   */
  app.get('/subscription', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);

    if (!actor.userId) {
      return c.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'User ID not found in token',
            requestId,
          },
        },
        401
      );
    }

    const result = await subscriptionService.getSubscription(
      actor,
      actor.userId
    );

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json({
      data: {
        id: result.data.id,
        userId: result.data.userId,
        planCode: result.data.planCode,
        planName: result.data.planName,
        status: result.data.status,
        currentPeriodStart: formatDate(result.data.currentPeriodStart),
        currentPeriodEnd: formatDate(result.data.currentPeriodEnd),
        cancelAtPeriodEnd: result.data.cancelAtPeriodEnd,
      },
      meta: { requestId },
    });
  });

  /**
   * GET /subscription/usage
   * Get usage summary
   */
  app.get('/subscription/usage', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);

    if (!actor.userId) {
      return c.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'User ID not found in token',
            requestId,
          },
        },
        401
      );
    }

    const period = c.req.query('period');

    const result = await subscriptionService.getUsageSummary(actor, {
      userId: actor.userId,
      ...(period !== undefined && { period }),
    });

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json({
      data: {
        period: {
          start: result.data.period.start
            ? formatDate(result.data.period.start)
            : undefined,
          end: result.data.period.end
            ? formatDate(result.data.period.end)
            : undefined,
        },
        usage: result.data.usage,
      },
      meta: { requestId },
    });
  });

  /**
   * GET /subscription/entitlements
   * Get active entitlements
   */
  app.get('/subscription/entitlements', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);

    if (!actor.userId) {
      return c.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'User ID not found in token',
            requestId,
          },
        },
        401
      );
    }

    const result = await subscriptionService.getEntitlements(
      actor,
      actor.userId
    );

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json({
      data: result.data,
      meta: { requestId },
    });
  });

  return app;
}
