/**
 * Knowledge Routes
 * Endpoints for knowledge base management
 *
 * Reference: docs/stage-3b-expand-api.md Section 6
 */

import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';

import type {
  ActorContext,
  KnowledgeItem,
  KnowledgeSearchResult,
  Result,
} from '@/types/index.js';

import { errorResponse } from '../utils/response.js';

/**
 * Max pagination limit
 */
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

/**
 * Knowledge service interface (minimal for routes)
 */
interface KnowledgeServiceDep {
  createKnowledgeItem: (
    actor: ActorContext,
    params: {
      title: string;
      content: string;
      category?: string;
      metadata?: Record<string, unknown>;
    }
  ) => Promise<Result<KnowledgeItem>>;
  getKnowledgeItem: (
    actor: ActorContext,
    itemId: string
  ) => Promise<Result<KnowledgeItem>>;
  listKnowledgeItems: (
    actor: ActorContext,
    params: {
      status?: string;
      category?: string;
      cursor?: string;
      limit: number;
    }
  ) => Promise<
    Result<{
      items: KnowledgeItem[];
      nextCursor: string | null;
      hasMore: boolean;
    }>
  >;
  updateKnowledgeItem: (
    actor: ActorContext,
    itemId: string,
    updates: {
      title?: string;
      content?: string;
      category?: string;
      metadata?: Record<string, unknown>;
    }
  ) => Promise<Result<KnowledgeItem>>;
  searchKnowledge: (
    actor: ActorContext,
    params: {
      query: string;
      limit?: number;
      minSimilarity?: number;
      categories?: string[];
    }
  ) => Promise<Result<KnowledgeSearchResult[]>>;
  submitForReview: (
    actor: ActorContext,
    itemId: string
  ) => Promise<Result<{ id: string; status: string }>>;
  approveItem: (
    actor: ActorContext,
    itemId: string,
    notes?: string
  ) => Promise<Result<void>>;
  rejectItem: (
    actor: ActorContext,
    itemId: string,
    reason: string
  ) => Promise<Result<void>>;
  publishItem: (actor: ActorContext, itemId: string) => Promise<Result<void>>;
  archiveItem: (
    actor: ActorContext,
    itemId: string,
    reason: string
  ) => Promise<Result<void>>;
}

interface KnowledgeRoutesDeps {
  knowledgeService: KnowledgeServiceDep;
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
  if (value === undefined || value === '') {
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
  return date !== null ? date.toISOString() : null;
}

/**
 * Formatted Knowledge Item Type
 */
interface FormattedKnowledgeItem {
  id: string;
  title: string;
  content: string;
  category: string | null;
  status: string;
  authorId: string;
  reviewerId: string | null;
  publishedAt: string | null;
  version: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Format knowledge item for response
 */
function formatKnowledgeItem(item: KnowledgeItem): FormattedKnowledgeItem {
  return {
    id: item.id,
    title: item.title,
    content: item.content,
    category: item.category,
    status: item.status,
    authorId: item.authorId,
    reviewerId: item.reviewerId,
    publishedAt: formatOptionalDate(item.publishedAt),
    version: item.version,
    metadata: item.metadata,
    createdAt: formatDate(item.createdAt),
    updatedAt: formatDate(item.updatedAt),
  };
}

// Zod Schemas
const createSchema = z.object({
  title: z.string().min(1, 'title is required and must be a non-empty string'),
  content: z
    .string()
    .min(1, 'content is required and must be a non-empty string'),
  category: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  category: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Create knowledge routes
 */
export function createKnowledgeRoutes(deps: KnowledgeRoutesDeps): Hono {
  const { knowledgeService } = deps;
  const app = new Hono();

  /**
   * GET /knowledge
   * List or search knowledge items
   */
  app.get('/knowledge', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);

    const search = c.req.query('search');
    const limit = parseLimit(c.req.query('limit'));
    const cursor = c.req.query('cursor');
    const status = c.req.query('status');
    const category = c.req.query('category');

    // If search query provided, use semantic search
    if (search !== undefined && search !== '') {
      const result = await knowledgeService.searchKnowledge(actor, {
        query: search,
        limit,
        ...(category !== undefined ? { categories: [category] } : {}),
      });

      if (!result.success) {
        return errorResponse(c, result.error, requestId);
      }

      return c.json({
        data: {
          items: result.data.map((r) => ({
            ...formatKnowledgeItem(r.item),
            chunk: r.chunk,
            chunkIndex: r.chunkIndex,
            similarity: r.similarity,
          })),
          nextCursor: null,
          hasMore: false,
        },
        meta: { requestId },
      });
    }

    // Standard list
    const result = await knowledgeService.listKnowledgeItems(actor, {
      limit,
      ...(cursor !== undefined ? { cursor } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(category !== undefined ? { category } : {}),
    });

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json({
      data: {
        items: result.data.items.map(formatKnowledgeItem),
        nextCursor: result.data.nextCursor,
        hasMore: result.data.hasMore,
      },
      meta: { requestId },
    });
  });

  /**
   * POST /knowledge
   * Create a new knowledge item (draft)
   */
  app.post('/knowledge', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json(
        {
          error: {
            code: 'INVALID_JSON',
            message: 'Invalid JSON body',
            requestId,
          },
        },
        400
      );
    }

    const validation = createSchema.safeParse(rawBody);

    if (!validation.success) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: validation.error.issues[0]?.message ?? 'Validation error',
            requestId,
          },
        },
        400
      );
    }

    const body = validation.data;

    const result = await knowledgeService.createKnowledgeItem(actor, {
      title: body.title,
      content: body.content,
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      ...(body.category !== undefined ? { category: body.category } : {}),
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
    });

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json(
      {
        data: formatKnowledgeItem(result.data),
        meta: { requestId },
      },
      201
    );
  });

  /**
   * GET /knowledge/:id
   * Get knowledge item by ID
   */
  app.get('/knowledge/:id', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);
    const itemId = c.req.param('id');

    const result = await knowledgeService.getKnowledgeItem(actor, itemId);

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json({
      data: formatKnowledgeItem(result.data),
      meta: { requestId },
    });
  });

  /**
   * PATCH /knowledge/:id
   * Update knowledge item
   */
  app.patch('/knowledge/:id', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);
    const itemId = c.req.param('id');

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json(
        {
          error: {
            code: 'INVALID_JSON',
            message: 'Invalid JSON body',
            requestId,
          },
        },
        400
      );
    }

    const validation = updateSchema.safeParse(rawBody);

    if (!validation.success) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: validation.error.issues[0]?.message ?? 'Validation error',
            requestId,
          },
        },
        400
      );
    }

    const body = validation.data;

    const result = await knowledgeService.updateKnowledgeItem(actor, itemId, {
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      ...(body.title !== undefined ? { title: body.title } : {}),
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      ...(body.content !== undefined ? { content: body.content } : {}),
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      ...(body.category !== undefined ? { category: body.category } : {}),
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
    });

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json({
      data: formatKnowledgeItem(result.data),
      meta: { requestId },
    });
  });

  /**
   * POST /knowledge/:id/publish
   * Submit knowledge item for review/publish
   */
  app.post('/knowledge/:id/publish', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);
    const itemId = c.req.param('id');

    const result = await knowledgeService.submitForReview(actor, itemId);

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json({
      data: result.data,
      meta: { requestId },
    });
  });

  /**
   * POST /knowledge/:id/approve
   * Approve knowledge item (requires review permission)
   */
  app.post('/knowledge/:id/approve', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);
    const itemId = c.req.param('id');

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      rawBody = {};
    }

    const body = rawBody as { notes?: string };

    const result = await knowledgeService.approveItem(
      actor,
      itemId,
      body.notes
    );

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json({
      data: { id: itemId, status: 'approved' },
      meta: { requestId },
    });
  });

  /**
   * POST /knowledge/:id/reject
   * Reject knowledge item (requires review permission)
   */
  app.post('/knowledge/:id/reject', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);
    const itemId = c.req.param('id');

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      rawBody = {};
    }

    const body = rawBody as { reason?: string };

    if (body.reason === undefined || body.reason === '') {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'reason is required for rejection',
            requestId,
          },
        },
        400
      );
    }

    const result = await knowledgeService.rejectItem(
      actor,
      itemId,
      body.reason
    );

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json({
      data: { id: itemId, status: 'rejected' },
      meta: { requestId },
    });
  });

  /**
   * POST /knowledge/:id/finalize
   * Publish approved knowledge item (requires publish permission)
   */
  app.post('/knowledge/:id/finalize', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);
    const itemId = c.req.param('id');

    const result = await knowledgeService.publishItem(actor, itemId);

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json({
      data: { id: itemId, status: 'published' },
      meta: { requestId },
    });
  });

  /**
   * POST /knowledge/:id/archive
   * Archive knowledge item
   */
  app.post('/knowledge/:id/archive', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);
    const itemId = c.req.param('id');

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      rawBody = {};
    }

    const body = rawBody as { reason?: string };

    const result = await knowledgeService.archiveItem(
      actor,
      itemId,
      body.reason ?? 'No reason provided'
    );

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json({
      data: { id: itemId, status: 'archived' },
      meta: { requestId },
    });
  });

  return app;
}
