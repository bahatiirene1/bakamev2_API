/**
 * Admin Routes
 * Endpoints for administrative operations
 *
 * Reference: docs/stage-3b-expand-api.md Section 9
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { Hono } from 'hono';
import type { Context } from 'hono';

import type { ActorContext, Result } from '@/types/index.js';

import { errorResponse } from '../utils/response.js';

/**
 * Max pagination limit
 */
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

/**
 * Admin service dependencies
 */
interface AdminServiceDeps {
  supabase: SupabaseClient;
  userService: {
    listUsers: (actor: ActorContext, params: any) => Promise<Result<any>>;
    getUser: (actor: ActorContext, userId: string) => Promise<Result<any>>;
    suspendUser: (
      actor: ActorContext,
      userId: string,
      reason: string
    ) => Promise<Result<void>>;
    reactivateUser: (
      actor: ActorContext,
      userId: string
    ) => Promise<Result<void>>;
    softDeleteUser: (
      actor: ActorContext,
      userId: string,
      reason?: string
    ) => Promise<Result<void>>;
  };
  auditService: {
    queryLogs: (actor: ActorContext, params: any) => Promise<Result<any>>;
  };
  promptService: {
    listPrompts: (actor: ActorContext, params: any) => Promise<Result<any>>;
    getPrompt: (actor: ActorContext, promptId: string) => Promise<Result<any>>;
    createPrompt: (actor: ActorContext, params: any) => Promise<Result<any>>;
    updatePrompt: (
      actor: ActorContext,
      promptId: string,
      data: any
    ) => Promise<Result<any>>;
    activatePrompt: (
      actor: ActorContext,
      promptId: string
    ) => Promise<Result<any>>;
  };
  approvalService: {
    listPendingRequests: (
      actor: ActorContext,
      params: any
    ) => Promise<Result<any>>;
    getRequest: (
      actor: ActorContext,
      requestId: string
    ) => Promise<Result<any>>;
    approve: (
      actor: ActorContext,
      requestId: string,
      comment?: string
    ) => Promise<Result<any>>;
    reject: (
      actor: ActorContext,
      requestId: string,
      reason: string
    ) => Promise<Result<any>>;
  };
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
function formatOptionalDate(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

/**
 * Create admin routes
 */
export function createAdminRoutes(deps: AdminServiceDeps): Hono {
  const {
    supabase,
    userService,
    auditService,
    promptService,
    approvalService,
  } = deps;
  const app = new Hono();

  // ─────────────────────────────────────────────────────────────
  // ADMIN DASHBOARD
  // ─────────────────────────────────────────────────────────────

  /**
   * GET /admin/dashboard/stats
   * Get dashboard statistics (admin)
   */
  app.get('/admin/dashboard/stats', async (c) => {
    const requestId = getRequestId(c);

    // Query real counts from Supabase
    const [
      usersResult,
      chatsResult,
      messagesResult,
      knowledgeResult,
      approvalsResult,
    ] = await Promise.all([
      supabase.from('users').select('*', { count: 'exact', head: true }),
      supabase.from('chats').select('*', { count: 'exact', head: true }),
      supabase.from('messages').select('*', { count: 'exact', head: true }),
      supabase
        .from('knowledge_items')
        .select('*', { count: 'exact', head: true }),
      supabase
        .from('approval_requests')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending'),
    ]);

    return c.json({
      data: {
        totalUsers: usersResult.count ?? 0,
        totalChats: chatsResult.count ?? 0,
        totalMessages: messagesResult.count ?? 0,
        totalKnowledgeItems: knowledgeResult.count ?? 0,
        pendingApprovals: approvalsResult.count ?? 0,
        // TODO: Implement historical data comparison for real trends
        trends: {
          users: { value: 12, direction: 'up' as const },
          chats: { value: 8, direction: 'up' as const },
          messages: { value: 24, direction: 'up' as const },
        },
      },
      meta: { requestId },
    });
  });

  /**
   * GET /admin/dashboard/activity
   * Get recent activity for dashboard (admin)
   */
  app.get('/admin/dashboard/activity', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);
    const limit = parseLimit(c.req.query('limit')) || 10;

    const result = await auditService.queryLogs(actor, { limit });

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json({
      data: {
        items: result.data.items.map((log: any) => ({
          id: log.id,
          action: log.action,
          actorType: log.actorType,
          actorId: log.actorId,
          resourceType: log.resourceType,
          resourceId: log.resourceId,
          timestamp: formatDate(log.timestamp),
          metadata: log.metadata,
        })),
        hasMore: result.data.hasMore,
      },
      meta: { requestId },
    });
  });

  /**
   * GET /admin/dashboard/health
   * Get system health status (admin)
   * TODO: Implement real health checks (DB connectivity, service pings)
   */
  app.get('/admin/dashboard/health', async (c) => {
    const requestId = getRequestId(c);

    // TODO: Replace static values with actual service health checks
    return c.json({
      data: {
        status: 'healthy',
        services: {
          database: { status: 'healthy', latency: 12 },
          api: { status: 'healthy', latency: 5 },
          cache: { status: 'healthy', latency: 2 },
        },
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      },
      meta: { requestId },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // ADMIN USERS
  // ─────────────────────────────────────────────────────────────

  /**
   * GET /admin/users
   * List users (admin)
   */
  app.get('/admin/users', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);

    const limit = parseLimit(c.req.query('limit'));
    const cursor = c.req.query('cursor');
    const status = c.req.query('status');
    const email = c.req.query('email_contains');

    const result = await userService.listUsers(actor, {
      limit,
      cursor,
      status,
      email,
    });

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json({
      data: {
        items: result.data.items.map((user: any) => ({
          id: user.id,
          email: user.email,
          status: user.status,
          createdAt: formatDate(user.createdAt),
          updatedAt: formatDate(user.updatedAt),
          deletedAt: formatOptionalDate(user.deletedAt),
        })),
        nextCursor: result.data.nextCursor,
        hasMore: result.data.hasMore,
      },
      meta: { requestId },
    });
  });

  /**
   * GET /admin/users/:id
   * Get user by ID (admin)
   */
  app.get('/admin/users/:id', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);
    const userId = c.req.param('id');

    const result = await userService.getUser(actor, userId);

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json({
      data: {
        id: result.data.id,
        email: result.data.email,
        status: result.data.status,
        createdAt: formatDate(result.data.createdAt),
        updatedAt: formatDate(result.data.updatedAt),
        deletedAt: formatOptionalDate(result.data.deletedAt),
      },
      meta: { requestId },
    });
  });

  /**
   * POST /admin/users/:id/suspend
   * Suspend user (admin)
   */
  app.post('/admin/users/:id/suspend', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);
    const userId = c.req.param('id');

    let body: { reason?: string } = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }

    const result = await userService.suspendUser(
      actor,
      userId,
      body.reason || 'No reason provided'
    );

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json({
      data: { success: true },
      meta: { requestId },
    });
  });

  /**
   * POST /admin/users/:id/reactivate
   * Reactivate user (admin)
   */
  app.post('/admin/users/:id/reactivate', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);
    const userId = c.req.param('id');

    const result = await userService.reactivateUser(actor, userId);

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json({
      data: { success: true },
      meta: { requestId },
    });
  });

  /**
   * DELETE /admin/users/:id
   * Soft delete user (admin)
   */
  app.delete('/admin/users/:id', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);
    const userId = c.req.param('id');

    let body: { reason?: string } = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }

    const result = await userService.softDeleteUser(actor, userId, body.reason);

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json({
      data: { success: true },
      meta: { requestId },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // ADMIN AUDIT
  // ─────────────────────────────────────────────────────────────

  /**
   * GET /admin/audit
   * Query audit logs (admin)
   */
  app.get('/admin/audit', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);

    const limit = parseLimit(c.req.query('limit'));
    const cursor = c.req.query('cursor');
    const actorId = c.req.query('actor_id');
    const action = c.req.query('action');
    const resourceType = c.req.query('resource_type');
    const from = c.req.query('from');
    const to = c.req.query('to');

    const result = await auditService.queryLogs(actor, {
      limit,
      cursor,
      actorId,
      action,
      resourceType,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json({
      data: {
        items: result.data.items.map((log: any) => ({
          id: log.id,
          timestamp: formatDate(log.timestamp),
          actorType: log.actorType,
          actorId: log.actorId,
          action: log.action,
          resourceType: log.resourceType,
          resourceId: log.resourceId,
          metadata: log.details, // Backend uses 'details', API returns as 'metadata'
          requestId: log.requestId,
        })),
        nextCursor: result.data.nextCursor,
        hasMore: result.data.hasMore,
      },
      meta: { requestId },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // ADMIN PROMPTS
  // ─────────────────────────────────────────────────────────────

  /**
   * GET /admin/prompts
   * List system prompts (admin)
   */
  app.get('/admin/prompts', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);

    const limit = parseLimit(c.req.query('limit'));
    const cursor = c.req.query('cursor');
    const status = c.req.query('status');

    const result = await promptService.listPrompts(actor, {
      limit,
      cursor,
      status,
    });

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json({
      data: {
        items: result.data.items.map((prompt: any) => ({
          id: prompt.id,
          name: prompt.name,
          content: prompt.content,
          status: prompt.status,
          version: prompt.version,
          createdAt: formatDate(prompt.createdAt),
          updatedAt: formatDate(prompt.updatedAt),
        })),
        nextCursor: result.data.nextCursor,
        hasMore: result.data.hasMore,
      },
      meta: { requestId },
    });
  });

  /**
   * POST /admin/prompts
   * Create system prompt (admin)
   */
  app.post('/admin/prompts', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);

    let body: {
      name?: string;
      content?: string;
      metadata?: Record<string, unknown>;
    } = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }

    // Validate
    if (!body.name || !body.content) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'name and content are required',
            requestId,
          },
        },
        400
      );
    }

    const result = await promptService.createPrompt(actor, {
      name: body.name,
      content: body.content,
      metadata: body.metadata,
    });

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json(
      {
        data: {
          id: result.data.id,
          name: result.data.name,
          content: result.data.content,
          status: result.data.status,
          version: result.data.version,
          createdAt: formatDate(result.data.createdAt),
          updatedAt: formatDate(result.data.updatedAt),
        },
        meta: { requestId },
      },
      201
    );
  });

  /**
   * GET /admin/prompts/:id
   * Get system prompt (admin)
   */
  app.get('/admin/prompts/:id', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);
    const promptId = c.req.param('id');

    const result = await promptService.getPrompt(actor, promptId);

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json({
      data: {
        id: result.data.id,
        name: result.data.name,
        content: result.data.content,
        status: result.data.status,
        version: result.data.version,
        createdAt: formatDate(result.data.createdAt),
        updatedAt: formatDate(result.data.updatedAt),
      },
      meta: { requestId },
    });
  });

  /**
   * PATCH /admin/prompts/:id
   * Update system prompt (admin)
   */
  app.patch('/admin/prompts/:id', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);
    const promptId = c.req.param('id');

    let body: {
      name?: string;
      content?: string;
      metadata?: Record<string, unknown>;
    } = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }

    const result = await promptService.updatePrompt(actor, promptId, body);

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json({
      data: {
        id: result.data.id,
        name: result.data.name,
        content: result.data.content,
        status: result.data.status,
        version: result.data.version,
        createdAt: formatDate(result.data.createdAt),
        updatedAt: formatDate(result.data.updatedAt),
      },
      meta: { requestId },
    });
  });

  /**
   * POST /admin/prompts/:id/activate
   * Activate system prompt (admin)
   */
  app.post('/admin/prompts/:id/activate', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);
    const promptId = c.req.param('id');

    const result = await promptService.activatePrompt(actor, promptId);

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json({
      data: result.data,
      meta: { requestId },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // ADMIN APPROVALS
  // ─────────────────────────────────────────────────────────────

  /**
   * GET /admin/approvals
   * List pending approvals (admin)
   */
  app.get('/admin/approvals', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);

    const limit = parseLimit(c.req.query('limit'));
    const cursor = c.req.query('cursor');
    const status = c.req.query('status');
    const type = c.req.query('type');

    const result = await approvalService.listPendingRequests(actor, {
      limit,
      cursor,
      status,
      resourceType: type,
    });

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json({
      data: {
        items: result.data.items.map((req: any) => ({
          id: req.id,
          resourceType: req.resourceType,
          resourceId: req.resourceId,
          action: req.action,
          status: req.status,
          requesterId: req.requesterId,
          reviewerId: req.reviewerId,
          requestNotes: req.requestNotes,
          reviewNotes: req.reviewNotes,
          createdAt: formatDate(req.createdAt),
          reviewedAt: formatOptionalDate(req.reviewedAt),
        })),
        nextCursor: result.data.nextCursor,
        hasMore: result.data.hasMore,
      },
      meta: { requestId },
    });
  });

  /**
   * GET /admin/approvals/:id
   * Get approval request (admin)
   */
  app.get('/admin/approvals/:id', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);
    const approvalId = c.req.param('id');

    const result = await approvalService.getRequest(actor, approvalId);

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json({
      data: result.data,
      meta: { requestId },
    });
  });

  /**
   * POST /admin/approvals/:id
   * Action on approval request (approve/reject)
   */
  app.post('/admin/approvals/:id', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);
    const approvalId = c.req.param('id');

    let body: { action?: string; comment?: string } = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }

    if (body.action === 'approve') {
      const result = await approvalService.approve(
        actor,
        approvalId,
        body.comment
      );
      if (!result.success) {
        return errorResponse(c, result.error, requestId);
      }
      return c.json({
        data: result.data,
        meta: { requestId },
      });
    } else if (body.action === 'reject') {
      const result = await approvalService.reject(
        actor,
        approvalId,
        body.comment || 'No reason provided'
      );
      if (!result.success) {
        return errorResponse(c, result.error, requestId);
      }
      return c.json({
        data: result.data,
        meta: { requestId },
      });
    }

    return c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'action must be "approve" or "reject"',
          requestId,
        },
      },
      400
    );
  });

  return app;
}
