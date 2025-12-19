/**
 * Knowledge Routes Unit Tests
 */

import { Hono } from 'hono';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createKnowledgeRoutes } from '@/api/routes/knowledge.js';
import type { ActorContext } from '@/types/index.js';

// Mock actor for testing
function createTestActor(overrides?: Partial<ActorContext>): ActorContext {
  return {
    type: 'user',
    userId: 'user-123',
    requestId: 'req-123',
    permissions: ['knowledge:read', 'knowledge:write'],
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

describe('Knowledge Routes', () => {
  let mockKnowledgeService: {
    createKnowledgeItem: ReturnType<typeof vi.fn>;
    getKnowledgeItem: ReturnType<typeof vi.fn>;
    listKnowledgeItems: ReturnType<typeof vi.fn>;
    updateKnowledgeItem: ReturnType<typeof vi.fn>;
    searchKnowledge: ReturnType<typeof vi.fn>;
    submitForReview: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockKnowledgeService = {
      createKnowledgeItem: vi.fn(),
      getKnowledgeItem: vi.fn(),
      listKnowledgeItems: vi.fn(),
      updateKnowledgeItem: vi.fn(),
      searchKnowledge: vi.fn(),
      submitForReview: vi.fn(),
    };
  });

  describe('GET /knowledge', () => {
    it('should list knowledge items', async () => {
      const actor = createTestActor();
      mockKnowledgeService.listKnowledgeItems.mockResolvedValue({
        success: true,
        data: {
          items: [
            {
              id: 'ki-1',
              title: 'Company Policies',
              content: '# Policies...',
              category: 'internal',
              status: 'published',
              authorId: 'user-123',
              reviewerId: null,
              publishedAt: new Date('2024-01-10T00:00:00Z'),
              version: 1,
              metadata: {},
              createdAt: new Date('2024-01-01T00:00:00Z'),
              updatedAt: new Date('2024-01-10T00:00:00Z'),
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
        createKnowledgeRoutes({ knowledgeService: mockKnowledgeService })
      );

      const res = await app.request('/api/v1/knowledge');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.items).toHaveLength(1);
      expect(body.data.items[0].title).toBe('Company Policies');
    });

    it('should pass query params to service', async () => {
      const actor = createTestActor();
      mockKnowledgeService.listKnowledgeItems.mockResolvedValue({
        success: true,
        data: { items: [], nextCursor: null, hasMore: false },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route(
        '/api/v1',
        createKnowledgeRoutes({ knowledgeService: mockKnowledgeService })
      );

      await app.request(
        '/api/v1/knowledge?status=published&category=internal&limit=10'
      );

      expect(mockKnowledgeService.listKnowledgeItems).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({
          status: 'published',
          category: 'internal',
          limit: 10,
        })
      );
    });

    it('should use search when search param provided', async () => {
      const actor = createTestActor();
      mockKnowledgeService.searchKnowledge.mockResolvedValue({
        success: true,
        data: [
          {
            item: {
              id: 'ki-1',
              title: 'Company Policies',
              content: '# Policies...',
              category: 'internal',
              status: 'published',
              authorId: 'user-123',
              reviewerId: null,
              publishedAt: new Date('2024-01-10T00:00:00Z'),
              version: 1,
              metadata: {},
              createdAt: new Date('2024-01-01T00:00:00Z'),
              updatedAt: new Date('2024-01-10T00:00:00Z'),
            },
            chunk: 'Relevant chunk...',
            chunkIndex: 0,
            similarity: 0.92,
          },
        ],
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route(
        '/api/v1',
        createKnowledgeRoutes({ knowledgeService: mockKnowledgeService })
      );

      const res = await app.request(
        '/api/v1/knowledge?search=company%20policy'
      );

      expect(res.status).toBe(200);
      expect(mockKnowledgeService.searchKnowledge).toHaveBeenCalled();
    });
  });

  describe('POST /knowledge', () => {
    it('should create knowledge item and return 201', async () => {
      const actor = createTestActor();
      mockKnowledgeService.createKnowledgeItem.mockResolvedValue({
        success: true,
        data: {
          id: 'ki-123',
          title: 'New Document',
          content: '# Content here',
          category: 'docs',
          status: 'draft',
          authorId: 'user-123',
          reviewerId: null,
          publishedAt: null,
          version: 1,
          metadata: {},
          createdAt: new Date('2024-01-15T10:00:00Z'),
          updatedAt: new Date('2024-01-15T10:00:00Z'),
        },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route(
        '/api/v1',
        createKnowledgeRoutes({ knowledgeService: mockKnowledgeService })
      );

      const res = await app.request('/api/v1/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'New Document',
          content: '# Content here',
          category: 'docs',
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.id).toBe('ki-123');
      expect(body.data.status).toBe('draft');
    });

    it('should require title', async () => {
      const actor = createTestActor();

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route(
        '/api/v1',
        createKnowledgeRoutes({ knowledgeService: mockKnowledgeService })
      );

      const res = await app.request('/api/v1/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '# Content' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should require content', async () => {
      const actor = createTestActor();

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route(
        '/api/v1',
        createKnowledgeRoutes({ knowledgeService: mockKnowledgeService })
      );

      const res = await app.request('/api/v1/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Title' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /knowledge/:id', () => {
    it('should get knowledge item by ID', async () => {
      const actor = createTestActor();
      mockKnowledgeService.getKnowledgeItem.mockResolvedValue({
        success: true,
        data: {
          id: 'ki-123',
          title: 'Company Policies',
          content: '# Policies...',
          category: 'internal',
          status: 'published',
          authorId: 'user-123',
          reviewerId: 'reviewer-1',
          publishedAt: new Date('2024-01-10T00:00:00Z'),
          version: 2,
          metadata: { source: 'hr' },
          createdAt: new Date('2024-01-01T00:00:00Z'),
          updatedAt: new Date('2024-01-10T00:00:00Z'),
        },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route(
        '/api/v1',
        createKnowledgeRoutes({ knowledgeService: mockKnowledgeService })
      );

      const res = await app.request('/api/v1/knowledge/ki-123');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.id).toBe('ki-123');
      expect(body.data.version).toBe(2);
    });

    it('should return 404 for non-existent item', async () => {
      const actor = createTestActor();
      mockKnowledgeService.getKnowledgeItem.mockResolvedValue({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Knowledge item not found' },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route(
        '/api/v1',
        createKnowledgeRoutes({ knowledgeService: mockKnowledgeService })
      );

      const res = await app.request('/api/v1/knowledge/nonexistent');

      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /knowledge/:id', () => {
    it('should update knowledge item', async () => {
      const actor = createTestActor();
      mockKnowledgeService.updateKnowledgeItem.mockResolvedValue({
        success: true,
        data: {
          id: 'ki-123',
          title: 'Updated Title',
          content: '# Updated content',
          category: 'internal',
          status: 'draft',
          authorId: 'user-123',
          reviewerId: null,
          publishedAt: null,
          version: 2,
          metadata: {},
          createdAt: new Date('2024-01-01T00:00:00Z'),
          updatedAt: new Date('2024-01-15T14:00:00Z'),
        },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route(
        '/api/v1',
        createKnowledgeRoutes({ knowledgeService: mockKnowledgeService })
      );

      const res = await app.request('/api/v1/knowledge/ki-123', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Updated Title',
          content: '# Updated content',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.title).toBe('Updated Title');
      expect(body.data.version).toBe(2);
    });
  });

  describe('POST /knowledge/:id/publish', () => {
    it('should submit for review', async () => {
      const actor = createTestActor();
      mockKnowledgeService.submitForReview.mockResolvedValue({
        success: true,
        data: {
          id: 'ki-123',
          status: 'pending_review',
        },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route(
        '/api/v1',
        createKnowledgeRoutes({ knowledgeService: mockKnowledgeService })
      );

      const res = await app.request('/api/v1/knowledge/ki-123/publish', {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      expect(mockKnowledgeService.submitForReview).toHaveBeenCalledWith(
        actor,
        'ki-123'
      );
    });
  });

  describe('Response Format', () => {
    it('should include requestId in all responses', async () => {
      const actor = createTestActor({ requestId: 'req-xyz' });
      mockKnowledgeService.listKnowledgeItems.mockResolvedValue({
        success: true,
        data: { items: [], nextCursor: null, hasMore: false },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route(
        '/api/v1',
        createKnowledgeRoutes({ knowledgeService: mockKnowledgeService })
      );

      const res = await app.request('/api/v1/knowledge');

      const body = await res.json();
      expect(body.meta.requestId).toBe('req-xyz');
    });
  });
});
