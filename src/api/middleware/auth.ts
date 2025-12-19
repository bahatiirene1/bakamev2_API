/**
 * Auth Middleware
 * Constructs ActorContext from Supabase JWT
 *
 * Reference: docs/stage-3a-minimal-api.md Section 3
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Context, Next } from 'hono';
import { nanoid } from 'nanoid';

import type { ActorContext } from '@/types/index.js';

/**
 * Auth middleware dependencies
 */
interface AuthMiddlewareDeps {
  supabaseClient: SupabaseClient;
  authService: {
    resolvePermissions: (userId: string) => Promise<{
      success: boolean;
      data?: string[];
      error?: { code: string; message: string };
    }>;
  };
  userService?: {
    getUser: (
      actor: ActorContext,
      userId: string
    ) => Promise<{ success: boolean; data?: unknown; error?: unknown }>;
    onUserSignup: (
      actor: ActorContext,
      params: { authUserId: string; email: string }
    ) => Promise<{ success: boolean; data?: unknown; error?: unknown }>;
  };
}

/**
 * Generate a unique request ID
 * Using nanoid for simplicity - in production, consider UUIDv7 for time-sorting
 */
function generateRequestId(): string {
  return nanoid();
}

/**
 * Check if user has admin-level permissions
 */
function isAdmin(permissions: string[]): boolean {
  return permissions.some(
    (p) =>
      p === '*' ||
      p.startsWith('admin:') ||
      p === 'user:manage' ||
      p === 'knowledge:publish'
  );
}

/**
 * Create auth middleware for protected routes
 * Extracts JWT, verifies with Supabase, constructs ActorContext
 */
export function createAuthMiddleware(deps: AuthMiddlewareDeps) {
  const { supabaseClient, authService, userService } = deps;

  return async function authMiddleware(c: Context, next: Next) {
    const requestId = generateRequestId();

    // 1. Extract token from Authorization header
    const authHeader = c.req.header('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Missing or invalid authorization header',
            requestId,
          },
        },
        401
      );
    }

    const token = authHeader.slice(7).trim();

    if (!token) {
      return c.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Missing or invalid authorization header',
            requestId,
          },
        },
        401
      );
    }

    try {
      // 2. Verify JWT with Supabase
      const {
        data: { user },
        error,
      } = await supabaseClient.auth.getUser(token);

      if (error || !user) {
        return c.json(
          {
            error: {
              code: 'UNAUTHORIZED',
              message: 'Invalid or expired token',
              requestId,
            },
          },
          401
        );
      }

      // 2.5 Ensure user exists in application database
      // This handles first-time users who authenticated via Supabase
      if (userService) {
        const systemActor: ActorContext = {
          type: 'system',
          requestId,
          permissions: ['*'],
        };

        // Check if user exists
        const existingUser = await userService.getUser(systemActor, user.id);

        if (!existingUser.success) {
          // User doesn't exist, create them
          const createResult = await userService.onUserSignup(systemActor, {
            authUserId: user.id,
            email: user.email ?? '',
          });

          if (!createResult.success) {
            console.error(
              'Failed to create user on first auth:',
              createResult.error
            );
            // Continue anyway - some features may not work but basic auth should
          }
        }
      }

      // 3. Resolve permissions via AuthService
      const permissionsResult = await authService.resolvePermissions(user.id);

      if (!permissionsResult.success) {
        return c.json(
          {
            error: {
              code: 'INTERNAL_ERROR',
              message: 'Failed to resolve permissions',
              requestId,
            },
          },
          500
        );
      }

      const permissions = permissionsResult.data ?? [];

      // 4. Construct ActorContext
      const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip');
      const userAgent = c.req.header('user-agent');

      const actor: ActorContext = {
        type: isAdmin(permissions) ? 'admin' : 'user',
        userId: user.id,
        requestId,
        permissions,
        ...(ip !== undefined && { ip }),
        ...(userAgent !== undefined && { userAgent }),
      };

      // 5. Attach to context
      c.set('actor', actor);
      c.set('requestId', requestId);

      // 6. Continue to next handler
      return next();
    } catch (err) {
      console.error('Auth middleware error:', err);
      return c.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Authentication failed',
            requestId,
          },
        },
        500
      );
    }
  };
}

/**
 * Create public middleware for routes that don't require auth
 * Creates an anonymous actor
 */
export function createPublicMiddleware() {
  return function publicMiddleware(c: Context, next: Next) {
    const requestId = generateRequestId();

    // Create anonymous actor
    const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip');
    const userAgent = c.req.header('user-agent');

    const actor: ActorContext = {
      type: 'anonymous',
      requestId,
      permissions: [],
      ...(ip !== undefined && { ip }),
      ...(userAgent !== undefined && { userAgent }),
    };

    c.set('actor', actor);
    c.set('requestId', requestId);

    return next();
  };
}
