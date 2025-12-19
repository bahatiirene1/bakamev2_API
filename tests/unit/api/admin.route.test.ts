/**
 * Admin Routes Unit Tests
 */

import { Hono } from 'hono';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createAdminRoutes } from '@/api/routes/admin.js';
import type { ActorContext } from '@/types/index.js';

// Mock admin actor for testing
function createAdminActor(overrides?: Partial<ActorContext>): ActorContext {
  return {
    type: 'admin',
    userId: 'admin-123',
    requestId: 'req-123',
    permissions: [
      'admin:users:read',
      'admin:users:write',
      'admin:audit:read',
      'admin:prompts:manage',
      'admin:approvals:manage',
    ],
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

describe('Admin Routes', () => {
  let mockServices: {
    userService: {
      listUsers: ReturnType<typeof vi.fn>;
      getUser: ReturnType<typeof vi.fn>;
      suspendUser: ReturnType<typeof vi.fn>;
      reactivateUser: ReturnType<typeof vi.fn>;
    };
    auditService: {
      queryLogs: ReturnType<typeof vi.fn>;
    };
    promptService: {
      listPrompts: ReturnType<typeof vi.fn>;
      getPrompt: ReturnType<typeof vi.fn>;
      createPrompt: ReturnType<typeof vi.fn>;
      updatePrompt: ReturnType<typeof vi.fn>;
      activatePrompt: ReturnType<typeof vi.fn>;
    };
    approvalService: {
      listPendingRequests: ReturnType<typeof vi.fn>;
      getRequest: ReturnType<typeof vi.fn>;
      approve: ReturnType<typeof vi.fn>;
      reject: ReturnType<typeof vi.fn>;
    };
  };

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
  });

  describe('Admin Users', () => {
    describe('GET /admin/users', () => {
      it('should list users', async () => {
        const actor = createAdminActor();
        mockServices.userService.listUsers.mockResolvedValue({
          success: true,
          data: {
            items: [
              {
                id: 'user-1',
                email: 'user1@example.com',
                status: 'active',
                createdAt: new Date('2024-01-01T00:00:00Z'),
                updatedAt: new Date('2024-01-01T00:00:00Z'),
                deletedAt: null,
              },
            ],
            nextCursor: null,
            hasMore: false,
          },
        });

        const app = new Hono();
        app.use('*', mockAuthMiddleware(actor));
        app.route('/api/v1', createAdminRoutes(mockServices));

        const res = await app.request('/api/v1/admin/users');

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.data.items).toHaveLength(1);
      });
    });

    describe('GET /admin/users/:id', () => {
      it('should get user by ID', async () => {
        const actor = createAdminActor();
        mockServices.userService.getUser.mockResolvedValue({
          success: true,
          data: {
            id: 'user-123',
            email: 'user@example.com',
            status: 'active',
            createdAt: new Date('2024-01-01T00:00:00Z'),
            updatedAt: new Date('2024-01-01T00:00:00Z'),
            deletedAt: null,
          },
        });

        const app = new Hono();
        app.use('*', mockAuthMiddleware(actor));
        app.route('/api/v1', createAdminRoutes(mockServices));

        const res = await app.request('/api/v1/admin/users/user-123');

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.data.id).toBe('user-123');
      });
    });

    describe('POST /admin/users/:id/suspend', () => {
      it('should suspend user', async () => {
        const actor = createAdminActor();
        mockServices.userService.suspendUser.mockResolvedValue({
          success: true,
          data: undefined,
        });

        const app = new Hono();
        app.use('*', mockAuthMiddleware(actor));
        app.route('/api/v1', createAdminRoutes(mockServices));

        const res = await app.request('/api/v1/admin/users/user-123/suspend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'Violation of terms' }),
        });

        expect(res.status).toBe(200);
        expect(mockServices.userService.suspendUser).toHaveBeenCalledWith(
          actor,
          'user-123',
          'Violation of terms'
        );
      });
    });
  });

  describe('Admin Audit', () => {
    describe('GET /admin/audit', () => {
      it('should query audit logs', async () => {
        const actor = createAdminActor();
        mockServices.auditService.queryLogs.mockResolvedValue({
          success: true,
          data: {
            items: [
              {
                id: 'audit-1',
                timestamp: new Date('2024-01-15T10:30:00Z'),
                actorType: 'user',
                actorId: 'user-123',
                action: 'chat.message.created',
                resourceType: 'message',
                resourceId: 'msg-456',
                metadata: {},
                requestId: 'req-abc',
              },
            ],
            nextCursor: null,
            hasMore: false,
          },
        });

        const app = new Hono();
        app.use('*', mockAuthMiddleware(actor));
        app.route('/api/v1', createAdminRoutes(mockServices));

        const res = await app.request(
          '/api/v1/admin/audit?action=chat.message.created'
        );

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.data.items).toHaveLength(1);
      });
    });
  });

  describe('Admin Prompts', () => {
    describe('GET /admin/prompts', () => {
      it('should list prompts', async () => {
        const actor = createAdminActor();
        mockServices.promptService.listPrompts.mockResolvedValue({
          success: true,
          data: {
            items: [
              {
                id: 'prompt-1',
                name: 'Default Assistant',
                content: 'You are Bakame...',
                status: 'active',
                version: 1,
                createdAt: new Date('2024-01-01T00:00:00Z'),
                updatedAt: new Date('2024-01-01T00:00:00Z'),
              },
            ],
            nextCursor: null,
            hasMore: false,
          },
        });

        const app = new Hono();
        app.use('*', mockAuthMiddleware(actor));
        app.route('/api/v1', createAdminRoutes(mockServices));

        const res = await app.request('/api/v1/admin/prompts');

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.data.items).toHaveLength(1);
      });
    });

    describe('POST /admin/prompts', () => {
      it('should create prompt', async () => {
        const actor = createAdminActor();
        mockServices.promptService.createPrompt.mockResolvedValue({
          success: true,
          data: {
            id: 'prompt-123',
            name: 'New Prompt',
            content: 'You are...',
            status: 'draft',
            version: 1,
            createdAt: new Date('2024-01-15T10:00:00Z'),
            updatedAt: new Date('2024-01-15T10:00:00Z'),
          },
        });

        const app = new Hono();
        app.use('*', mockAuthMiddleware(actor));
        app.route('/api/v1', createAdminRoutes(mockServices));

        const res = await app.request('/api/v1/admin/prompts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'New Prompt', content: 'You are...' }),
        });

        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.data.name).toBe('New Prompt');
      });
    });

    describe('POST /admin/prompts/:id/activate', () => {
      it('should activate prompt', async () => {
        const actor = createAdminActor();
        mockServices.promptService.activatePrompt.mockResolvedValue({
          success: true,
          data: {
            id: 'prompt-123',
            status: 'active',
            activatedAt: new Date('2024-01-15T10:30:00Z'),
          },
        });

        const app = new Hono();
        app.use('*', mockAuthMiddleware(actor));
        app.route('/api/v1', createAdminRoutes(mockServices));

        const res = await app.request(
          '/api/v1/admin/prompts/prompt-123/activate',
          {
            method: 'POST',
          }
        );

        expect(res.status).toBe(200);
      });
    });
  });

  describe('Admin Approvals', () => {
    describe('GET /admin/approvals', () => {
      it('should list pending approvals', async () => {
        const actor = createAdminActor();
        mockServices.approvalService.listPendingRequests.mockResolvedValue({
          success: true,
          data: {
            items: [
              {
                id: 'approval-1',
                resourceType: 'system_prompt',
                resourceId: 'prompt-123',
                action: 'activate',
                status: 'pending',
                requesterId: 'user-456',
                createdAt: new Date('2024-01-15T10:00:00Z'),
              },
            ],
            nextCursor: null,
            hasMore: false,
          },
        });

        const app = new Hono();
        app.use('*', mockAuthMiddleware(actor));
        app.route('/api/v1', createAdminRoutes(mockServices));

        const res = await app.request('/api/v1/admin/approvals');

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.data.items).toHaveLength(1);
      });
    });

    describe('POST /admin/approvals/:id', () => {
      it('should approve request', async () => {
        const actor = createAdminActor();
        mockServices.approvalService.approve.mockResolvedValue({
          success: true,
          data: { id: 'approval-1', status: 'approved' },
        });

        const app = new Hono();
        app.use('*', mockAuthMiddleware(actor));
        app.route('/api/v1', createAdminRoutes(mockServices));

        const res = await app.request('/api/v1/admin/approvals/approval-1', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'approve', comment: 'Looks good' }),
        });

        expect(res.status).toBe(200);
        expect(mockServices.approvalService.approve).toHaveBeenCalled();
      });

      it('should reject request', async () => {
        const actor = createAdminActor();
        mockServices.approvalService.reject.mockResolvedValue({
          success: true,
          data: { id: 'approval-1', status: 'rejected' },
        });

        const app = new Hono();
        app.use('*', mockAuthMiddleware(actor));
        app.route('/api/v1', createAdminRoutes(mockServices));

        const res = await app.request('/api/v1/admin/approvals/approval-1', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'reject', comment: 'Needs revision' }),
        });

        expect(res.status).toBe(200);
        expect(mockServices.approvalService.reject).toHaveBeenCalled();
      });
    });
  });

  describe('Response Format', () => {
    it('should include requestId in all responses', async () => {
      const actor = createAdminActor({ requestId: 'req-xyz' });
      mockServices.auditService.queryLogs.mockResolvedValue({
        success: true,
        data: { items: [], nextCursor: null, hasMore: false },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createAdminRoutes(mockServices));

      const res = await app.request('/api/v1/admin/audit');

      const body = await res.json();
      expect(body.meta.requestId).toBe('req-xyz');
    });
  });
});
