/**
 * API Contract Tests
 * Verifies API response shapes, status codes, and error formats
 *
 * These tests ensure the API contract remains stable across changes.
 * They test the HTTP interface, not business logic.
 */

import { Hono } from 'hono';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createAdminRoutes } from '@/api/routes/admin.js';
import { createChatRoutes } from '@/api/routes/chats.js';
import { createHealthRoutes } from '@/api/routes/health.js';
import { createKnowledgeRoutes } from '@/api/routes/knowledge.js';
import { createMemoryRoutes } from '@/api/routes/memories.js';
import { createSubscriptionRoutes } from '@/api/routes/subscription.js';
import { createToolRoutes } from '@/api/routes/tools.js';
import { createUserRoutes } from '@/api/routes/users.js';
import type { ActorContext } from '@/types/index.js';

// ─────────────────────────────────────────────────────────────
// TEST HELPERS
// ─────────────────────────────────────────────────────────────

function createUserActor(overrides?: Partial<ActorContext>): ActorContext {
  return {
    type: 'user',
    userId: 'user-123',
    requestId: 'req-123',
    permissions: ['chat:read', 'chat:write', 'memory:read', 'memory:write'],
    ...overrides,
  };
}

function createAdminActor(overrides?: Partial<ActorContext>): ActorContext {
  return {
    type: 'admin',
    userId: 'admin-123',
    requestId: 'req-admin',
    permissions: ['admin:*'],
    ...overrides,
  };
}

function mockAuthMiddleware(actor: ActorContext) {
  return async (c: any, next: any) => {
    c.set('actor', actor);
    c.set('requestId', actor.requestId);
    await next();
  };
}

// ─────────────────────────────────────────────────────────────
// CONTRACT: Response Shape Validators
// ─────────────────────────────────────────────────────────────

function expectSuccessResponse(body: unknown): void {
  expect(body).toHaveProperty('data');
  expect(body).toHaveProperty('meta');
  expect((body as any).meta).toHaveProperty('requestId');
}

function expectErrorResponse(body: unknown): void {
  expect(body).toHaveProperty('error');
  expect((body as any).error).toHaveProperty('code');
  expect((body as any).error).toHaveProperty('message');
  expect((body as any).error).toHaveProperty('requestId');
}

function expectPaginatedResponse(body: unknown): void {
  expectSuccessResponse(body);
  const data = (body as any).data;
  expect(data).toHaveProperty('items');
  expect(Array.isArray(data.items)).toBe(true);
  expect(data).toHaveProperty('nextCursor');
  expect(data).toHaveProperty('hasMore');
}

function expectDateString(value: unknown): void {
  expect(typeof value).toBe('string');
  expect(new Date(value as string).toISOString()).toBe(value);
}

// ─────────────────────────────────────────────────────────────
// CONTRACT: Health Endpoints
// ─────────────────────────────────────────────────────────────

describe('Contract: Health Endpoints', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.route('/api/v1', createHealthRoutes());
  });

  describe('GET /api/v1/health', () => {
    it('returns 200 with status ok', async () => {
      const res = await app.request('/api/v1/health');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('status', 'ok');
      expect(body).toHaveProperty('timestamp');
      expectDateString(body.timestamp);
    });

    it('returns version field', async () => {
      const res = await app.request('/api/v1/health');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('version');
    });
  });
});

// ─────────────────────────────────────────────────────────────
// CONTRACT: Chat Endpoints
// ─────────────────────────────────────────────────────────────

describe('Contract: Chat Endpoints', () => {
  let app: Hono;
  let mockChatService: any;

  beforeEach(() => {
    mockChatService = {
      createChat: vi.fn(),
      getChat: vi.fn(),
      listChats: vi.fn(),
      updateChat: vi.fn(),
      archiveChat: vi.fn(),
      addMessage: vi.fn(),
      getMessages: vi.fn(),
    };

    app = new Hono();
    app.use('*', mockAuthMiddleware(createUserActor()));
    app.route('/api/v1', createChatRoutes({ chatService: mockChatService }));
  });

  describe('POST /api/v1/chats', () => {
    it('returns 201 with chat data on success', async () => {
      mockChatService.createChat.mockResolvedValue({
        success: true,
        data: {
          id: 'chat-123',
          userId: 'user-123',
          title: 'Test Chat',
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      const res = await app.request('/api/v1/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Test Chat' }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expectSuccessResponse(body);
      expect(body.data).toHaveProperty('id');
      expect(body.data).toHaveProperty('title');
      expect(body.data).toHaveProperty('status');
      expectDateString(body.data.createdAt);
      expectDateString(body.data.updatedAt);
    });

    it('returns error response on service failure', async () => {
      mockChatService.createChat.mockResolvedValue({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Database error' },
      });

      const res = await app.request('/api/v1/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expectErrorResponse(body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /api/v1/chats', () => {
    it('returns 200 with paginated chat list', async () => {
      mockChatService.listChats.mockResolvedValue({
        success: true,
        data: {
          items: [
            {
              id: 'chat-1',
              title: 'Chat 1',
              status: 'active',
              messageCount: 5,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
          nextCursor: null,
          hasMore: false,
        },
      });

      const res = await app.request('/api/v1/chats');

      expect(res.status).toBe(200);
      const body = await res.json();
      expectPaginatedResponse(body);
      expect(body.data.items[0]).toHaveProperty('id');
      expect(body.data.items[0]).toHaveProperty('messageCount');
    });
  });

  describe('GET /api/v1/chats/:id', () => {
    it('returns 404 for non-existent chat', async () => {
      mockChatService.getChat.mockResolvedValue({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Chat not found' },
      });

      const res = await app.request('/api/v1/chats/nonexistent');

      expect(res.status).toBe(404);
      const body = await res.json();
      expectErrorResponse(body);
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('POST /api/v1/chats/:id/messages', () => {
    it('returns 400 for empty content', async () => {
      const res = await app.request('/api/v1/chats/chat-123/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expectErrorResponse(body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 201 with message data on success', async () => {
      mockChatService.addMessage.mockResolvedValue({
        success: true,
        data: {
          id: 'msg-123',
          chatId: 'chat-123',
          role: 'user',
          content: 'Hello',
          metadata: {},
          createdAt: new Date(),
        },
      });

      const res = await app.request('/api/v1/chats/chat-123/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hello' }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expectSuccessResponse(body);
      expect(body.data).toHaveProperty('id');
      expect(body.data).toHaveProperty('role');
      expect(body.data).toHaveProperty('content');
    });
  });

  describe('DELETE /api/v1/chats/:id', () => {
    it('returns 204 on successful archive', async () => {
      mockChatService.archiveChat.mockResolvedValue({ success: true });

      const res = await app.request('/api/v1/chats/chat-123', {
        method: 'DELETE',
      });

      expect(res.status).toBe(204);
    });
  });
});

// ─────────────────────────────────────────────────────────────
// CONTRACT: User Endpoints
// ─────────────────────────────────────────────────────────────

describe('Contract: User Endpoints', () => {
  let app: Hono;
  let mockUserService: any;

  beforeEach(() => {
    mockUserService = {
      getProfile: vi.fn(),
      updateProfile: vi.fn(),
      getAIPreferences: vi.fn(),
      updateAIPreferences: vi.fn(),
    };

    app = new Hono();
    app.use('*', mockAuthMiddleware(createUserActor()));
    app.route('/api/v1', createUserRoutes({ userService: mockUserService }));
  });

  describe('GET /api/v1/users/me', () => {
    it('returns 200 with profile data', async () => {
      mockUserService.getProfile.mockResolvedValue({
        success: true,
        data: {
          id: 'profile-123',
          userId: 'user-123',
          displayName: 'Test User',
          avatarUrl: null,
          timezone: 'UTC',
          locale: 'en',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      const res = await app.request('/api/v1/users/me');

      expect(res.status).toBe(200);
      const body = await res.json();
      expectSuccessResponse(body);
      expect(body.data).toHaveProperty('userId');
      expect(body.data).toHaveProperty('displayName');
      expect(body.data).toHaveProperty('timezone');
      expect(body.data).toHaveProperty('locale');
    });
  });

  describe('GET /api/v1/users/me/preferences', () => {
    it('returns 200 with AI preferences', async () => {
      mockUserService.getAIPreferences.mockResolvedValue({
        success: true,
        data: {
          id: 'pref-123',
          userId: 'user-123',
          responseLength: 'balanced',
          formality: 'neutral',
          allowMemory: true,
          allowWebSearch: true,
          customInstructions: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      const res = await app.request('/api/v1/users/me/preferences');

      expect(res.status).toBe(200);
      const body = await res.json();
      expectSuccessResponse(body);
      expect(body.data).toHaveProperty('responseLength');
      expect(body.data).toHaveProperty('formality');
      expect(body.data).toHaveProperty('allowMemory');
      expect(body.data).toHaveProperty('allowWebSearch');
    });
  });

  describe('PUT /api/v1/users/me/preferences', () => {
    it('returns 400 for invalid responseLength', async () => {
      const res = await app.request('/api/v1/users/me/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responseLength: 'invalid' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expectErrorResponse(body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});

// ─────────────────────────────────────────────────────────────
// CONTRACT: Memory Endpoints
// ─────────────────────────────────────────────────────────────

describe('Contract: Memory Endpoints', () => {
  let app: Hono;
  let mockMemoryService: any;

  beforeEach(() => {
    mockMemoryService = {
      createMemory: vi.fn(),
      getMemory: vi.fn(),
      listMemories: vi.fn(),
      updateMemory: vi.fn(),
      archiveMemory: vi.fn(),
      searchMemories: vi.fn(),
    };

    app = new Hono();
    app.use('*', mockAuthMiddleware(createUserActor()));
    app.route(
      '/api/v1',
      createMemoryRoutes({ memoryService: mockMemoryService })
    );
  });

  describe('POST /api/v1/memories', () => {
    it('returns 400 for missing content', async () => {
      const res = await app.request('/api/v1/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expectErrorResponse(body);
    });

    it('returns 400 for invalid importance', async () => {
      const res = await app.request('/api/v1/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Test', importance: 15 }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expectErrorResponse(body);
      expect(body.error.message).toContain('importance');
    });

    it('returns 201 with memory data on success', async () => {
      mockMemoryService.createMemory.mockResolvedValue({
        success: true,
        data: {
          id: 'mem-123',
          userId: 'user-123',
          content: 'Test memory',
          category: 'general',
          source: 'user_input',
          importance: 5,
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
          lastAccessed: null,
        },
      });

      const res = await app.request('/api/v1/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Test memory', importance: 5 }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expectSuccessResponse(body);
      expect(body.data).toHaveProperty('source', 'user_input');
    });
  });

  describe('GET /api/v1/memories', () => {
    it('returns paginated list', async () => {
      mockMemoryService.listMemories.mockResolvedValue({
        success: true,
        data: {
          items: [],
          nextCursor: null,
          hasMore: false,
        },
      });

      const res = await app.request('/api/v1/memories');

      expect(res.status).toBe(200);
      const body = await res.json();
      expectPaginatedResponse(body);
    });

    it('returns search results when search param provided', async () => {
      mockMemoryService.searchMemories.mockResolvedValue({
        success: true,
        data: [
          {
            memory: {
              id: 'mem-123',
              content: 'Found',
              userId: 'user-123',
              category: 'general',
              source: 'user_input',
              importance: 5,
              status: 'active',
              createdAt: new Date(),
              updatedAt: new Date(),
              lastAccessed: null,
            },
            similarity: 0.95,
          },
        ],
      });

      const res = await app.request('/api/v1/memories?search=test');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.items[0]).toHaveProperty('similarity');
    });
  });
});

// ─────────────────────────────────────────────────────────────
// CONTRACT: Knowledge Endpoints
// ─────────────────────────────────────────────────────────────

describe('Contract: Knowledge Endpoints', () => {
  let app: Hono;
  let mockKnowledgeService: any;

  beforeEach(() => {
    mockKnowledgeService = {
      createKnowledgeItem: vi.fn(),
      getKnowledgeItem: vi.fn(),
      listKnowledgeItems: vi.fn(),
      updateKnowledgeItem: vi.fn(),
      searchKnowledge: vi.fn(),
      submitForReview: vi.fn(),
    };

    app = new Hono();
    app.use('*', mockAuthMiddleware(createUserActor()));
    app.route(
      '/api/v1',
      createKnowledgeRoutes({ knowledgeService: mockKnowledgeService })
    );
  });

  describe('POST /api/v1/knowledge', () => {
    it('returns 400 for missing title', async () => {
      const res = await app.request('/api/v1/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Test content' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expectErrorResponse(body);
      // Validation error message format may vary - just verify it's a validation error
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for missing content', async () => {
      const res = await app.request('/api/v1/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Test' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expectErrorResponse(body);
      // Validation error message format may vary - just verify it's a validation error
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/knowledge/:id/publish', () => {
    it('returns submission result', async () => {
      mockKnowledgeService.submitForReview.mockResolvedValue({
        success: true,
        data: { id: 'item-123', status: 'pending_review' },
      });

      const res = await app.request('/api/v1/knowledge/item-123/publish', {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expectSuccessResponse(body);
      expect(body.data).toHaveProperty('status');
    });
  });
});

// ─────────────────────────────────────────────────────────────
// CONTRACT: Subscription Endpoints
// ─────────────────────────────────────────────────────────────

describe('Contract: Subscription Endpoints', () => {
  let app: Hono;
  let mockSubscriptionService: any;

  beforeEach(() => {
    mockSubscriptionService = {
      getSubscription: vi.fn(),
      getUsageSummary: vi.fn(),
      getEntitlements: vi.fn(),
    };

    app = new Hono();
    app.use('*', mockAuthMiddleware(createUserActor()));
    app.route(
      '/api/v1',
      createSubscriptionRoutes({ subscriptionService: mockSubscriptionService })
    );
  });

  describe('GET /api/v1/subscription', () => {
    it('returns subscription data', async () => {
      mockSubscriptionService.getSubscription.mockResolvedValue({
        success: true,
        data: {
          id: 'sub-123',
          userId: 'user-123',
          planCode: 'pro',
          planName: 'Pro Plan',
          status: 'active',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(),
          cancelAtPeriodEnd: false,
        },
      });

      const res = await app.request('/api/v1/subscription');

      expect(res.status).toBe(200);
      const body = await res.json();
      expectSuccessResponse(body);
      expect(body.data).toHaveProperty('planCode');
      expect(body.data).toHaveProperty('status');
      expectDateString(body.data.currentPeriodStart);
      expectDateString(body.data.currentPeriodEnd);
    });
  });

  describe('GET /api/v1/subscription/usage', () => {
    it('returns usage summary', async () => {
      mockSubscriptionService.getUsageSummary.mockResolvedValue({
        success: true,
        data: {
          period: { start: new Date(), end: new Date() },
          usage: [
            {
              featureCode: 'messages',
              featureName: 'Messages',
              used: 50,
              limit: 100,
              percentage: 50,
            },
          ],
        },
      });

      const res = await app.request('/api/v1/subscription/usage');

      expect(res.status).toBe(200);
      const body = await res.json();
      expectSuccessResponse(body);
      expect(body.data).toHaveProperty('period');
      expect(body.data).toHaveProperty('usage');
      expect(Array.isArray(body.data.usage)).toBe(true);
    });
  });

  describe('GET /api/v1/subscription/entitlements', () => {
    it('returns entitlements array', async () => {
      mockSubscriptionService.getEntitlements.mockResolvedValue({
        success: true,
        data: [
          { featureCode: 'messages', type: 'metered', limit: 100 },
          { featureCode: 'web_search', type: 'boolean', enabled: true },
        ],
      });

      const res = await app.request('/api/v1/subscription/entitlements');

      expect(res.status).toBe(200);
      const body = await res.json();
      expectSuccessResponse(body);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────
// CONTRACT: Admin Endpoints
// ─────────────────────────────────────────────────────────────

describe('Contract: Admin Endpoints', () => {
  let app: Hono;
  let mockServices: any;

  beforeEach(() => {
    mockServices = {
      userService: {
        listUsers: vi.fn(),
        getUser: vi.fn(),
        suspendUser: vi.fn(),
        reactivateUser: vi.fn(),
      },
      auditService: {
        queryLogs: vi.fn(),
      },
      promptService: {
        listPrompts: vi.fn(),
        getPrompt: vi.fn(),
        createPrompt: vi.fn(),
        updatePrompt: vi.fn(),
        activatePrompt: vi.fn(),
      },
      approvalService: {
        listPendingRequests: vi.fn(),
        getRequest: vi.fn(),
        approve: vi.fn(),
        reject: vi.fn(),
      },
    };

    app = new Hono();
    app.use('*', mockAuthMiddleware(createAdminActor()));
    app.route('/api/v1', createAdminRoutes(mockServices));
  });

  describe('GET /api/v1/admin/users', () => {
    it('returns paginated user list', async () => {
      mockServices.userService.listUsers.mockResolvedValue({
        success: true,
        data: {
          items: [
            {
              id: 'user-1',
              email: 'user@test.com',
              status: 'active',
              createdAt: new Date(),
              updatedAt: new Date(),
              deletedAt: null,
            },
          ],
          nextCursor: null,
          hasMore: false,
        },
      });

      const res = await app.request('/api/v1/admin/users');

      expect(res.status).toBe(200);
      const body = await res.json();
      expectPaginatedResponse(body);
      expect(body.data.items[0]).toHaveProperty('email');
      expect(body.data.items[0]).toHaveProperty('status');
    });
  });

  describe('POST /api/v1/admin/users/:id/suspend', () => {
    it('returns success on suspend', async () => {
      mockServices.userService.suspendUser.mockResolvedValue({ success: true });

      const res = await app.request('/api/v1/admin/users/user-123/suspend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Policy violation' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expectSuccessResponse(body);
    });
  });

  describe('GET /api/v1/admin/audit', () => {
    it('returns audit logs', async () => {
      mockServices.auditService.queryLogs.mockResolvedValue({
        success: true,
        data: {
          items: [
            {
              id: 'log-1',
              timestamp: new Date(),
              actorType: 'user',
              actorId: 'user-123',
              action: 'chat.created',
              resourceType: 'chat',
              resourceId: 'chat-123',
              metadata: {},
              requestId: 'req-123',
            },
          ],
          nextCursor: null,
          hasMore: false,
        },
      });

      const res = await app.request('/api/v1/admin/audit');

      expect(res.status).toBe(200);
      const body = await res.json();
      expectPaginatedResponse(body);
      expect(body.data.items[0]).toHaveProperty('action');
      expect(body.data.items[0]).toHaveProperty('actorId');
    });
  });

  describe('POST /api/v1/admin/prompts', () => {
    it('returns 400 for missing name', async () => {
      const res = await app.request('/api/v1/admin/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Test' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expectErrorResponse(body);
    });

    it('returns 201 on success', async () => {
      mockServices.promptService.createPrompt.mockResolvedValue({
        success: true,
        data: {
          id: 'prompt-123',
          name: 'Test',
          content: 'You are...',
          status: 'draft',
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      const res = await app.request('/api/v1/admin/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test', content: 'You are...' }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expectSuccessResponse(body);
    });
  });

  describe('POST /api/v1/admin/approvals/:id', () => {
    it('returns 400 for invalid action', async () => {
      const res = await app.request('/api/v1/admin/approvals/req-123', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'invalid' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expectErrorResponse(body);
      expect(body.error.message).toContain('approve');
    });

    it('handles approve action', async () => {
      mockServices.approvalService.approve.mockResolvedValue({
        success: true,
        data: { id: 'req-123', status: 'approved' },
      });

      const res = await app.request('/api/v1/admin/approvals/req-123', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      });

      expect(res.status).toBe(200);
    });

    it('handles reject action', async () => {
      mockServices.approvalService.reject.mockResolvedValue({
        success: true,
        data: { id: 'req-123', status: 'rejected' },
      });

      const res = await app.request('/api/v1/admin/approvals/req-123', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', comment: 'Needs revision' }),
      });

      expect(res.status).toBe(200);
    });
  });
});

// ─────────────────────────────────────────────────────────────
// CONTRACT: Error Response Consistency
// ─────────────────────────────────────────────────────────────

describe('Contract: Error Response Consistency', () => {
  describe('All error responses follow standard format', () => {
    it('NOT_FOUND returns 404', async () => {
      const mockService = {
        getChat: vi.fn().mockResolvedValue({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Not found' },
        }),
      };
      const app = new Hono();
      app.use('*', mockAuthMiddleware(createUserActor()));
      app.route(
        '/api/v1',
        createChatRoutes({ chatService: mockService as any })
      );

      const res = await app.request('/api/v1/chats/xyz');
      expect(res.status).toBe(404);
    });

    it('UNAUTHORIZED returns 401', async () => {
      const mockService = {
        getChat: vi.fn().mockResolvedValue({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Unauthorized' },
        }),
      };
      const app = new Hono();
      app.use('*', mockAuthMiddleware(createUserActor()));
      app.route(
        '/api/v1',
        createChatRoutes({ chatService: mockService as any })
      );

      const res = await app.request('/api/v1/chats/xyz');
      expect(res.status).toBe(401);
    });

    it('PERMISSION_DENIED returns 403', async () => {
      const mockService = {
        getChat: vi.fn().mockResolvedValue({
          success: false,
          error: { code: 'PERMISSION_DENIED', message: 'Forbidden' },
        }),
      };
      const app = new Hono();
      app.use('*', mockAuthMiddleware(createUserActor()));
      app.route(
        '/api/v1',
        createChatRoutes({ chatService: mockService as any })
      );

      const res = await app.request('/api/v1/chats/xyz');
      expect(res.status).toBe(403);
    });

    it('VALIDATION_ERROR returns 400', async () => {
      const mockService = {
        createChat: vi.fn().mockResolvedValue({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid' },
        }),
      };
      const app = new Hono();
      app.use('*', mockAuthMiddleware(createUserActor()));
      app.route(
        '/api/v1',
        createChatRoutes({ chatService: mockService as any })
      );

      const res = await app.request('/api/v1/chats', { method: 'POST' });
      expect(res.status).toBe(400);
    });

    it('RATE_LIMITED returns 429', async () => {
      const mockService = {
        createChat: vi.fn().mockResolvedValue({
          success: false,
          error: { code: 'RATE_LIMITED', message: 'Too many requests' },
        }),
      };
      const app = new Hono();
      app.use('*', mockAuthMiddleware(createUserActor()));
      app.route(
        '/api/v1',
        createChatRoutes({ chatService: mockService as any })
      );

      const res = await app.request('/api/v1/chats', { method: 'POST' });
      expect(res.status).toBe(429);
    });
  });
});

// ─────────────────────────────────────────────────────────────
// CONTRACT: Tool Endpoints
// ─────────────────────────────────────────────────────────────

describe('Contract: Tool Endpoints', () => {
  let app: Hono;
  let mockToolService: any;

  beforeEach(() => {
    mockToolService = {
      listAvailableTools: vi.fn(),
      getTool: vi.fn(),
    };

    app = new Hono();
    app.use('*', mockAuthMiddleware(createUserActor()));
    app.route('/api/v1', createToolRoutes({ toolService: mockToolService }));
  });

  describe('GET /api/v1/tools', () => {
    it('returns tools array', async () => {
      mockToolService.listAvailableTools.mockResolvedValue({
        success: true,
        data: [
          {
            id: 'tool-1',
            name: 'Web Search',
            description: 'Search the web',
            type: 'local',
            enabled: true,
            requiresPermission: null,
            inputSchema: {},
          },
        ],
      });

      const res = await app.request('/api/v1/tools');

      expect(res.status).toBe(200);
      const body = await res.json();
      expectSuccessResponse(body);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data[0]).toHaveProperty('name');
      expect(body.data[0]).toHaveProperty('type');
    });
  });

  describe('GET /api/v1/tools/:id', () => {
    it('returns tool details', async () => {
      mockToolService.getTool.mockResolvedValue({
        success: true,
        data: {
          id: 'tool-1',
          name: 'Web Search',
          description: 'Search the web',
          type: 'local',
          enabled: true,
          requiresPermission: null,
          inputSchema: { type: 'object' },
        },
      });

      const res = await app.request('/api/v1/tools/tool-1');

      expect(res.status).toBe(200);
      const body = await res.json();
      expectSuccessResponse(body);
      expect(body.data).toHaveProperty('inputSchema');
    });
  });
});
