/**
 * User Routes
 * Endpoints for user profile and preferences management
 *
 * Reference: docs/stage-3b-expand-api.md Section 4
 */

import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';

import type {
  ActorContext,
  AIPreferences,
  Profile,
  Result,
} from '@/types/index.js';

import { errorResponse } from '../utils/response.js';

/**
 * User service interface (minimal for routes)
 */
interface UserServiceDep {
  getProfile: (actor: ActorContext, userId: string) => Promise<Result<Profile>>;
  updateProfile: (
    actor: ActorContext,
    userId: string,
    updates: {
      displayName?: string | null;
      avatarUrl?: string | null;
      timezone?: string;
      locale?: string;
    }
  ) => Promise<Result<Profile>>;
  getAIPreferences: (
    actor: ActorContext,
    userId: string
  ) => Promise<Result<AIPreferences>>;
  updateAIPreferences: (
    actor: ActorContext,
    userId: string,
    updates: {
      responseLength?: 'concise' | 'balanced' | 'detailed';
      formality?: 'casual' | 'neutral' | 'formal';
      allowMemory?: boolean;
      allowWebSearch?: boolean;
      customInstructions?: string | null;
    }
  ) => Promise<Result<AIPreferences>>;
}

interface UserRoutesDeps {
  userService: UserServiceDep;
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

// Zod Schemas
const profileUpdateSchema = z.object({
  displayName: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
  timezone: z.string().optional(),
  locale: z.string().optional(),
});

const preferencesUpdateSchema = z.object({
  responseLength: z.enum(['concise', 'balanced', 'detailed']).optional(),
  formality: z.enum(['casual', 'neutral', 'formal']).optional(),
  allowMemory: z.boolean().optional(),
  allowWebSearch: z.boolean().optional(),
  customInstructions: z.string().nullable().optional(),
});

/**
 * Create user routes
 */
export function createUserRoutes(deps: UserRoutesDeps): Hono {
  const { userService } = deps;
  const app = new Hono();

  /**
   * GET /users/me
   * Get current user's profile
   */
  app.get('/users/me', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);
    const userId = actor.userId;

    if (userId === undefined || userId === '') {
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

    const result = await userService.getProfile(actor, userId);

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json({
      data: {
        id: result.data.id,
        userId: result.data.userId,
        displayName: result.data.displayName,
        avatarUrl: result.data.avatarUrl,
        timezone: result.data.timezone,
        locale: result.data.locale,
        createdAt: formatDate(result.data.createdAt),
        updatedAt: formatDate(result.data.updatedAt),
      },
      meta: { requestId },
    });
  });

  /**
   * PATCH /users/me
   * Update current user's profile
   */
  app.patch('/users/me', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);
    const userId = actor.userId;

    if (userId === undefined || userId === '') {
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

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      rawBody = {};
    }

    const validation = profileUpdateSchema.safeParse(rawBody);
    if (!validation.success) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message:
              validation.error.issues[0]?.message ?? 'Invalid profile data',
            requestId,
          },
        },
        400
      );
    }

    const body = validation.data;

    const result = await userService.updateProfile(actor, userId, {
      ...(body.displayName !== undefined && { displayName: body.displayName }),
      ...(body.avatarUrl !== undefined && { avatarUrl: body.avatarUrl }),
      ...(body.timezone !== undefined && { timezone: body.timezone }),
      ...(body.locale !== undefined && { locale: body.locale }),
    });

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json({
      data: {
        id: result.data.id,
        userId: result.data.userId,
        displayName: result.data.displayName,
        avatarUrl: result.data.avatarUrl,
        timezone: result.data.timezone,
        locale: result.data.locale,
        createdAt: formatDate(result.data.createdAt),
        updatedAt: formatDate(result.data.updatedAt),
      },
      meta: { requestId },
    });
  });

  /**
   * GET /users/me/preferences
   * Get current user's AI preferences
   */
  app.get('/users/me/preferences', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);
    const userId = actor.userId;

    if (userId === undefined || userId === '') {
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

    const result = await userService.getAIPreferences(actor, userId);

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json({
      data: {
        id: result.data.id,
        userId: result.data.userId,
        responseLength: result.data.responseLength,
        formality: result.data.formality,
        allowMemory: result.data.allowMemory,
        allowWebSearch: result.data.allowWebSearch,
        customInstructions: result.data.customInstructions,
        createdAt: formatDate(result.data.createdAt),
        updatedAt: formatDate(result.data.updatedAt),
      },
      meta: { requestId },
    });
  });

  /**
   * PUT /users/me/preferences
   * Update current user's AI preferences
   */
  app.put('/users/me/preferences', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);
    const userId = actor.userId;

    if (userId === undefined || userId === '') {
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

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      rawBody = {};
    }

    const validation = preferencesUpdateSchema.safeParse(rawBody);
    if (!validation.success) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message:
              validation.error.issues[0]?.message ?? 'Invalid preferences data',
            requestId,
          },
        },
        400
      );
    }

    const body = validation.data;

    const result = await userService.updateAIPreferences(actor, userId, {
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      ...(body.responseLength !== undefined
        ? { responseLength: body.responseLength }
        : {}),
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      ...(body.formality !== undefined ? { formality: body.formality } : {}),
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      ...(body.allowMemory !== undefined
        ? { allowMemory: body.allowMemory }
        : {}),
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      ...(body.allowWebSearch !== undefined
        ? { allowWebSearch: body.allowWebSearch }
        : {}),
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      ...(body.customInstructions !== undefined
        ? { customInstructions: body.customInstructions }
        : {}),
    });

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json({
      data: {
        id: result.data.id,
        userId: result.data.userId,
        responseLength: result.data.responseLength,
        formality: result.data.formality,
        allowMemory: result.data.allowMemory,
        allowWebSearch: result.data.allowWebSearch,
        customInstructions: result.data.customInstructions,
        createdAt: formatDate(result.data.createdAt),
        updatedAt: formatDate(result.data.updatedAt),
      },
      meta: { requestId },
    });
  });

  return app;
}
