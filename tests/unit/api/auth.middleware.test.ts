/**
 * Auth Middleware Unit Tests
 * Tests for ActorContext construction from JWT
 */

import { Hono } from 'hono';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createAuthMiddleware } from '@/api/middleware/auth.js';

describe('Auth Middleware', () => {
  let app: Hono;
  let mockSupabaseClient: {
    auth: {
      getUser: ReturnType<typeof vi.fn>;
    };
  };
  let mockAuthService: {
    resolvePermissions: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockSupabaseClient = {
      auth: {
        getUser: vi.fn(),
      },
    };

    mockAuthService = {
      resolvePermissions: vi.fn(),
    };

    app = new Hono();
  });

  describe('Token Extraction', () => {
    it('should return 401 when Authorization header is missing', async () => {
      const middleware = createAuthMiddleware({
        supabaseClient: mockSupabaseClient as any,
        authService: mockAuthService,
      });

      app.use('*', middleware);
      app.get('/test', (c) => c.json({ ok: true }));

      const res = await app.request('/test');

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.message).toContain('Missing');
    });

    it('should return 401 when Authorization header is not Bearer', async () => {
      const middleware = createAuthMiddleware({
        supabaseClient: mockSupabaseClient as any,
        authService: mockAuthService,
      });

      app.use('*', middleware);
      app.get('/test', (c) => c.json({ ok: true }));

      const res = await app.request('/test', {
        headers: { Authorization: 'Basic abc123' },
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 when Bearer token is empty', async () => {
      const middleware = createAuthMiddleware({
        supabaseClient: mockSupabaseClient as any,
        authService: mockAuthService,
      });

      app.use('*', middleware);
      app.get('/test', (c) => c.json({ ok: true }));

      const res = await app.request('/test', {
        headers: { Authorization: 'Bearer ' },
      });

      expect(res.status).toBe(401);
    });
  });

  describe('JWT Verification', () => {
    it('should return 401 when Supabase returns error', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Invalid token' },
      });

      const middleware = createAuthMiddleware({
        supabaseClient: mockSupabaseClient as any,
        authService: mockAuthService,
      });

      app.use('*', middleware);
      app.get('/test', (c) => c.json({ ok: true }));

      const res = await app.request('/test', {
        headers: { Authorization: 'Bearer invalid-token' },
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.message).toContain('Invalid');
    });

    it('should return 401 when user is null', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      const middleware = createAuthMiddleware({
        supabaseClient: mockSupabaseClient as any,
        authService: mockAuthService,
      });

      app.use('*', middleware);
      app.get('/test', (c) => c.json({ ok: true }));

      const res = await app.request('/test', {
        headers: { Authorization: 'Bearer some-token' },
      });

      expect(res.status).toBe(401);
    });
  });

  describe('Permission Resolution', () => {
    it('should return 500 when AuthService fails to resolve permissions', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });
      mockAuthService.resolvePermissions.mockResolvedValue({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Database error' },
      });

      const middleware = createAuthMiddleware({
        supabaseClient: mockSupabaseClient as any,
        authService: mockAuthService,
      });

      app.use('*', middleware);
      app.get('/test', (c) => c.json({ ok: true }));

      const res = await app.request('/test', {
        headers: { Authorization: 'Bearer valid-token' },
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('ActorContext Construction', () => {
    it('should construct ActorContext with user type for regular user', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });
      mockAuthService.resolvePermissions.mockResolvedValue({
        success: true,
        data: ['chat:read', 'chat:write'],
      });

      const middleware = createAuthMiddleware({
        supabaseClient: mockSupabaseClient as any,
        authService: mockAuthService,
      });

      let capturedActor: any = null;
      app.use('*', middleware);
      app.get('/test', (c) => {
        capturedActor = c.get('actor');
        return c.json({ ok: true });
      });

      const res = await app.request('/test', {
        headers: { Authorization: 'Bearer valid-token' },
      });

      expect(res.status).toBe(200);
      expect(capturedActor).not.toBeNull();
      expect(capturedActor.type).toBe('user');
      expect(capturedActor.userId).toBe('user-123');
      expect(capturedActor.permissions).toEqual(['chat:read', 'chat:write']);
      expect(capturedActor.requestId).toBeDefined();
    });

    it('should construct ActorContext with admin type for user with admin permissions', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: { id: 'admin-123' } },
        error: null,
      });
      mockAuthService.resolvePermissions.mockResolvedValue({
        success: true,
        data: ['chat:read', 'chat:write', 'user:manage', 'admin:audit:read'],
      });

      const middleware = createAuthMiddleware({
        supabaseClient: mockSupabaseClient as any,
        authService: mockAuthService,
      });

      let capturedActor: any = null;
      app.use('*', middleware);
      app.get('/test', (c) => {
        capturedActor = c.get('actor');
        return c.json({ ok: true });
      });

      const res = await app.request('/test', {
        headers: { Authorization: 'Bearer admin-token' },
      });

      expect(res.status).toBe(200);
      expect(capturedActor.type).toBe('admin');
      expect(capturedActor.userId).toBe('admin-123');
    });

    it('should include requestId in ActorContext', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });
      mockAuthService.resolvePermissions.mockResolvedValue({
        success: true,
        data: [],
      });

      const middleware = createAuthMiddleware({
        supabaseClient: mockSupabaseClient as any,
        authService: mockAuthService,
      });

      let capturedActor: any = null;
      app.use('*', middleware);
      app.get('/test', (c) => {
        capturedActor = c.get('actor');
        return c.json({ ok: true });
      });

      await app.request('/test', {
        headers: { Authorization: 'Bearer valid-token' },
      });

      expect(capturedActor.requestId).toBeDefined();
      expect(typeof capturedActor.requestId).toBe('string');
      expect(capturedActor.requestId.length).toBeGreaterThan(0);
    });

    it('should pass to next middleware on success', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });
      mockAuthService.resolvePermissions.mockResolvedValue({
        success: true,
        data: ['chat:read'],
      });

      const middleware = createAuthMiddleware({
        supabaseClient: mockSupabaseClient as any,
        authService: mockAuthService,
      });

      app.use('*', middleware);
      app.get('/test', (c) => c.json({ message: 'success' }));

      const res = await app.request('/test', {
        headers: { Authorization: 'Bearer valid-token' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.message).toBe('success');
    });
  });

  describe('Request Context', () => {
    it('should capture IP from x-forwarded-for header', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });
      mockAuthService.resolvePermissions.mockResolvedValue({
        success: true,
        data: [],
      });

      const middleware = createAuthMiddleware({
        supabaseClient: mockSupabaseClient as any,
        authService: mockAuthService,
      });

      let capturedActor: any = null;
      app.use('*', middleware);
      app.get('/test', (c) => {
        capturedActor = c.get('actor');
        return c.json({ ok: true });
      });

      await app.request('/test', {
        headers: {
          Authorization: 'Bearer valid-token',
          'x-forwarded-for': '192.168.1.1',
        },
      });

      expect(capturedActor.ip).toBe('192.168.1.1');
    });

    it('should capture user-agent header', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });
      mockAuthService.resolvePermissions.mockResolvedValue({
        success: true,
        data: [],
      });

      const middleware = createAuthMiddleware({
        supabaseClient: mockSupabaseClient as any,
        authService: mockAuthService,
      });

      let capturedActor: any = null;
      app.use('*', middleware);
      app.get('/test', (c) => {
        capturedActor = c.get('actor');
        return c.json({ ok: true });
      });

      await app.request('/test', {
        headers: {
          Authorization: 'Bearer valid-token',
          'user-agent': 'TestClient/1.0',
        },
      });

      expect(capturedActor.userAgent).toBe('TestClient/1.0');
    });
  });

  describe('Error Handling', () => {
    it('should include requestId in all error responses', async () => {
      const middleware = createAuthMiddleware({
        supabaseClient: mockSupabaseClient as any,
        authService: mockAuthService,
      });

      app.use('*', middleware);
      app.get('/test', (c) => c.json({ ok: true }));

      const res = await app.request('/test');

      const body = await res.json();
      expect(body.error.requestId).toBeDefined();
    });

    it('should handle unexpected errors gracefully', async () => {
      mockSupabaseClient.auth.getUser.mockRejectedValue(
        new Error('Network error')
      );

      const middleware = createAuthMiddleware({
        supabaseClient: mockSupabaseClient as any,
        authService: mockAuthService,
      });

      app.use('*', middleware);
      app.get('/test', (c) => c.json({ ok: true }));

      const res = await app.request('/test', {
        headers: { Authorization: 'Bearer valid-token' },
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });
});

describe('Public Middleware', () => {
  it('should create anonymous actor for public routes', async () => {
    const { createPublicMiddleware } = await import('@/api/middleware/auth.js');

    const app = new Hono();
    const middleware = createPublicMiddleware();

    let capturedActor: any = null;
    app.use('*', middleware);
    app.get('/health', (c) => {
      capturedActor = c.get('actor');
      return c.json({ status: 'ok' });
    });

    const res = await app.request('/health');

    expect(res.status).toBe(200);
    expect(capturedActor).not.toBeNull();
    expect(capturedActor.type).toBe('anonymous');
    expect(capturedActor.permissions).toEqual([]);
    expect(capturedActor.userId).toBeUndefined();
  });
});
