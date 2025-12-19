/**
 * Chat Routes Unit Tests
 */

import { Hono } from 'hono';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createChatRoutes } from '@/api/routes/chats.js';
import type { ActorContext } from '@/types/index.js';

// Mock actor for testing
function createTestActor(overrides?: Partial<ActorContext>): ActorContext {
  return {
    type: 'user',
    userId: 'user-123',
    requestId: 'req-123',
    permissions: ['chat:read', 'chat:write'],
    ...overrides,
  };
}

// Mock middleware that sets actor
function mockAuthMiddleware(actor: ActorContext) {
  return async (c: any, next: any) => {
    c.set('actor', actor);
    c.set('requestId', actor.requestId);
    await next();
  };
}

describe('Chat Routes', () => {
  let mockChatService: {
    createChat: ReturnType<typeof vi.fn>;
    getChat: ReturnType<typeof vi.fn>;
    listChats: ReturnType<typeof vi.fn>;
    updateChat: ReturnType<typeof vi.fn>;
    archiveChat: ReturnType<typeof vi.fn>;
    addMessage: ReturnType<typeof vi.fn>;
    getMessages: ReturnType<typeof vi.fn>;
  };

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
  });

  describe('POST /chats', () => {
    it('should create a chat and return 201', async () => {
      const actor = createTestActor();
      mockChatService.createChat.mockResolvedValue({
        success: true,
        data: {
          id: 'chat-123',
          userId: 'user-123',
          title: 'Test Chat',
          status: 'active',
          createdAt: new Date('2024-01-15T10:00:00Z'),
          updatedAt: new Date('2024-01-15T10:00:00Z'),
        },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createChatRoutes({ chatService: mockChatService }));

      const res = await app.request('/api/v1/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Test Chat' }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.id).toBe('chat-123');
      expect(body.data.title).toBe('Test Chat');
      expect(body.data.status).toBe('active');
    });

    it('should create chat without title', async () => {
      const actor = createTestActor();
      mockChatService.createChat.mockResolvedValue({
        success: true,
        data: {
          id: 'chat-123',
          userId: 'user-123',
          title: null,
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createChatRoutes({ chatService: mockChatService }));

      const res = await app.request('/api/v1/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(201);
    });

    it('should return error when service fails', async () => {
      const actor = createTestActor();
      mockChatService.createChat.mockResolvedValue({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Database error' },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createChatRoutes({ chatService: mockChatService }));

      const res = await app.request('/api/v1/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Test' }),
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /chats', () => {
    it('should list chats with pagination', async () => {
      const actor = createTestActor();
      mockChatService.listChats.mockResolvedValue({
        success: true,
        data: {
          items: [
            {
              id: 'chat-1',
              title: 'Chat 1',
              status: 'active',
              createdAt: new Date(),
              updatedAt: new Date(),
              messageCount: 5,
            },
          ],
          nextCursor: null,
          hasMore: false,
        },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createChatRoutes({ chatService: mockChatService }));

      const res = await app.request('/api/v1/chats');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.items).toHaveLength(1);
      expect(body.data.items[0].id).toBe('chat-1');
    });

    it('should pass pagination params to service', async () => {
      const actor = createTestActor();
      mockChatService.listChats.mockResolvedValue({
        success: true,
        data: { items: [], nextCursor: null, hasMore: false },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createChatRoutes({ chatService: mockChatService }));

      await app.request('/api/v1/chats?limit=10&cursor=abc&status=archived');

      expect(mockChatService.listChats).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({
          limit: 10,
          cursor: 'abc',
          status: 'archived',
        })
      );
    });

    it('should cap limit at 100', async () => {
      const actor = createTestActor();
      mockChatService.listChats.mockResolvedValue({
        success: true,
        data: { items: [], nextCursor: null, hasMore: false },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createChatRoutes({ chatService: mockChatService }));

      await app.request('/api/v1/chats?limit=500');

      expect(mockChatService.listChats).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({ limit: 100 })
      );
    });
  });

  describe('GET /chats/:id', () => {
    it('should get chat by ID', async () => {
      const actor = createTestActor();
      mockChatService.getChat.mockResolvedValue({
        success: true,
        data: {
          id: 'chat-123',
          userId: 'user-123',
          title: 'My Chat',
          status: 'active',
          metadata: {},
          createdAt: new Date('2024-01-15T10:00:00Z'),
          updatedAt: new Date('2024-01-15T10:00:00Z'),
        },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createChatRoutes({ chatService: mockChatService }));

      const res = await app.request('/api/v1/chats/chat-123');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.id).toBe('chat-123');
      expect(body.data.title).toBe('My Chat');
    });

    it('should return 404 for non-existent chat', async () => {
      const actor = createTestActor();
      mockChatService.getChat.mockResolvedValue({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Chat not found' },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createChatRoutes({ chatService: mockChatService }));

      const res = await app.request('/api/v1/chats/nonexistent');

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('PATCH /chats/:id', () => {
    it('should update chat', async () => {
      const actor = createTestActor();
      mockChatService.updateChat.mockResolvedValue({
        success: true,
        data: {
          id: 'chat-123',
          title: 'Updated Title',
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createChatRoutes({ chatService: mockChatService }));

      const res = await app.request('/api/v1/chats/chat-123', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Updated Title' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.title).toBe('Updated Title');
    });
  });

  describe('DELETE /chats/:id', () => {
    it('should archive chat and return 204', async () => {
      const actor = createTestActor();
      mockChatService.archiveChat.mockResolvedValue({
        success: true,
        data: { id: 'chat-123', status: 'archived' },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createChatRoutes({ chatService: mockChatService }));

      const res = await app.request('/api/v1/chats/chat-123', {
        method: 'DELETE',
      });

      expect(res.status).toBe(204);
    });
  });

  describe('POST /chats/:id/messages', () => {
    it('should add message and return 201', async () => {
      const actor = createTestActor();
      mockChatService.addMessage.mockResolvedValue({
        success: true,
        data: {
          id: 'msg-123',
          chatId: 'chat-123',
          role: 'user',
          content: 'Hello!',
          createdAt: new Date('2024-01-15T10:00:00Z'),
        },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createChatRoutes({ chatService: mockChatService }));

      const res = await app.request('/api/v1/chats/chat-123/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hello!' }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.id).toBe('msg-123');
      expect(body.data.content).toBe('Hello!');
      expect(body.data.role).toBe('user');
    });

    it('should return 400 for empty content', async () => {
      const actor = createTestActor();

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createChatRoutes({ chatService: mockChatService }));

      const res = await app.request('/api/v1/chats/chat-123/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for content exceeding max length', async () => {
      const actor = createTestActor();

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createChatRoutes({ chatService: mockChatService }));

      const res = await app.request('/api/v1/chats/chat-123/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'x'.repeat(33000) }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should enforce role as user for API calls', async () => {
      const actor = createTestActor();
      mockChatService.addMessage.mockResolvedValue({
        success: true,
        data: {
          id: 'msg-123',
          chatId: 'chat-123',
          role: 'user',
          content: 'Hello!',
          createdAt: new Date(),
        },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createChatRoutes({ chatService: mockChatService }));

      await app.request('/api/v1/chats/chat-123/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hello!' }),
      });

      expect(mockChatService.addMessage).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({ role: 'user' })
      );
    });
  });

  describe('GET /chats/:id/messages', () => {
    it('should get messages with pagination', async () => {
      const actor = createTestActor();
      mockChatService.getMessages.mockResolvedValue({
        success: true,
        data: {
          items: [
            {
              id: 'msg-1',
              chatId: 'chat-123',
              role: 'user',
              content: 'Hello!',
              metadata: {},
              createdAt: new Date(),
            },
            {
              id: 'msg-2',
              chatId: 'chat-123',
              role: 'assistant',
              content: 'Hi there!',
              metadata: { model: 'claude-3' },
              createdAt: new Date(),
            },
          ],
          nextCursor: null,
          hasMore: false,
        },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createChatRoutes({ chatService: mockChatService }));

      const res = await app.request('/api/v1/chats/chat-123/messages');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.items).toHaveLength(2);
      expect(body.data.items[0].role).toBe('user');
      expect(body.data.items[1].role).toBe('assistant');
    });

    it('should pass limit param to service', async () => {
      const actor = createTestActor();
      mockChatService.getMessages.mockResolvedValue({
        success: true,
        data: { items: [], nextCursor: null, hasMore: false },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createChatRoutes({ chatService: mockChatService }));

      await app.request('/api/v1/chats/chat-123/messages?limit=25');

      expect(mockChatService.getMessages).toHaveBeenCalledWith(
        actor,
        'chat-123',
        expect.objectContaining({ limit: 25 })
      );
    });
  });

  describe('Response Format', () => {
    it('should include requestId in all responses', async () => {
      const actor = createTestActor();
      mockChatService.listChats.mockResolvedValue({
        success: true,
        data: { items: [], nextCursor: null, hasMore: false },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createChatRoutes({ chatService: mockChatService }));

      const res = await app.request('/api/v1/chats');

      const body = await res.json();
      expect(body.meta.requestId).toBe('req-123');
    });

    it('should format dates as ISO 8601', async () => {
      const actor = createTestActor();
      mockChatService.getChat.mockResolvedValue({
        success: true,
        data: {
          id: 'chat-123',
          userId: 'user-123',
          title: 'Test',
          status: 'active',
          metadata: {},
          createdAt: new Date('2024-01-15T10:00:00.000Z'),
          updatedAt: new Date('2024-01-15T11:00:00.000Z'),
        },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createChatRoutes({ chatService: mockChatService }));

      const res = await app.request('/api/v1/chats/chat-123');

      const body = await res.json();
      expect(body.data.createdAt).toBe('2024-01-15T10:00:00.000Z');
      expect(body.data.updatedAt).toBe('2024-01-15T11:00:00.000Z');
    });
  });
});
