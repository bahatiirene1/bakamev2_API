/**
 * MemoryService Integration Tests
 * Phase 2: Tests with real Supabase database
 *
 * These tests require:
 * - SUPABASE_URL environment variable
 * - SUPABASE_SERVICE_KEY environment variable
 * - Database with memories, memory_vectors tables
 *
 * Tests are skipped if credentials are not available.
 *
 * SCOPE: Long-term user memory management
 * NOT IN SCOPE: Embedding generation (AI-agnostic)
 *
 * Policy: Memory Retention (Stage 1 Section 9.2)
 * - Default retention: Indefinite
 * - Auto-archive: After 180 days of no access
 * - Auto-delete: Never
 * - User override: Always allowed
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import {
  createMemoryService,
  createMemoryServiceDb,
  createAuditService,
  createAuditServiceDb,
  createUserService,
  createUserServiceDb,
} from '@/services/index.js';
import type {
  MemoryService,
  AuditService,
  UserService,
} from '@/services/index.js';
import type { ActorContext } from '@/types/index.js';
import { SYSTEM_ACTOR, AI_ACTOR } from '@/types/index.js';

// Check if we have database credentials
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const HAS_CREDENTIALS =
  SUPABASE_URL !== undefined &&
  SUPABASE_URL !== '' &&
  SUPABASE_SERVICE_KEY !== undefined &&
  SUPABASE_SERVICE_KEY !== '';

// Test fixtures - use nanoid for unique test identifiers
const TEST_PREFIX = `mem_test_${nanoid(6)}`;

// Helper to create unique test IDs
function testId(prefix: string): string {
  return `${TEST_PREFIX}_${prefix}_${nanoid(6)}`;
}

// Helper to create test actor
function createTestActor(
  userId: string,
  overrides?: Partial<ActorContext>
): ActorContext {
  return {
    type: 'user',
    userId,
    requestId: testId('req'),
    permissions: ['memory:read', 'memory:write', 'memory:delete'],
    ...overrides,
  };
}

// Helper to create admin actor
function createAdminActor(overrides?: Partial<ActorContext>): ActorContext {
  return {
    type: 'admin',
    userId: testId('admin'),
    requestId: testId('req'),
    permissions: ['memory:read', 'memory:write', 'memory:delete'],
    ...overrides,
  };
}

describe.skipIf(!HAS_CREDENTIALS)('MemoryService Integration', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let supabase: SupabaseClient<any, 'public', any>;
  let memoryService: MemoryService;
  let auditService: AuditService;
  let userService: UserService;

  // Track created resources for cleanup
  const createdUserIds: string[] = [];
  const createdMemoryIds: string[] = [];

  beforeAll(async () => {
    // Create Supabase client with service key (bypasses RLS)
    supabase = createClient(
      SUPABASE_URL!,
      SUPABASE_SERVICE_KEY!
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ) as SupabaseClient<any, 'public', any>;

    // Create database adapters and services
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const auditDb = createAuditServiceDb(supabase);
    auditService = createAuditService({ db: auditDb });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const userDb = createUserServiceDb(supabase);
    userService = createUserService({ db: userDb, auditService });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const memoryDb = createMemoryServiceDb(supabase);
    memoryService = createMemoryService({ db: memoryDb, auditService });
  });

  afterAll(async () => {
    // Cleanup in reverse order (memories first, then users)

    // Delete memories (and their vectors via CASCADE)
    if (createdMemoryIds.length > 0) {
      await supabase.from('memories').delete().in('id', createdMemoryIds);
    }

    // Delete test users
    if (createdUserIds.length > 0) {
      await supabase.from('users').delete().in('id', createdUserIds);
    }
  }, 60000);

  // Helper to create a test user
  async function createTestUser(): Promise<string> {
    const userId = testId('user');
    const email = `${userId}@test.local`;

    await supabase.from('users').insert({
      id: userId,
      email,
      status: 'active',
    });

    createdUserIds.push(userId);
    return userId;
  }

  // ─────────────────────────────────────────────────────────────
  // createMemory
  // ─────────────────────────────────────────────────────────────

  describe('createMemory', () => {
    it('should create a memory in the database', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      const result = await memoryService.createMemory(actor, {
        userId,
        content: 'User prefers dark mode',
        category: 'preferences',
        source: 'conversation',
        importance: 7,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        createdMemoryIds.push(result.data.id);
        expect(result.data.userId).toBe(userId);
        expect(result.data.content).toBe('User prefers dark mode');
        expect(result.data.category).toBe('preferences');
        expect(result.data.source).toBe('conversation');
        expect(result.data.importance).toBe(7);
        expect(result.data.status).toBe('active');
      }
    });

    it('should create memory with default importance', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      const result = await memoryService.createMemory(actor, {
        userId,
        content: 'User likes TypeScript',
        source: 'user_input',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        createdMemoryIds.push(result.data.id);
        expect(result.data.importance).toBe(5);
      }
    });

    it('should deny AI_ACTOR from creating memories', async () => {
      const userId = await createTestUser();

      const result = await memoryService.createMemory(AI_ACTOR, {
        userId,
        content: 'AI trying to create memory',
        source: 'system',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow SYSTEM_ACTOR to create memories', async () => {
      const userId = await createTestUser();

      const result = await memoryService.createMemory(SYSTEM_ACTOR, {
        userId,
        content: 'System-created memory',
        source: 'system',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        createdMemoryIds.push(result.data.id);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // getMemory
  // ─────────────────────────────────────────────────────────────

  describe('getMemory', () => {
    it('should get memory by ID', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      // Create a memory first
      const createResult = await memoryService.createMemory(actor, {
        userId,
        content: 'Test memory for get',
        source: 'conversation',
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdMemoryIds.push(createResult.data.id);

      // Get the memory
      const getResult = await memoryService.getMemory(
        actor,
        createResult.data.id
      );

      expect(getResult.success).toBe(true);
      if (getResult.success) {
        expect(getResult.data.content).toBe('Test memory for get');
      }
    });

    it('should return NOT_FOUND for non-existent memory', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      const result = await memoryService.getMemory(
        actor,
        '00000000-0000-0000-0000-000000000000'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should deny access to another user memory', async () => {
      const userId1 = await createTestUser();
      const userId2 = await createTestUser();
      const actor1 = createTestActor(userId1);
      const actor2 = createTestActor(userId2);

      // Create memory as user1
      const createResult = await memoryService.createMemory(actor1, {
        userId: userId1,
        content: 'User1 memory',
        source: 'conversation',
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdMemoryIds.push(createResult.data.id);

      // Try to get as user2
      const getResult = await memoryService.getMemory(
        actor2,
        createResult.data.id
      );

      expect(getResult.success).toBe(false);
      if (!getResult.success) {
        expect(getResult.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow AI_ACTOR to read memories', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      // Create a memory
      const createResult = await memoryService.createMemory(actor, {
        userId,
        content: 'Memory readable by AI',
        source: 'conversation',
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdMemoryIds.push(createResult.data.id);

      // AI_ACTOR should be able to read it
      const getResult = await memoryService.getMemory(
        AI_ACTOR,
        createResult.data.id
      );

      expect(getResult.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // listMemories
  // ─────────────────────────────────────────────────────────────

  describe('listMemories', () => {
    it('should list user memories', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      // Create some memories
      for (let i = 0; i < 3; i++) {
        const result = await memoryService.createMemory(actor, {
          userId,
          content: `Memory ${i}`,
          source: 'conversation',
        });
        if (result.success) {
          createdMemoryIds.push(result.data.id);
        }
      }

      const listResult = await memoryService.listMemories(actor, userId, {
        limit: 10,
      });

      expect(listResult.success).toBe(true);
      if (listResult.success) {
        expect(listResult.data.items.length).toBeGreaterThanOrEqual(3);
      }
    });

    it('should filter by category', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      // Create memories with different categories
      const result1 = await memoryService.createMemory(actor, {
        userId,
        content: 'Preferences memory',
        category: 'preferences',
        source: 'conversation',
      });
      if (result1.success) {
        createdMemoryIds.push(result1.data.id);
      }

      const result2 = await memoryService.createMemory(actor, {
        userId,
        content: 'Facts memory',
        category: 'facts',
        source: 'conversation',
      });
      if (result2.success) {
        createdMemoryIds.push(result2.data.id);
      }

      // List only preferences
      const listResult = await memoryService.listMemories(actor, userId, {
        limit: 10,
        category: 'preferences',
      });

      expect(listResult.success).toBe(true);
      if (listResult.success) {
        expect(
          listResult.data.items.every((m) => m.category === 'preferences')
        ).toBe(true);
      }
    });

    it('should deny listing another user memories', async () => {
      const userId1 = await createTestUser();
      const userId2 = await createTestUser();
      const actor2 = createTestActor(userId2);

      const result = await memoryService.listMemories(actor2, userId1, {
        limit: 10,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // updateMemory
  // ─────────────────────────────────────────────────────────────

  describe('updateMemory', () => {
    it('should update memory content', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      // Create a memory
      const createResult = await memoryService.createMemory(actor, {
        userId,
        content: 'Original content',
        source: 'conversation',
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdMemoryIds.push(createResult.data.id);

      // Update it
      const updateResult = await memoryService.updateMemory(
        actor,
        createResult.data.id,
        {
          content: 'Updated content',
        }
      );

      expect(updateResult.success).toBe(true);
      if (updateResult.success) {
        expect(updateResult.data.content).toBe('Updated content');
      }
    });

    it('should deny AI_ACTOR from updating memories', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      // Create a memory
      const createResult = await memoryService.createMemory(actor, {
        userId,
        content: 'Memory to update',
        source: 'conversation',
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdMemoryIds.push(createResult.data.id);

      // AI_ACTOR tries to update
      const updateResult = await memoryService.updateMemory(
        AI_ACTOR,
        createResult.data.id,
        {
          content: 'AI updated content',
        }
      );

      expect(updateResult.success).toBe(false);
      if (!updateResult.success) {
        expect(updateResult.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // archiveMemory
  // ─────────────────────────────────────────────────────────────

  describe('archiveMemory', () => {
    it('should archive a memory', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      // Create a memory
      const createResult = await memoryService.createMemory(actor, {
        userId,
        content: 'Memory to archive',
        source: 'conversation',
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdMemoryIds.push(createResult.data.id);

      // Archive it
      const archiveResult = await memoryService.archiveMemory(
        actor,
        createResult.data.id
      );

      expect(archiveResult.success).toBe(true);

      // Verify it's archived
      const getResult = await memoryService.getMemory(
        actor,
        createResult.data.id
      );
      expect(getResult.success).toBe(true);
      if (getResult.success) {
        expect(getResult.data.status).toBe('archived');
      }
    });

    it('should deny archiving already archived memory', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      // Create and archive a memory
      const createResult = await memoryService.createMemory(actor, {
        userId,
        content: 'Memory to archive twice',
        source: 'conversation',
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdMemoryIds.push(createResult.data.id);

      await memoryService.archiveMemory(actor, createResult.data.id);

      // Try to archive again
      const archiveResult = await memoryService.archiveMemory(
        actor,
        createResult.data.id
      );

      expect(archiveResult.success).toBe(false);
      if (!archiveResult.success) {
        expect(archiveResult.error.code).toBe('VALIDATION_ERROR');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // deleteMemory
  // ─────────────────────────────────────────────────────────────

  describe('deleteMemory', () => {
    it('should delete a memory (soft delete)', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      // Create a memory
      const createResult = await memoryService.createMemory(actor, {
        userId,
        content: 'Memory to delete',
        source: 'conversation',
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdMemoryIds.push(createResult.data.id);

      // Delete it
      const deleteResult = await memoryService.deleteMemory(
        actor,
        createResult.data.id
      );

      expect(deleteResult.success).toBe(true);

      // Memory should still exist but with deleted status
      const { data } = await supabase
        .from('memories')
        .select('status')
        .eq('id', createResult.data.id)
        .single();

      expect(data?.status).toBe('deleted');
    });

    it('should deny AI_ACTOR from deleting memories', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      // Create a memory
      const createResult = await memoryService.createMemory(actor, {
        userId,
        content: 'Memory AI tries to delete',
        source: 'conversation',
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdMemoryIds.push(createResult.data.id);

      // AI_ACTOR tries to delete
      const deleteResult = await memoryService.deleteMemory(
        AI_ACTOR,
        createResult.data.id
      );

      expect(deleteResult.success).toBe(false);
      if (!deleteResult.success) {
        expect(deleteResult.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // searchMemories
  // ─────────────────────────────────────────────────────────────

  describe('searchMemories', () => {
    it('should search memories by text (placeholder for semantic search)', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      // Create some memories
      const result1 = await memoryService.createMemory(actor, {
        userId,
        content: 'User prefers TypeScript over JavaScript',
        category: 'preferences',
        source: 'conversation',
      });
      if (result1.success) {
        createdMemoryIds.push(result1.data.id);
      }

      const result2 = await memoryService.createMemory(actor, {
        userId,
        content: 'User works at a tech company',
        category: 'facts',
        source: 'conversation',
      });
      if (result2.success) {
        createdMemoryIds.push(result2.data.id);
      }

      // Search for TypeScript
      const searchResult = await memoryService.searchMemories(actor, userId, {
        query: 'TypeScript',
      });

      expect(searchResult.success).toBe(true);
      if (searchResult.success) {
        expect(searchResult.data.length).toBeGreaterThanOrEqual(1);
        expect(
          searchResult.data.some((r) => r.memory.content.includes('TypeScript'))
        ).toBe(true);
      }
    });

    it('should allow AI_ACTOR to search memories', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      // Create a memory
      const result = await memoryService.createMemory(actor, {
        userId,
        content: 'Searchable memory for AI',
        source: 'conversation',
      });
      if (result.success) {
        createdMemoryIds.push(result.data.id);
      }

      // AI_ACTOR should be able to search
      const searchResult = await memoryService.searchMemories(
        AI_ACTOR,
        userId,
        {
          query: 'Searchable',
        }
      );

      expect(searchResult.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // archiveInactiveMemories (System operation)
  // ─────────────────────────────────────────────────────────────

  describe('archiveInactiveMemories', () => {
    it('should require SYSTEM_ACTOR', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      const result = await memoryService.archiveInactiveMemories(actor);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow SYSTEM_ACTOR to archive inactive memories', async () => {
      const result = await memoryService.archiveInactiveMemories(SYSTEM_ACTOR);

      // Should succeed even if no memories to archive
      expect(result.success).toBe(true);
      if (result.success) {
        expect(typeof result.data.archivedCount).toBe('number');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // reembedUserMemories (System operation)
  // ─────────────────────────────────────────────────────────────

  describe('reembedUserMemories', () => {
    it('should require SYSTEM_ACTOR', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      const result = await memoryService.reembedUserMemories(
        actor,
        userId,
        'new-model'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow SYSTEM_ACTOR to trigger re-embedding', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      // Create some memories
      const result = await memoryService.createMemory(actor, {
        userId,
        content: 'Memory to reembed',
        source: 'conversation',
      });
      if (result.success) {
        createdMemoryIds.push(result.data.id);
      }

      const reembedResult = await memoryService.reembedUserMemories(
        SYSTEM_ACTOR,
        userId,
        'text-embedding-3-large'
      );

      expect(reembedResult.success).toBe(true);
      if (reembedResult.success) {
        expect(typeof reembedResult.data.processedCount).toBe('number');
      }
    });
  });
});
