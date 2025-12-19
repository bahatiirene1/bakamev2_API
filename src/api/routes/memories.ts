/**
 * Memory Routes
 * Endpoints for memory management (CRUD + search)
 *
 * Reference: docs/stage-3b-expand-api.md Section 5
 */

import type { Context } from 'hono';
import { Hono } from 'hono';

import type {
  ActorContext,
  Memory,
  MemorySearchResult,
  Result,
} from '@/types/index.js';

import { errorResponse } from '../utils/response.js';

/**
 * Max pagination limit
 */
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

/**
 * Memory service interface (minimal for routes)
 */
interface MemoryServiceDep {
  createMemory: (
    actor: ActorContext,
    params: {
      userId: string;
      content: string;
      category?: string;
      source: 'conversation' | 'user_input' | 'system';
      importance?: number;
    }
  ) => Promise<Result<Memory>>;
  getMemory: (actor: ActorContext, memoryId: string) => Promise<Result<Memory>>;
  listMemories: (
    actor: ActorContext,
    userId: string,
    params: {
      cursor?: string;
      limit: number;
      category?: string;
      status?: 'active' | 'archived';
    }
  ) => Promise<
    Result<{
      items: Memory[];
      nextCursor: string | null;
      hasMore: boolean;
    }>
  >;
  updateMemory: (
    actor: ActorContext,
    memoryId: string,
    updates: { content?: string; category?: string; importance?: number }
  ) => Promise<Result<Memory>>;
  archiveMemory: (
    actor: ActorContext,
    memoryId: string
  ) => Promise<Result<void>>;
  searchMemories: (
    actor: ActorContext,
    userId: string,
    params: {
      query: string;
      limit?: number;
      minSimilarity?: number;
      categories?: string[];
    }
  ) => Promise<Result<MemorySearchResult[]>>;
}

interface MemoryRoutesDeps {
  memoryService: MemoryServiceDep;
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
 * Parse limit query param
 */
function parseLimit(value: string | undefined): number {
  if (!value) {
    return DEFAULT_LIMIT;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < 1) {
    return DEFAULT_LIMIT;
  }
  return Math.min(parsed, MAX_LIMIT);
}

/**
 * Format date to ISO string
 */
function formatDate(date: Date): string {
  return date.toISOString();
}

/**
 * Format optional date
 */
function formatOptionalDate(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

/**
 * Validate importance value (1-10)
 */
function validateImportance(importance: unknown): {
  valid: boolean;
  error?: string;
} {
  if (importance === undefined) {
    return { valid: true };
  }
  if (typeof importance !== 'number' || importance < 1 || importance > 10) {
    return {
      valid: false,
      error: 'importance must be a number between 1 and 10',
    };
  }
  return { valid: true };
}

/**
 * Format memory for response
 */
function formatMemory(memory: Memory): {
  id: string;
  userId: string;
  content: string;
  category: string | null;
  source: string;
  importance: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastAccessed: string | null;
} {
  return {
    id: memory.id,
    userId: memory.userId,
    content: memory.content,
    category: memory.category,
    source: memory.source,
    importance: memory.importance,
    status: memory.status,
    createdAt: formatDate(memory.createdAt),
    updatedAt: formatDate(memory.updatedAt),
    lastAccessed: formatOptionalDate(memory.lastAccessed),
  };
}

/**
 * Create memory routes
 */
export function createMemoryRoutes(deps: MemoryRoutesDeps): Hono {
  const { memoryService } = deps;
  const app = new Hono();

  /**
   * GET /memories
   * List memories or search semantically
   */
  app.get('/memories', async (c) => {
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

    const search = c.req.query('search');
    const limit = parseLimit(c.req.query('limit'));
    const cursor = c.req.query('cursor');
    const category = c.req.query('category');
    const status = c.req.query('status') as 'active' | 'archived' | undefined;

    // If search query provided, use semantic search
    if (search) {
      const result = await memoryService.searchMemories(actor, actor.userId, {
        query: search,
        limit,
        ...(category !== undefined && { categories: [category] }),
      });

      if (!result.success) {
        return errorResponse(c, result.error, requestId);
      }

      return c.json({
        data: {
          items: result.data.map((r) => ({
            ...formatMemory(r.memory),
            similarity: r.similarity,
          })),
          nextCursor: null,
          hasMore: false,
        },
        meta: { requestId },
      });
    }

    // Standard list
    const result = await memoryService.listMemories(actor, actor.userId, {
      limit,
      ...(cursor !== undefined && { cursor }),
      ...(category !== undefined && { category }),
      ...(status !== undefined && { status }),
    });

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json({
      data: {
        items: result.data.items.map(formatMemory),
        nextCursor: result.data.nextCursor,
        hasMore: result.data.hasMore,
      },
      meta: { requestId },
    });
  });

  /**
   * POST /memories
   * Create a new memory
   */
  app.post('/memories', async (c) => {
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

    let body: { content?: string; category?: string; importance?: number } = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }

    // Validate content
    if (!body.content || typeof body.content !== 'string') {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'content is required and must be a string',
            requestId,
          },
        },
        400
      );
    }

    if (body.content.trim() === '') {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'content cannot be empty',
            requestId,
          },
        },
        400
      );
    }

    // Validate importance
    const importanceValidation = validateImportance(body.importance);
    if (!importanceValidation.valid) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: importanceValidation.error,
            requestId,
          },
        },
        400
      );
    }

    // Always 'user_input' source for API-created memories
    const result = await memoryService.createMemory(actor, {
      userId: actor.userId,
      content: body.content,
      source: 'user_input',
      ...(body.category !== undefined && { category: body.category }),
      ...(body.importance !== undefined && { importance: body.importance }),
    });

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json(
      {
        data: formatMemory(result.data),
        meta: { requestId },
      },
      201
    );
  });

  /**
   * GET /memories/:id
   * Get memory by ID
   */
  app.get('/memories/:id', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);
    const memoryId = c.req.param('id');

    const result = await memoryService.getMemory(actor, memoryId);

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json({
      data: formatMemory(result.data),
      meta: { requestId },
    });
  });

  /**
   * PATCH /memories/:id
   * Update memory
   */
  app.patch('/memories/:id', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);
    const memoryId = c.req.param('id');

    let body: { content?: string; category?: string; importance?: number } = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }

    // Validate importance if provided
    const importanceValidation = validateImportance(body.importance);
    if (!importanceValidation.valid) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: importanceValidation.error,
            requestId,
          },
        },
        400
      );
    }

    const result = await memoryService.updateMemory(actor, memoryId, {
      ...(body.content !== undefined && { content: body.content }),
      ...(body.category !== undefined && { category: body.category }),
      ...(body.importance !== undefined && { importance: body.importance }),
    });

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json({
      data: formatMemory(result.data),
      meta: { requestId },
    });
  });

  /**
   * DELETE /memories/:id
   * Archive memory (soft delete)
   */
  app.delete('/memories/:id', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);
    const memoryId = c.req.param('id');

    const result = await memoryService.archiveMemory(actor, memoryId);

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.body(null, 204);
  });

  return app;
}
