/**
 * Memory Routes Unit Tests
 */

import { Hono } from 'hono';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createMemoryRoutes } from '@/api/routes/memories.js';
import type { ActorContext } from '@/types/index.js';

// Mock actor for testing
function createTestActor(overrides?: Partial<ActorContext>): ActorContext {
  return {
    type: 'user',
    userId: 'user-123',
    requestId: 'req-123',
    permissions: ['memory:read', 'memory:write'],
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

describe('Memory Routes', () => {
  let mockMemoryService: {
    createMemory: ReturnType<typeof vi.fn>;
    getMemory: ReturnType<typeof vi.fn>;
    listMemories: ReturnType<typeof vi.fn>;
    updateMemory: ReturnType<typeof vi.fn>;
    archiveMemory: ReturnType<typeof vi.fn>;
    deleteMemory: ReturnType<typeof vi.fn>;
    searchMemories: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockMemoryService = {
      createMemory: vi.fn(),
      getMemory: vi.fn(),
      listMemories: vi.fn(),
      updateMemory: vi.fn(),
      archiveMemory: vi.fn(),
      deleteMemory: vi.fn(),
      searchMemories: vi.fn(),
    };
  });

  describe('GET /memories', () => {
    it('should list memories with pagination', async () => {
      const actor = createTestActor();
      mockMemoryService.listMemories.mockResolvedValue({
        success: true,
        data: {
          items: [
            {
              id: 'mem-1',
              userId: 'user-123',
              content: 'User prefers TypeScript',
              category: 'preference',
              source: 'conversation',
              importance: 8,
              status: 'active',
              createdAt: new Date('2024-01-15T10:00:00Z'),
              updatedAt: new Date('2024-01-15T10:00:00Z'),
              lastAccessed: null,
            },
          ],
          nextCursor: null,
          hasMore: false,
        },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route(
        '/api/v1',
        createMemoryRoutes({ memoryService: mockMemoryService })
      );

      const res = await app.request('/api/v1/memories');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.items).toHaveLength(1);
      expect(body.data.items[0].content).toBe('User prefers TypeScript');
    });

    it('should pass query params to service', async () => {
      const actor = createTestActor();
      mockMemoryService.listMemories.mockResolvedValue({
        success: true,
        data: { items: [], nextCursor: null, hasMore: false },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route(
        '/api/v1',
        createMemoryRoutes({ memoryService: mockMemoryService })
      );

      await app.request(
        '/api/v1/memories?limit=10&category=preference&cursor=abc'
      );

      expect(mockMemoryService.listMemories).toHaveBeenCalledWith(
        actor,
        'user-123',
        expect.objectContaining({
          limit: 10,
          cursor: 'abc',
          category: 'preference',
        })
      );
    });

    it('should use semantic search when search param provided', async () => {
      const actor = createTestActor();
      mockMemoryService.searchMemories.mockResolvedValue({
        success: true,
        data: [
          {
            memory: {
              id: 'mem-1',
              userId: 'user-123',
              content: 'User prefers TypeScript',
              category: 'preference',
              source: 'conversation',
              importance: 8,
              status: 'active',
              createdAt: new Date('2024-01-15T10:00:00Z'),
              updatedAt: new Date('2024-01-15T10:00:00Z'),
              lastAccessed: null,
            },
            similarity: 0.95,
          },
        ],
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route(
        '/api/v1',
        createMemoryRoutes({ memoryService: mockMemoryService })
      );

      const res = await app.request(
        '/api/v1/memories?search=programming%20language%20preference'
      );

      expect(res.status).toBe(200);
      expect(mockMemoryService.searchMemories).toHaveBeenCalled();
      const body = await res.json();
      expect(body.data.items[0].similarity).toBe(0.95);
    });

    it('should cap limit at 100', async () => {
      const actor = createTestActor();
      mockMemoryService.listMemories.mockResolvedValue({
        success: true,
        data: { items: [], nextCursor: null, hasMore: false },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route(
        '/api/v1',
        createMemoryRoutes({ memoryService: mockMemoryService })
      );

      await app.request('/api/v1/memories?limit=500');

      expect(mockMemoryService.listMemories).toHaveBeenCalledWith(
        actor,
        'user-123',
        expect.objectContaining({ limit: 100 })
      );
    });
  });

  describe('POST /memories', () => {
    it('should create a memory and return 201', async () => {
      const actor = createTestActor();
      mockMemoryService.createMemory.mockResolvedValue({
        success: true,
        data: {
          id: 'mem-123',
          userId: 'user-123',
          content: 'User is learning Rust',
          category: 'interest',
          source: 'user_input',
          importance: 6,
          status: 'active',
          createdAt: new Date('2024-01-15T10:00:00Z'),
          updatedAt: new Date('2024-01-15T10:00:00Z'),
          lastAccessed: null,
        },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route(
        '/api/v1',
        createMemoryRoutes({ memoryService: mockMemoryService })
      );

      const res = await app.request('/api/v1/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'User is learning Rust',
          category: 'interest',
          importance: 6,
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.id).toBe('mem-123');
      expect(body.data.content).toBe('User is learning Rust');
    });

    it('should require content', async () => {
      const actor = createTestActor();

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route(
        '/api/v1',
        createMemoryRoutes({ memoryService: mockMemoryService })
      );

      const res = await app.request('/api/v1/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should validate importance range (1-10)', async () => {
      const actor = createTestActor();

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route(
        '/api/v1',
        createMemoryRoutes({ memoryService: mockMemoryService })
      );

      const res = await app.request('/api/v1/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Test', importance: 15 }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should set source to user_input for API-created memories', async () => {
      const actor = createTestActor();
      mockMemoryService.createMemory.mockResolvedValue({
        success: true,
        data: {
          id: 'mem-123',
          userId: 'user-123',
          content: 'Test',
          category: null,
          source: 'user_input',
          importance: 5,
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
          lastAccessed: null,
        },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route(
        '/api/v1',
        createMemoryRoutes({ memoryService: mockMemoryService })
      );

      await app.request('/api/v1/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Test' }),
      });

      expect(mockMemoryService.createMemory).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({ source: 'user_input' })
      );
    });
  });

  describe('GET /memories/:id', () => {
    it('should get memory by ID', async () => {
      const actor = createTestActor();
      mockMemoryService.getMemory.mockResolvedValue({
        success: true,
        data: {
          id: 'mem-123',
          userId: 'user-123',
          content: 'User prefers dark mode',
          category: 'preference',
          source: 'conversation',
          importance: 7,
          status: 'active',
          createdAt: new Date('2024-01-15T10:00:00Z'),
          updatedAt: new Date('2024-01-15T10:00:00Z'),
          lastAccessed: new Date('2024-01-15T12:00:00Z'),
        },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route(
        '/api/v1',
        createMemoryRoutes({ memoryService: mockMemoryService })
      );

      const res = await app.request('/api/v1/memories/mem-123');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.id).toBe('mem-123');
      expect(body.data.content).toBe('User prefers dark mode');
    });

    it('should return 404 for non-existent memory', async () => {
      const actor = createTestActor();
      mockMemoryService.getMemory.mockResolvedValue({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Memory not found' },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route(
        '/api/v1',
        createMemoryRoutes({ memoryService: mockMemoryService })
      );

      const res = await app.request('/api/v1/memories/nonexistent');

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('PATCH /memories/:id', () => {
    it('should update memory', async () => {
      const actor = createTestActor();
      mockMemoryService.updateMemory.mockResolvedValue({
        success: true,
        data: {
          id: 'mem-123',
          userId: 'user-123',
          content: 'Updated memory content',
          category: 'preference',
          source: 'conversation',
          importance: 9,
          status: 'active',
          createdAt: new Date('2024-01-15T10:00:00Z'),
          updatedAt: new Date('2024-01-15T14:00:00Z'),
          lastAccessed: null,
        },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route(
        '/api/v1',
        createMemoryRoutes({ memoryService: mockMemoryService })
      );

      const res = await app.request('/api/v1/memories/mem-123', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'Updated memory content',
          importance: 9,
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.content).toBe('Updated memory content');
      expect(body.data.importance).toBe(9);
    });

    it('should validate importance on update', async () => {
      const actor = createTestActor();

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route(
        '/api/v1',
        createMemoryRoutes({ memoryService: mockMemoryService })
      );

      const res = await app.request('/api/v1/memories/mem-123', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importance: 0 }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('DELETE /memories/:id', () => {
    it('should archive memory and return 204', async () => {
      const actor = createTestActor();
      mockMemoryService.archiveMemory.mockResolvedValue({
        success: true,
        data: undefined,
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route(
        '/api/v1',
        createMemoryRoutes({ memoryService: mockMemoryService })
      );

      const res = await app.request('/api/v1/memories/mem-123', {
        method: 'DELETE',
      });

      expect(res.status).toBe(204);
      expect(mockMemoryService.archiveMemory).toHaveBeenCalledWith(
        actor,
        'mem-123'
      );
    });

    it('should return 404 for non-existent memory', async () => {
      const actor = createTestActor();
      mockMemoryService.archiveMemory.mockResolvedValue({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Memory not found' },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route(
        '/api/v1',
        createMemoryRoutes({ memoryService: mockMemoryService })
      );

      const res = await app.request('/api/v1/memories/nonexistent', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
    });
  });

  describe('Response Format', () => {
    it('should include requestId in all responses', async () => {
      const actor = createTestActor({ requestId: 'req-xyz' });
      mockMemoryService.listMemories.mockResolvedValue({
        success: true,
        data: { items: [], nextCursor: null, hasMore: false },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route(
        '/api/v1',
        createMemoryRoutes({ memoryService: mockMemoryService })
      );

      const res = await app.request('/api/v1/memories');

      const body = await res.json();
      expect(body.meta.requestId).toBe('req-xyz');
    });

    it('should format dates as ISO 8601', async () => {
      const actor = createTestActor();
      mockMemoryService.getMemory.mockResolvedValue({
        success: true,
        data: {
          id: 'mem-123',
          userId: 'user-123',
          content: 'Test',
          category: null,
          source: 'user_input',
          importance: 5,
          status: 'active',
          createdAt: new Date('2024-01-15T10:00:00.000Z'),
          updatedAt: new Date('2024-01-15T11:00:00.000Z'),
          lastAccessed: new Date('2024-01-15T12:00:00.000Z'),
        },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route(
        '/api/v1',
        createMemoryRoutes({ memoryService: mockMemoryService })
      );

      const res = await app.request('/api/v1/memories/mem-123');

      const body = await res.json();
      expect(body.data.createdAt).toBe('2024-01-15T10:00:00.000Z');
      expect(body.data.updatedAt).toBe('2024-01-15T11:00:00.000Z');
      expect(body.data.lastAccessed).toBe('2024-01-15T12:00:00.000Z');
    });
  });
});
