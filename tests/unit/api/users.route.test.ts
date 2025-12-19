/**
 * User Routes Unit Tests
 */

import { Hono } from 'hono';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createUserRoutes } from '@/api/routes/users.js';
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

describe('User Routes', () => {
  let mockUserService: {
    getProfile: ReturnType<typeof vi.fn>;
    updateProfile: ReturnType<typeof vi.fn>;
    getAIPreferences: ReturnType<typeof vi.fn>;
    updateAIPreferences: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockUserService = {
      getProfile: vi.fn(),
      updateProfile: vi.fn(),
      getAIPreferences: vi.fn(),
      updateAIPreferences: vi.fn(),
    };
  });

  describe('GET /users/me', () => {
    it('should return current user profile', async () => {
      const actor = createTestActor();
      mockUserService.getProfile.mockResolvedValue({
        success: true,
        data: {
          id: 'profile-123',
          userId: 'user-123',
          displayName: 'John Doe',
          avatarUrl: 'https://example.com/avatar.png',
          timezone: 'America/New_York',
          locale: 'en-US',
          createdAt: new Date('2024-01-01T00:00:00Z'),
          updatedAt: new Date('2024-01-15T10:00:00Z'),
        },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createUserRoutes({ userService: mockUserService }));

      const res = await app.request('/api/v1/users/me');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.displayName).toBe('John Doe');
      expect(body.data.timezone).toBe('America/New_York');
      expect(body.data.createdAt).toBe('2024-01-01T00:00:00.000Z');
    });

    it('should call service with actor userId', async () => {
      const actor = createTestActor({ userId: 'user-456' });
      mockUserService.getProfile.mockResolvedValue({
        success: true,
        data: {
          id: 'profile-123',
          userId: 'user-456',
          displayName: null,
          avatarUrl: null,
          timezone: 'UTC',
          locale: 'en',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createUserRoutes({ userService: mockUserService }));

      await app.request('/api/v1/users/me');

      expect(mockUserService.getProfile).toHaveBeenCalledWith(
        actor,
        'user-456'
      );
    });

    it('should return 404 when profile not found', async () => {
      const actor = createTestActor();
      mockUserService.getProfile.mockResolvedValue({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Profile not found' },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createUserRoutes({ userService: mockUserService }));

      const res = await app.request('/api/v1/users/me');

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('PATCH /users/me', () => {
    it('should update user profile', async () => {
      const actor = createTestActor();
      mockUserService.updateProfile.mockResolvedValue({
        success: true,
        data: {
          id: 'profile-123',
          userId: 'user-123',
          displayName: 'Jane Doe',
          avatarUrl: 'https://example.com/new-avatar.png',
          timezone: 'America/Los_Angeles',
          locale: 'en-US',
          createdAt: new Date('2024-01-01T00:00:00Z'),
          updatedAt: new Date('2024-01-15T12:00:00Z'),
        },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createUserRoutes({ userService: mockUserService }));

      const res = await app.request('/api/v1/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: 'Jane Doe',
          timezone: 'America/Los_Angeles',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.displayName).toBe('Jane Doe');
      expect(body.data.timezone).toBe('America/Los_Angeles');
    });

    it('should call service with correct params', async () => {
      const actor = createTestActor();
      mockUserService.updateProfile.mockResolvedValue({
        success: true,
        data: {
          id: 'profile-123',
          userId: 'user-123',
          displayName: 'Updated Name',
          avatarUrl: null,
          timezone: 'UTC',
          locale: 'en',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createUserRoutes({ userService: mockUserService }));

      await app.request('/api/v1/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'Updated Name' }),
      });

      expect(mockUserService.updateProfile).toHaveBeenCalledWith(
        actor,
        'user-123',
        { displayName: 'Updated Name' }
      );
    });

    it('should return error when update fails', async () => {
      const actor = createTestActor();
      mockUserService.updateProfile.mockResolvedValue({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Display name exceeds maximum length',
        },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createUserRoutes({ userService: mockUserService }));

      const res = await app.request('/api/v1/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'x'.repeat(300) }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /users/me/preferences', () => {
    it('should return AI preferences', async () => {
      const actor = createTestActor();
      mockUserService.getAIPreferences.mockResolvedValue({
        success: true,
        data: {
          id: 'prefs-123',
          userId: 'user-123',
          responseLength: 'balanced',
          formality: 'neutral',
          allowMemory: true,
          allowWebSearch: true,
          customInstructions: 'Always provide code examples',
          createdAt: new Date('2024-01-01T00:00:00Z'),
          updatedAt: new Date('2024-01-15T10:00:00Z'),
        },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createUserRoutes({ userService: mockUserService }));

      const res = await app.request('/api/v1/users/me/preferences');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.responseLength).toBe('balanced');
      expect(body.data.formality).toBe('neutral');
      expect(body.data.customInstructions).toBe('Always provide code examples');
    });

    it('should call service with actor userId', async () => {
      const actor = createTestActor({ userId: 'user-789' });
      mockUserService.getAIPreferences.mockResolvedValue({
        success: true,
        data: {
          id: 'prefs-123',
          userId: 'user-789',
          responseLength: 'concise',
          formality: 'casual',
          allowMemory: false,
          allowWebSearch: false,
          customInstructions: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createUserRoutes({ userService: mockUserService }));

      await app.request('/api/v1/users/me/preferences');

      expect(mockUserService.getAIPreferences).toHaveBeenCalledWith(
        actor,
        'user-789'
      );
    });

    it('should return 404 when preferences not found', async () => {
      const actor = createTestActor();
      mockUserService.getAIPreferences.mockResolvedValue({
        success: false,
        error: { code: 'NOT_FOUND', message: 'AI preferences not found' },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createUserRoutes({ userService: mockUserService }));

      const res = await app.request('/api/v1/users/me/preferences');

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('PUT /users/me/preferences', () => {
    it('should update AI preferences', async () => {
      const actor = createTestActor();
      mockUserService.updateAIPreferences.mockResolvedValue({
        success: true,
        data: {
          id: 'prefs-123',
          userId: 'user-123',
          responseLength: 'detailed',
          formality: 'formal',
          allowMemory: true,
          allowWebSearch: false,
          customInstructions: 'Focus on security best practices',
          createdAt: new Date('2024-01-01T00:00:00Z'),
          updatedAt: new Date('2024-01-15T12:00:00Z'),
        },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createUserRoutes({ userService: mockUserService }));

      const res = await app.request('/api/v1/users/me/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          responseLength: 'detailed',
          formality: 'formal',
          customInstructions: 'Focus on security best practices',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.responseLength).toBe('detailed');
      expect(body.data.formality).toBe('formal');
    });

    it('should call service with correct params', async () => {
      const actor = createTestActor();
      mockUserService.updateAIPreferences.mockResolvedValue({
        success: true,
        data: {
          id: 'prefs-123',
          userId: 'user-123',
          responseLength: 'concise',
          formality: 'casual',
          allowMemory: false,
          allowWebSearch: true,
          customInstructions: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createUserRoutes({ userService: mockUserService }));

      await app.request('/api/v1/users/me/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          responseLength: 'concise',
          allowMemory: false,
        }),
      });

      expect(mockUserService.updateAIPreferences).toHaveBeenCalledWith(
        actor,
        'user-123',
        { responseLength: 'concise', allowMemory: false }
      );
    });

    it('should validate responseLength values', async () => {
      const actor = createTestActor();

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createUserRoutes({ userService: mockUserService }));

      const res = await app.request('/api/v1/users/me/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responseLength: 'invalid' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should validate formality values', async () => {
      const actor = createTestActor();

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createUserRoutes({ userService: mockUserService }));

      const res = await app.request('/api/v1/users/me/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formality: 'very-formal' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return error when service fails', async () => {
      const actor = createTestActor();
      mockUserService.updateAIPreferences.mockResolvedValue({
        success: false,
        error: {
          code: 'PERMISSION_DENIED',
          message: 'AI cannot update AI preferences',
        },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createUserRoutes({ userService: mockUserService }));

      const res = await app.request('/api/v1/users/me/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responseLength: 'detailed' }),
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe('PERMISSION_DENIED');
    });
  });

  describe('Response Format', () => {
    it('should include requestId in all responses', async () => {
      const actor = createTestActor({ requestId: 'req-xyz' });
      mockUserService.getProfile.mockResolvedValue({
        success: true,
        data: {
          id: 'profile-123',
          userId: 'user-123',
          displayName: null,
          avatarUrl: null,
          timezone: 'UTC',
          locale: 'en',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createUserRoutes({ userService: mockUserService }));

      const res = await app.request('/api/v1/users/me');

      const body = await res.json();
      expect(body.meta.requestId).toBe('req-xyz');
    });

    it('should format dates as ISO 8601', async () => {
      const actor = createTestActor();
      mockUserService.getAIPreferences.mockResolvedValue({
        success: true,
        data: {
          id: 'prefs-123',
          userId: 'user-123',
          responseLength: 'balanced',
          formality: 'neutral',
          allowMemory: true,
          allowWebSearch: true,
          customInstructions: null,
          createdAt: new Date('2024-01-15T10:00:00.000Z'),
          updatedAt: new Date('2024-01-15T11:00:00.000Z'),
        },
      });

      const app = new Hono();
      app.use('*', mockAuthMiddleware(actor));
      app.route('/api/v1', createUserRoutes({ userService: mockUserService }));

      const res = await app.request('/api/v1/users/me/preferences');

      const body = await res.json();
      expect(body.data.createdAt).toBe('2024-01-15T10:00:00.000Z');
      expect(body.data.updatedAt).toBe('2024-01-15T11:00:00.000Z');
    });
  });
});
