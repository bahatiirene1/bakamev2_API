/**
 * Tool Routes Unit Tests
 */

import { Hono } from 'hono';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createToolRoutes } from '@/api/routes/tools.js';
import type { ActorContext } from '@/types/index.js';

// Mock actor for testing
function createTestActor(overrides?: Partial<ActorContext>): ActorContext {
  return {
    type: 'user',
    userId: 'user-123',
    requestId: 'req-123',
    permissions: ['tool:read'],
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

describe('Tool Routes', () => {
  let mockToolService: {
    listAvailableTools: ReturnType<typeof vi.fn>;
    getTool: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockToolService = {
      listAvailableTools: vi.fn(),
      getTool: vi.fn(),
    };
  });

  describe('GET /tools', () => {
    it('should list available tools', async () => {
      const actor = createTestActor();
      mockToolService.listAvailableTools.mockResolvedValue({
        success: true,
        data: [
          {
            id: 'tool-web-search',
            name: 'web_search',
            description: 'Search the web for information',
            type: 'mcp',
            enabled: true,
            requiresPermission: 'tool:web_search',
            inputSchema: {
              type: 'object',
              properties: { query: { type: 'string' } },
            },
          },
          {
            id: 'tool-calculator',
            name: 'calculator',
            description: 'Perform calculations',
            type: 'local',
            enabled: true,
            requiresPermission: null,
            inputSchema: {
              type: 'object',
              properties: { expression: { type: 'string' } },
            },
          },
        ],
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createToolRoutes({ toolService: mockToolService }));

      const res = await app.request('/api/v1/tools');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(2);
      expect(body.data[0].name).toBe('web_search');
    });

    it('should pass filter params to service', async () => {
      const actor = createTestActor();
      mockToolService.listAvailableTools.mockResolvedValue({
        success: true,
        data: [],
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createToolRoutes({ toolService: mockToolService }));

      await app.request('/api/v1/tools?type=mcp&enabled=true');

      expect(mockToolService.listAvailableTools).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({
          type: 'mcp',
          enabled: true,
        })
      );
    });
  });

  describe('GET /tools/:id', () => {
    it('should get tool by ID', async () => {
      const actor = createTestActor();
      mockToolService.getTool.mockResolvedValue({
        success: true,
        data: {
          id: 'tool-web-search',
          name: 'web_search',
          description: 'Search the web for information',
          type: 'mcp',
          enabled: true,
          requiresPermission: 'tool:web_search',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
              count: { type: 'number', default: 5 },
            },
            required: ['query'],
          },
          rateLimit: { maxPerHour: 100 },
        },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createToolRoutes({ toolService: mockToolService }));

      const res = await app.request('/api/v1/tools/tool-web-search');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.id).toBe('tool-web-search');
      expect(body.data.inputSchema).toBeDefined();
    });

    it('should return 404 for non-existent tool', async () => {
      const actor = createTestActor();
      mockToolService.getTool.mockResolvedValue({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Tool not found' },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createToolRoutes({ toolService: mockToolService }));

      const res = await app.request('/api/v1/tools/nonexistent');

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('Response Format', () => {
    it('should include requestId in all responses', async () => {
      const actor = createTestActor({ requestId: 'req-xyz' });
      mockToolService.listAvailableTools.mockResolvedValue({
        success: true,
        data: [],
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createToolRoutes({ toolService: mockToolService }));

      const res = await app.request('/api/v1/tools');

      const body = await res.json();
      expect(body.meta.requestId).toBe('req-xyz');
    });
  });
});
