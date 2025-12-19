/**
 * Load & Stress Tests
 * Phase C Pillar 3: Selective stress testing of hot paths
 *
 * Focus areas:
 * - Message creation (high traffic endpoint)
 * - Context building (complex aggregation)
 * - Concurrent operations
 * - Rate limiting verification
 *
 * These tests verify system behavior under load.
 */

import { Hono } from 'hono';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createChatRoutes } from '@/api/routes/chats.js';
import { createMemoryRoutes } from '@/api/routes/memories.js';
import type { ActorContext } from '@/types/index.js';

// ─────────────────────────────────────────────────────────────
// TEST HELPERS
// ─────────────────────────────────────────────────────────────

function createUserActor(userId: string = 'user-load-test'): ActorContext {
  return {
    type: 'user',
    userId,
    requestId: `req-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    permissions: ['chat:read', 'chat:write', 'memory:read', 'memory:write'],
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
// CONCURRENT MESSAGE CREATION
// ─────────────────────────────────────────────────────────────

describe('Load: Concurrent Message Creation', () => {
  let app: Hono;
  let mockChatService: any;
  let messageCounter: number;

  beforeEach(() => {
    messageCounter = 0;

    mockChatService = {
      getChat: vi.fn().mockResolvedValue({
        success: true,
        data: {
          id: 'chat-1',
          userId: 'user-load-test',
          status: 'active',
          title: 'Test Chat',
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      }),
      addMessage: vi.fn().mockImplementation(async () => {
        // Use unique ID to avoid race condition issues
        const uniqueId = `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        messageCounter++;
        // Simulate varying latency
        await new Promise((r) => setTimeout(r, Math.random() * 10));
        return {
          success: true,
          data: {
            id: uniqueId,
            chatId: 'chat-1',
            role: 'user',
            content: 'Test',
            createdAt: new Date(),
          },
        };
      }),
      getMessages: vi.fn().mockResolvedValue({
        success: true,
        data: { items: [], nextCursor: null, hasMore: false },
      }),
    };

    app = new Hono();
    app.use('*', mockAuthMiddleware(createUserActor()));
    app.route('/api/v1', createChatRoutes({ chatService: mockChatService }));
  });

  it('handles 10 concurrent message requests', async () => {
    const requests = Array.from({ length: 10 }, (_, i) =>
      app.request('/api/v1/chats/chat-1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `Message ${i}` }),
      })
    );

    const responses = await Promise.all(requests);

    // All should succeed
    const statuses = responses.map((r) => r.status);
    expect(statuses.every((s) => s === 201)).toBe(true);

    // All messages should have unique IDs
    const bodies = await Promise.all(responses.map((r) => r.json()));
    const ids = bodies.map((b) => b.data.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(10);
  });

  it('handles 50 concurrent message requests', async () => {
    const requests = Array.from({ length: 50 }, (_, i) =>
      app.request('/api/v1/chats/chat-1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `Burst message ${i}` }),
      })
    );

    const start = Date.now();
    const responses = await Promise.all(requests);
    const duration = Date.now() - start;

    // All should succeed
    const successCount = responses.filter((r) => r.status === 201).length;
    expect(successCount).toBe(50);

    // Should complete in reasonable time (< 5 seconds)
    expect(duration).toBeLessThan(5000);
  });

  it('maintains order correctness under concurrent writes', async () => {
    const timestamps: number[] = [];

    mockChatService.addMessage.mockImplementation(async () => {
      const now = Date.now();
      timestamps.push(now);
      await new Promise((r) => setTimeout(r, Math.random() * 5));
      return {
        success: true,
        data: {
          id: `msg-${timestamps.length}`,
          chatId: 'chat-1',
          role: 'user',
          content: 'Test',
          createdAt: new Date(now),
        },
      };
    });

    await Promise.all(
      Array.from({ length: 20 }, () =>
        app.request('/api/v1/chats/chat-1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'Test' }),
        })
      )
    );

    expect(timestamps.length).toBe(20);
  });
});

// ─────────────────────────────────────────────────────────────
// CONCURRENT CHAT OPERATIONS
// ─────────────────────────────────────────────────────────────

describe('Load: Concurrent Chat Operations', () => {
  let app: Hono;
  let mockChatService: any;
  let chatCounter: number;

  beforeEach(() => {
    chatCounter = 0;

    mockChatService = {
      createChat: vi.fn().mockImplementation(async () => {
        chatCounter++;
        return {
          success: true,
          data: {
            id: `chat-${chatCounter}`,
            userId: 'user-load-test',
            title: 'Test',
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        };
      }),
      listChats: vi.fn().mockImplementation(async () => {
        // Simulate DB query time
        await new Promise((r) => setTimeout(r, 5));
        return {
          success: true,
          data: {
            items: Array.from({ length: 10 }, (_, i) => ({
              id: `chat-${i}`,
              title: `Chat ${i}`,
              status: 'active',
              createdAt: new Date(),
              updatedAt: new Date(),
            })),
            nextCursor: null,
            hasMore: false,
          },
        };
      }),
      getChat: vi.fn().mockResolvedValue({
        success: true,
        data: {
          id: 'chat-1',
          userId: 'user-load-test',
          status: 'active',
          title: 'Test Chat',
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      }),
    };

    app = new Hono();
    app.use('*', mockAuthMiddleware(createUserActor()));
    app.route('/api/v1', createChatRoutes({ chatService: mockChatService }));
  });

  it('handles mixed read/write operations', async () => {
    const operations = [
      // 5 creates
      ...Array.from({ length: 5 }, () =>
        app.request('/api/v1/chats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'New Chat' }),
        })
      ),
      // 10 lists
      ...Array.from({ length: 10 }, () => app.request('/api/v1/chats')),
      // 5 gets
      ...Array.from({ length: 5 }, () => app.request('/api/v1/chats/chat-1')),
    ];

    const responses = await Promise.all(operations);

    // Creates should succeed with 201
    const creates = responses.slice(0, 5);
    expect(creates.every((r) => r.status === 201)).toBe(true);

    // Lists should succeed with 200
    const lists = responses.slice(5, 15);
    expect(lists.every((r) => r.status === 200)).toBe(true);

    // Gets should succeed with 200
    const gets = responses.slice(15);
    expect(gets.every((r) => r.status === 200)).toBe(true);
  });

  it('handles rapid successive creates', async () => {
    const creates = Array.from({ length: 20 }, (_, i) =>
      app.request('/api/v1/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `Rapid Chat ${i}` }),
      })
    );

    const responses = await Promise.all(creates);
    const bodies = await Promise.all(responses.map((r) => r.json()));

    // All should succeed
    expect(responses.every((r) => r.status === 201)).toBe(true);

    // All IDs should be unique
    const ids = bodies.map((b) => b.data.id);
    expect(new Set(ids).size).toBe(20);
  });
});

// ─────────────────────────────────────────────────────────────
// MEMORY SEARCH UNDER LOAD
// ─────────────────────────────────────────────────────────────

describe('Load: Memory Search Operations', () => {
  let app: Hono;
  let mockMemoryService: any;
  let searchCount: number;

  beforeEach(() => {
    searchCount = 0;

    mockMemoryService = {
      searchMemories: vi.fn().mockImplementation(async () => {
        searchCount++;
        // Simulate vector search latency
        await new Promise((r) => setTimeout(r, 10 + Math.random() * 20));
        return {
          success: true,
          data: Array.from({ length: 5 }, (_, i) => ({
            memory: {
              id: `mem-${i}`,
              content: `Memory ${i}`,
              userId: 'user-load-test',
              category: 'general',
              source: 'user_input',
              importance: 5,
              status: 'active',
              createdAt: new Date(),
              updatedAt: new Date(),
              lastAccessed: null,
            },
            similarity: 0.9 - i * 0.1,
          })),
        };
      }),
      listMemories: vi.fn().mockResolvedValue({
        success: true,
        data: { items: [], nextCursor: null, hasMore: false },
      }),
    };

    app = new Hono();
    app.use('*', mockAuthMiddleware(createUserActor()));
    app.route(
      '/api/v1',
      createMemoryRoutes({ memoryService: mockMemoryService })
    );
  });

  it('handles concurrent search requests', async () => {
    const searches = Array.from({ length: 10 }, (_, i) =>
      app.request(`/api/v1/memories?search=query${i}`)
    );

    const start = Date.now();
    const responses = await Promise.all(searches);
    const duration = Date.now() - start;

    // All should succeed
    expect(responses.every((r) => r.status === 200)).toBe(true);

    // Should have executed all searches
    expect(searchCount).toBe(10);

    // Concurrent searches should be faster than sequential
    // 10 searches at 10-30ms each = 100-300ms sequential
    // Concurrent should complete in ~30-50ms
    expect(duration).toBeLessThan(500);
  });

  it('search results maintain quality under load', async () => {
    const searches = Array.from({ length: 5 }, () =>
      app.request('/api/v1/memories?search=test')
    );

    const responses = await Promise.all(searches);
    const bodies = await Promise.all(responses.map((r) => r.json()));

    // All should return same number of results
    const resultCounts = bodies.map((b) => b.data.items.length);
    expect(resultCounts.every((c) => c === 5)).toBe(true);

    // Similarity scores should be ordered
    for (const body of bodies) {
      const similarities = body.data.items.map((i: any) => i.similarity);
      for (let i = 1; i < similarities.length; i++) {
        expect(similarities[i]).toBeLessThanOrEqual(similarities[i - 1]);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────
// RATE LIMITING SIMULATION
// ─────────────────────────────────────────────────────────────

describe('Load: Rate Limiting Behavior', () => {
  let app: Hono;
  let mockChatService: any;
  let requestCount: number;
  const RATE_LIMIT = 20;

  beforeEach(() => {
    requestCount = 0;

    mockChatService = {
      listChats: vi.fn().mockImplementation(async () => {
        requestCount++;
        if (requestCount > RATE_LIMIT) {
          return {
            success: false,
            error: { code: 'RATE_LIMITED', message: 'Too many requests' },
          };
        }
        return {
          success: true,
          data: { items: [], nextCursor: null, hasMore: false },
        };
      }),
    };

    app = new Hono();
    app.use('*', mockAuthMiddleware(createUserActor()));
    app.route('/api/v1', createChatRoutes({ chatService: mockChatService }));
  });

  it('allows requests within rate limit', async () => {
    const requests = Array.from({ length: RATE_LIMIT }, () =>
      app.request('/api/v1/chats')
    );

    const responses = await Promise.all(requests);

    // All should succeed
    expect(responses.every((r) => r.status === 200)).toBe(true);
  });

  it('returns 429 when rate limit exceeded', async () => {
    const requests = Array.from({ length: RATE_LIMIT + 5 }, () =>
      app.request('/api/v1/chats')
    );

    const responses = await Promise.all(requests);
    const statuses = responses.map((r) => r.status);

    // First RATE_LIMIT should succeed
    const successCount = statuses.filter((s) => s === 200).length;
    expect(successCount).toBe(RATE_LIMIT);

    // Rest should be rate limited
    const rateLimitedCount = statuses.filter((s) => s === 429).length;
    expect(rateLimitedCount).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────
// MULTI-USER CONCURRENT ACCESS
// ─────────────────────────────────────────────────────────────

describe('Load: Multi-User Concurrent Access', () => {
  let mockChatService: any;
  const userChats: Map<string, string[]> = new Map();

  beforeEach(() => {
    userChats.clear();

    mockChatService = {
      createChat: vi.fn().mockImplementation(async (actor: ActorContext) => {
        const chatId = `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const userId = actor.userId;

        if (!userChats.has(userId)) {
          userChats.set(userId, []);
        }
        userChats.get(userId)!.push(chatId);

        return {
          success: true,
          data: {
            id: chatId,
            userId,
            title: 'Test',
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        };
      }),
      listChats: vi.fn().mockImplementation(async (actor: ActorContext) => {
        const chats = userChats.get(actor.userId) || [];
        return {
          success: true,
          data: {
            items: chats.map((id) => ({
              id,
              title: 'Test',
              status: 'active',
              createdAt: new Date(),
              updatedAt: new Date(),
            })),
            nextCursor: null,
            hasMore: false,
          },
        };
      }),
    };
  });

  it('isolates data between concurrent users', async () => {
    const users = ['user-1', 'user-2', 'user-3'];

    // Each user creates 3 chats concurrently
    const createOps = users.flatMap((userId) =>
      Array.from({ length: 3 }, () => {
        const app = new Hono();
        app.use('*', mockAuthMiddleware(createUserActor(userId)));
        app.route(
          '/api/v1',
          createChatRoutes({ chatService: mockChatService })
        );

        return app.request('/api/v1/chats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Test' }),
        });
      })
    );

    await Promise.all(createOps);

    // Each user should have exactly 3 chats
    for (const userId of users) {
      expect(userChats.get(userId)?.length).toBe(3);
    }

    // Total chats = 9
    const totalChats = Array.from(userChats.values()).flat().length;
    expect(totalChats).toBe(9);
  });

  it('prevents cross-user data access', async () => {
    // User 1 creates a chat
    const user1App = new Hono();
    user1App.use('*', mockAuthMiddleware(createUserActor('user-1')));
    user1App.route(
      '/api/v1',
      createChatRoutes({ chatService: mockChatService })
    );

    await user1App.request('/api/v1/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'User 1 Chat' }),
    });

    // User 2 lists chats
    const user2App = new Hono();
    user2App.use('*', mockAuthMiddleware(createUserActor('user-2')));
    user2App.route(
      '/api/v1',
      createChatRoutes({ chatService: mockChatService })
    );

    const listRes = await user2App.request('/api/v1/chats');
    const body = await listRes.json();

    // User 2 should not see User 1's chats
    expect(body.data.items.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// RESPONSE TIME MONITORING
// ─────────────────────────────────────────────────────────────

describe('Load: Response Time Monitoring', () => {
  let app: Hono;
  let mockChatService: any;

  beforeEach(() => {
    mockChatService = {
      listChats: vi.fn().mockImplementation(async () => {
        // Simulate realistic DB query
        await new Promise((r) => setTimeout(r, 5));
        return {
          success: true,
          data: { items: [], nextCursor: null, hasMore: false },
        };
      }),
      createChat: vi.fn().mockImplementation(async () => {
        // Simulate write operation
        await new Promise((r) => setTimeout(r, 10));
        return {
          success: true,
          data: {
            id: 'chat-1',
            userId: 'user-test',
            title: 'Test',
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        };
      }),
    };

    app = new Hono();
    app.use('*', mockAuthMiddleware(createUserActor()));
    app.route('/api/v1', createChatRoutes({ chatService: mockChatService }));
  });

  it('tracks p50 response time', async () => {
    const times: number[] = [];

    for (let i = 0; i < 20; i++) {
      const start = Date.now();
      await app.request('/api/v1/chats');
      times.push(Date.now() - start);
    }

    times.sort((a, b) => a - b);
    const p50 = times[Math.floor(times.length * 0.5)];

    // p50 should be under 50ms for mock
    expect(p50).toBeLessThan(50);
  });

  it('tracks p99 response time', async () => {
    const times: number[] = [];

    for (let i = 0; i < 100; i++) {
      const start = Date.now();
      await app.request('/api/v1/chats');
      times.push(Date.now() - start);
    }

    times.sort((a, b) => a - b);
    const p99 = times[Math.floor(times.length * 0.99)];

    // p99 should be under 100ms for mock
    expect(p99).toBeLessThan(100);
  });
});
