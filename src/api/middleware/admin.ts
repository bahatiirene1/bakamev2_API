/**
 * Admin Middleware
 * Checks for admin permissions on protected routes
 *
 * Reference: docs/stage-3b-expand-api.md Section 11.2
 */

import type { Context, Next } from 'hono';

import type { ActorContext } from '@/types/index.js';

/**
 * Admin middleware - verifies actor has admin permissions
 */
export function createAdminMiddleware() {
  return async function adminMiddleware(
    c: Context,
    next: Next
  ): Promise<Response | void> {
    const actor = c.get('actor') as ActorContext | undefined;
    const requestId =
      actor?.requestId ??
      (c.get('requestId') as string | undefined) ??
      'unknown';

    if (actor === undefined) {
      return c.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
            requestId,
          },
        },
        401
      );
    }

    // Check for any admin permission
    const hasAdminPermission = actor.permissions.some(
      (p) => p.startsWith('admin:') || p === '*'
    );

    if (!hasAdminPermission) {
      return c.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'Admin access required',
            requestId,
          },
        },
        403
      );
    }

    await next();
  };
}

/**
 * Check if actor has specific admin permission
 */
export function hasAdminPermission(
  actor: ActorContext,
  permission: string
): boolean {
  return (
    actor.permissions.includes('*') ||
    actor.permissions.includes('admin:*') ||
    actor.permissions.includes(permission)
  );
}
