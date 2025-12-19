/**
 * Chat Routes
 * Endpoints for chat and message management
 *
 * Reference: docs/stage-3a-minimal-api.md Section 5
 */

import type { Context } from 'hono';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import type { Orchestrator } from '@/orchestrator/index.js';
import type {
  ActorContext,
  Result,
  OrchestratorInput,
  StreamEvent,
} from '@/types/index.js';

import { errorResponse } from '../utils/response.js';

/**
 * Message max length
 */
const MAX_MESSAGE_LENGTH = 32000;

/**
 * Max pagination limit
 */
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

/**
 * Chat service interface (minimal for routes)
 */
interface ChatServiceDep {
  createChat: (
    actor: ActorContext,
    params: { title?: string; metadata?: Record<string, unknown> }
  ) => Promise<
    Result<{
      id: string;
      userId: string;
      title: string | null;
      status: string;
      createdAt: Date;
      updatedAt: Date;
    }>
  >;
  getChat: (
    actor: ActorContext,
    chatId: string
  ) => Promise<
    Result<{
      id: string;
      userId: string;
      title: string | null;
      status: string;
      metadata: Record<string, unknown>;
      createdAt: Date;
      updatedAt: Date;
    }>
  >;
  listChats: (
    actor: ActorContext,
    params: { limit?: number; cursor?: string; status?: string }
  ) => Promise<
    Result<{
      items: Array<{
        id: string;
        title: string | null;
        status: string;
        createdAt: Date;
        updatedAt: Date;
        messageCount?: number;
      }>;
      nextCursor: string | null;
      hasMore: boolean;
    }>
  >;
  updateChat: (
    actor: ActorContext,
    chatId: string,
    data: { title?: string }
  ) => Promise<
    Result<{
      id: string;
      title: string | null;
      status: string;
      createdAt: Date;
      updatedAt: Date;
    }>
  >;
  archiveChat: (
    actor: ActorContext,
    chatId: string
  ) => Promise<Result<{ id: string; status: string }>>;
  addMessage: (
    actor: ActorContext,
    params: {
      chatId: string;
      role: 'user' | 'assistant' | 'system' | 'tool';
      content: string;
      metadata?: Record<string, unknown>;
    }
  ) => Promise<
    Result<{
      id: string;
      chatId: string;
      role: string;
      content: string;
      createdAt: Date;
    }>
  >;
  getMessages: (
    actor: ActorContext,
    chatId: string,
    params: { limit?: number; cursor?: string }
  ) => Promise<
    Result<{
      items: Array<{
        id: string;
        chatId: string;
        role: string;
        content: string;
        metadata: Record<string, unknown>;
        createdAt: Date;
      }>;
      nextCursor: string | null;
      hasMore: boolean;
    }>
  >;
}

interface ChatRoutesDeps {
  chatService: ChatServiceDep;
  /** Optional orchestrator for AI streaming (Phase 5) */
  orchestrator?: Orchestrator;
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
 * Create chat routes
 */
export function createChatRoutes(deps: ChatRoutesDeps): Hono {
  const { chatService, orchestrator } = deps;
  const app = new Hono();

  /**
   * POST /chats
   * Create a new chat
   */
  app.post('/chats', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);

    let body: { title?: string; metadata?: Record<string, unknown> } = {};
    try {
      body = await c.req.json();
    } catch {
      // Empty body is fine
    }

    const result = await chatService.createChat(actor, {
      ...(body.title !== undefined && { title: body.title }),
      ...(body.metadata !== undefined && { metadata: body.metadata }),
    });

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json(
      {
        data: {
          id: result.data.id,
          title: result.data.title,
          status: result.data.status,
          createdAt: formatDate(result.data.createdAt),
          updatedAt: formatDate(result.data.updatedAt),
        },
        meta: { requestId },
      },
      201
    );
  });

  /**
   * GET /chats
   * List user's chats
   */
  app.get('/chats', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);

    const limit = parseLimit(c.req.query('limit'));
    const cursor = c.req.query('cursor');
    const status = c.req.query('status');

    const result = await chatService.listChats(actor, {
      limit,
      ...(cursor !== undefined && { cursor }),
      ...(status !== undefined && { status }),
    });

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json({
      data: {
        items: result.data.items.map((chat) => ({
          id: chat.id,
          title: chat.title,
          status: chat.status,
          messageCount: chat.messageCount,
          createdAt: formatDate(chat.createdAt),
          updatedAt: formatDate(chat.updatedAt),
        })),
        nextCursor: result.data.nextCursor,
        hasMore: result.data.hasMore,
      },
      meta: { requestId },
    });
  });

  /**
   * GET /chats/:id
   * Get chat details
   */
  app.get('/chats/:id', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);
    const chatId = c.req.param('id');

    const result = await chatService.getChat(actor, chatId);

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json({
      data: {
        id: result.data.id,
        title: result.data.title,
        status: result.data.status,
        metadata: result.data.metadata,
        createdAt: formatDate(result.data.createdAt),
        updatedAt: formatDate(result.data.updatedAt),
      },
      meta: { requestId },
    });
  });

  /**
   * PATCH /chats/:id
   * Update chat
   */
  app.patch('/chats/:id', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);
    const chatId = c.req.param('id');

    let body: { title?: string } = {};
    try {
      body = await c.req.json();
    } catch {
      // Empty body is fine
    }

    const result = await chatService.updateChat(actor, chatId, {
      ...(body.title !== undefined && { title: body.title }),
    });

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json({
      data: {
        id: result.data.id,
        title: result.data.title,
        status: result.data.status,
        createdAt: formatDate(result.data.createdAt),
        updatedAt: formatDate(result.data.updatedAt),
      },
      meta: { requestId },
    });
  });

  /**
   * DELETE /chats/:id
   * Archive chat (soft delete)
   */
  app.delete('/chats/:id', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);
    const chatId = c.req.param('id');

    const result = await chatService.archiveChat(actor, chatId);

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.body(null, 204);
  });

  /**
   * POST /chats/:id/messages
   * Add message to chat
   */
  app.post('/chats/:id/messages', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);
    const chatId = c.req.param('id');

    let body: { content?: string } = {};
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

    if (body.content.length > MAX_MESSAGE_LENGTH) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: `content exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters`,
            requestId,
          },
        },
        400
      );
    }

    // Always 'user' role for API calls
    const result = await chatService.addMessage(actor, {
      chatId,
      role: 'user',
      content: body.content,
    });

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json(
      {
        data: {
          id: result.data.id,
          chatId: result.data.chatId,
          role: result.data.role,
          content: result.data.content,
          createdAt: formatDate(result.data.createdAt),
        },
        meta: { requestId },
      },
      201
    );
  });

  /**
   * GET /chats/:id/messages
   * Get messages in chat
   */
  app.get('/chats/:id/messages', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);
    const chatId = c.req.param('id');

    const limit = parseLimit(c.req.query('limit'));
    const cursor = c.req.query('cursor');

    const result = await chatService.getMessages(actor, chatId, {
      limit,
      ...(cursor !== undefined && { cursor }),
    });

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json({
      data: {
        items: result.data.items.map((msg) => ({
          id: msg.id,
          chatId: msg.chatId,
          role: msg.role,
          content: msg.content,
          metadata: msg.metadata,
          createdAt: formatDate(msg.createdAt),
        })),
        nextCursor: result.data.nextCursor,
        hasMore: result.data.hasMore,
      },
      meta: { requestId },
    });
  });

  /**
   * POST /chats/:id/stream
   * Stream AI response for a chat message
   *
   * Sends user message and streams AI response via SSE
   * Events: message.start, message.delta, tool.start, tool.complete, message.complete, error, done
   */
  app.post('/chats/:id/stream', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);
    const chatId = c.req.param('id');

    // Check if orchestrator is available
    if (!orchestrator) {
      return c.json(
        {
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'AI orchestrator not configured',
            requestId,
          },
        },
        503
      );
    }

    // Parse request body
    let body: { content?: string; model?: string } = {};
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

    if (body.content.length > MAX_MESSAGE_LENGTH) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: `content exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters`,
            requestId,
          },
        },
        400
      );
    }

    // First, add the user message to the chat
    const messageResult = await chatService.addMessage(actor, {
      chatId,
      role: 'user',
      content: body.content,
    });

    if (!messageResult.success) {
      return errorResponse(c, messageResult.error, requestId);
    }

    // Build orchestrator input
    const orchestratorInput: OrchestratorInput = {
      userMessage: body.content,
      chatId,
      userId: actor.userId ?? 'unknown',
      ...(body.model && {
        configOverrides: { model: body.model },
      }),
    };

    // Stream the response using SSE
    return streamSSE(c, async (stream) => {
      try {
        for await (const event of orchestrator.stream(orchestratorInput)) {
          // Format event as SSE data
          await stream.writeSSE({
            data: JSON.stringify(event),
            event: event.type,
          });
        }
      } catch (error) {
        // Send error event
        const errorEvent: StreamEvent = {
          type: 'error',
          code: 'STREAM_ERROR',
          message:
            error instanceof Error ? error.message : 'Unknown streaming error',
          timestamp: Date.now(),
        };
        await stream.writeSSE({
          data: JSON.stringify(errorEvent),
          event: 'error',
        });

        // Send done event
        await stream.writeSSE({
          data: JSON.stringify({ type: 'done', timestamp: Date.now() }),
          event: 'done',
        });
      }
    });
  });

  return app;
}
