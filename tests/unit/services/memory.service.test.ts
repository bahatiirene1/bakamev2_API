/**
 * MemoryService Unit Tests
 * Phase 2: TDD - RED phase
 *
 * Reference: docs/stage-2-service-layer.md Section 3.4
 * Reference: docs/stage-1-database-governance.md Section 9.2 (Memory Retention Policy)
 *
 * SCOPE: Long-term user memory management
 * NOT IN SCOPE: Embedding generation (AI-agnostic principle)
 *
 * Policy: Memory Retention (Stage 1 Section 9.2)
 * - Default retention: Indefinite
 * - Auto-archive: After 180 days of no access
 * - Auto-delete: Never
 * - User override: Always allowed
 *
 * GUARDRAILS:
 * - Users can only access their own memories
 * - AI_ACTOR CAN read memories (for context assembly)
 * - AI_ACTOR CANNOT create/update/archive/delete memories
 * - All mutations emit audit events
 * - Embedding generation is async (scheduled, not synchronous)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import type {
  MemoryService,
  MemoryServiceDb,
  MemoryServiceAudit,
} from '@/services/memory.service.js';
import { createMemoryService } from '@/services/memory.service.js';
import type {
  ActorContext,
  Memory,
  PaginatedResult,
  MemorySearchResult,
} from '@/types/index.js';
import { AI_ACTOR, SYSTEM_ACTOR } from '@/types/index.js';

// ─────────────────────────────────────────────────────────────
// TEST FIXTURES
// ─────────────────────────────────────────────────────────────

const TEST_USER_ID = 'test-user-123';
const TEST_OTHER_USER_ID = 'test-other-user-456';
const TEST_MEMORY_ID = 'test-memory-789';
const TEST_REQUEST_ID = 'test-request-xyz';

const mockMemory: Memory = {
  id: TEST_MEMORY_ID,
  userId: TEST_USER_ID,
  content: 'User prefers concise responses',
  category: 'preferences',
  source: 'conversation',
  importance: 5,
  status: 'active',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  lastAccessed: null,
};

function createTestActor(overrides?: Partial<ActorContext>): ActorContext {
  return {
    type: 'user',
    userId: TEST_USER_ID,
    requestId: TEST_REQUEST_ID,
    permissions: ['memory:read', 'memory:write'],
    ...overrides,
  };
}

function createAdminActor(overrides?: Partial<ActorContext>): ActorContext {
  return {
    type: 'admin',
    userId: 'admin-user-id',
    requestId: TEST_REQUEST_ID,
    permissions: ['memory:read', 'memory:write', 'memory:delete'],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────
// MOCK SETUP
// ─────────────────────────────────────────────────────────────

function createMockDb(): MemoryServiceDb {
  return {
    createMemory: vi.fn(),
    getMemory: vi.fn(),
    updateMemory: vi.fn(),
    updateMemoryStatus: vi.fn(),
    listMemories: vi.fn(),
    searchMemories: vi.fn(),
    updateLastAccessed: vi.fn(),
    getInactiveMemoryIds: vi.fn(),
    bulkUpdateStatus: vi.fn(),
    clearVectorsForUser: vi.fn(),
    scheduleEmbedding: vi.fn(),
  };
}

function createMockAuditService(): MemoryServiceAudit {
  return {
    log: vi.fn().mockResolvedValue({ success: true, data: undefined }),
  };
}

// ─────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────

describe('MemoryService', () => {
  let memoryService: MemoryService;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockAuditService: ReturnType<typeof createMockAuditService>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockAuditService = createMockAuditService();
    memoryService = createMemoryService({
      db: mockDb,
      auditService: mockAuditService,
    });
  });

  // ─────────────────────────────────────────────────────────────
  // createMemory
  // ─────────────────────────────────────────────────────────────

  describe('createMemory', () => {
    it('should create a new memory for the user', async () => {
      const actor = createTestActor();
      mockDb.createMemory.mockResolvedValue(mockMemory);

      const result = await memoryService.createMemory(actor, {
        userId: TEST_USER_ID,
        content: 'User prefers concise responses',
        category: 'preferences',
        source: 'conversation',
        importance: 5,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.userId).toBe(TEST_USER_ID);
        expect(result.data.content).toBe('User prefers concise responses');
        expect(result.data.category).toBe('preferences');
      }
      expect(mockDb.createMemory).toHaveBeenCalled();
    });

    it('should use default importance of 5 if not provided', async () => {
      const actor = createTestActor();
      mockDb.createMemory.mockResolvedValue({ ...mockMemory, importance: 5 });

      const result = await memoryService.createMemory(actor, {
        userId: TEST_USER_ID,
        content: 'Some memory',
        source: 'conversation',
      });

      expect(result.success).toBe(true);
      expect(mockDb.createMemory).toHaveBeenCalledWith(
        expect.objectContaining({
          importance: 5,
        })
      );
    });

    it('should schedule embedding generation (async)', async () => {
      const actor = createTestActor();
      mockDb.createMemory.mockResolvedValue(mockMemory);

      await memoryService.createMemory(actor, {
        userId: TEST_USER_ID,
        content: 'Some memory',
        source: 'conversation',
      });

      expect(mockDb.scheduleEmbedding).toHaveBeenCalledWith(TEST_MEMORY_ID);
    });

    it('should deny AI_ACTOR from creating memories', async () => {
      const result = await memoryService.createMemory(AI_ACTOR, {
        userId: TEST_USER_ID,
        content: 'Some memory',
        source: 'conversation',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
        expect(result.error.message).toContain('AI cannot create memories');
      }
    });

    it('should allow SYSTEM_ACTOR to create memories for any user', async () => {
      mockDb.createMemory.mockResolvedValue(mockMemory);

      const result = await memoryService.createMemory(SYSTEM_ACTOR, {
        userId: TEST_USER_ID,
        content: 'System-created memory',
        source: 'system',
      });

      expect(result.success).toBe(true);
    });

    it('should deny user from creating memory for another user', async () => {
      const actor = createTestActor();

      const result = await memoryService.createMemory(actor, {
        userId: TEST_OTHER_USER_ID,
        content: 'Memory for other user',
        source: 'conversation',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should validate content is not empty', async () => {
      const actor = createTestActor();

      const result = await memoryService.createMemory(actor, {
        userId: TEST_USER_ID,
        content: '',
        source: 'conversation',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toContain('content');
      }
    });

    it('should validate importance is between 1 and 10', async () => {
      const actor = createTestActor();

      const result = await memoryService.createMemory(actor, {
        userId: TEST_USER_ID,
        content: 'Some memory',
        source: 'conversation',
        importance: 15,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toContain('importance');
      }
    });

    it('should emit audit event on creation', async () => {
      const actor = createTestActor();
      mockDb.createMemory.mockResolvedValue(mockMemory);

      await memoryService.createMemory(actor, {
        userId: TEST_USER_ID,
        content: 'Some memory',
        source: 'conversation',
      });

      expect(mockAuditService.log).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({
          action: 'memory:created',
          resourceType: 'memory',
          resourceId: TEST_MEMORY_ID,
        })
      );
    });
  });

  // ─────────────────────────────────────────────────────────────
  // getMemory
  // ─────────────────────────────────────────────────────────────

  describe('getMemory', () => {
    it('should get a memory by ID', async () => {
      const actor = createTestActor();
      mockDb.getMemory.mockResolvedValue(mockMemory);

      const result = await memoryService.getMemory(actor, TEST_MEMORY_ID);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(TEST_MEMORY_ID);
        expect(result.data.content).toBe('User prefers concise responses');
      }
    });

    it('should update last_accessed timestamp on get', async () => {
      const actor = createTestActor();
      mockDb.getMemory.mockResolvedValue(mockMemory);

      await memoryService.getMemory(actor, TEST_MEMORY_ID);

      expect(mockDb.updateLastAccessed).toHaveBeenCalledWith(TEST_MEMORY_ID);
    });

    it('should return NOT_FOUND for non-existent memory', async () => {
      const actor = createTestActor();
      mockDb.getMemory.mockResolvedValue(null);

      const result = await memoryService.getMemory(actor, 'non-existent-id');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should deny access to another user memory', async () => {
      const actor = createTestActor();
      const otherUserMemory = { ...mockMemory, userId: TEST_OTHER_USER_ID };
      mockDb.getMemory.mockResolvedValue(otherUserMemory);

      const result = await memoryService.getMemory(actor, TEST_MEMORY_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow AI_ACTOR to read memories (for context assembly)', async () => {
      mockDb.getMemory.mockResolvedValue(mockMemory);

      const result = await memoryService.getMemory(AI_ACTOR, TEST_MEMORY_ID);

      expect(result.success).toBe(true);
    });

    it('should validate memory ID is not empty', async () => {
      const actor = createTestActor();

      const result = await memoryService.getMemory(actor, '');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // listMemories
  // ─────────────────────────────────────────────────────────────

  describe('listMemories', () => {
    const mockPaginatedResult: PaginatedResult<Memory> = {
      items: [mockMemory],
      hasMore: false,
    };

    it('should list memories for the user', async () => {
      const actor = createTestActor();
      mockDb.listMemories.mockResolvedValue(mockPaginatedResult);

      const result = await memoryService.listMemories(actor, TEST_USER_ID, {
        limit: 20,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.items).toHaveLength(1);
        expect(result.data.items[0].id).toBe(TEST_MEMORY_ID);
      }
    });

    it('should filter memories by category', async () => {
      const actor = createTestActor();
      mockDb.listMemories.mockResolvedValue(mockPaginatedResult);

      await memoryService.listMemories(actor, TEST_USER_ID, {
        limit: 20,
        category: 'preferences',
      });

      expect(mockDb.listMemories).toHaveBeenCalledWith(
        TEST_USER_ID,
        expect.objectContaining({
          category: 'preferences',
        })
      );
    });

    it('should filter memories by status', async () => {
      const actor = createTestActor();
      mockDb.listMemories.mockResolvedValue(mockPaginatedResult);

      await memoryService.listMemories(actor, TEST_USER_ID, {
        limit: 20,
        status: 'archived',
      });

      expect(mockDb.listMemories).toHaveBeenCalledWith(
        TEST_USER_ID,
        expect.objectContaining({
          status: 'archived',
        })
      );
    });

    it('should support cursor-based pagination', async () => {
      const actor = createTestActor();
      mockDb.listMemories.mockResolvedValue({
        items: [mockMemory],
        hasMore: true,
        nextCursor: 'next-cursor',
      });

      const result = await memoryService.listMemories(actor, TEST_USER_ID, {
        limit: 10,
        cursor: 'some-cursor',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.hasMore).toBe(true);
        expect(result.data.nextCursor).toBe('next-cursor');
      }
    });

    it('should deny user from listing another user memories', async () => {
      const actor = createTestActor();

      const result = await memoryService.listMemories(
        actor,
        TEST_OTHER_USER_ID,
        { limit: 20 }
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow AI_ACTOR to list memories (for context assembly)', async () => {
      mockDb.listMemories.mockResolvedValue(mockPaginatedResult);

      const result = await memoryService.listMemories(AI_ACTOR, TEST_USER_ID, {
        limit: 20,
      });

      expect(result.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // updateMemory
  // ─────────────────────────────────────────────────────────────

  describe('updateMemory', () => {
    it('should update memory content', async () => {
      const actor = createTestActor();
      mockDb.getMemory.mockResolvedValue(mockMemory);
      mockDb.updateMemory.mockResolvedValue({
        ...mockMemory,
        content: 'Updated content',
      });

      const result = await memoryService.updateMemory(actor, TEST_MEMORY_ID, {
        content: 'Updated content',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toBe('Updated content');
      }
    });

    it('should schedule re-embedding when content changes', async () => {
      const actor = createTestActor();
      mockDb.getMemory.mockResolvedValue(mockMemory);
      mockDb.updateMemory.mockResolvedValue({
        ...mockMemory,
        content: 'Updated content',
      });

      await memoryService.updateMemory(actor, TEST_MEMORY_ID, {
        content: 'Updated content',
      });

      expect(mockDb.scheduleEmbedding).toHaveBeenCalledWith(TEST_MEMORY_ID);
    });

    it('should NOT schedule re-embedding when only importance changes', async () => {
      const actor = createTestActor();
      mockDb.getMemory.mockResolvedValue(mockMemory);
      mockDb.updateMemory.mockResolvedValue({
        ...mockMemory,
        importance: 8,
      });

      await memoryService.updateMemory(actor, TEST_MEMORY_ID, {
        importance: 8,
      });

      expect(mockDb.scheduleEmbedding).not.toHaveBeenCalled();
    });

    it('should deny AI_ACTOR from updating memories', async () => {
      mockDb.getMemory.mockResolvedValue(mockMemory);

      const result = await memoryService.updateMemory(
        AI_ACTOR,
        TEST_MEMORY_ID,
        {
          content: 'Updated by AI',
        }
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
        expect(result.error.message).toContain('AI cannot update memories');
      }
    });

    it('should deny user from updating another user memory', async () => {
      const actor = createTestActor();
      const otherUserMemory = { ...mockMemory, userId: TEST_OTHER_USER_ID };
      mockDb.getMemory.mockResolvedValue(otherUserMemory);

      const result = await memoryService.updateMemory(actor, TEST_MEMORY_ID, {
        content: 'Updated content',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should return NOT_FOUND for non-existent memory', async () => {
      const actor = createTestActor();
      mockDb.getMemory.mockResolvedValue(null);

      const result = await memoryService.updateMemory(
        actor,
        'non-existent-id',
        {
          content: 'Updated content',
        }
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should emit audit event on update', async () => {
      const actor = createTestActor();
      mockDb.getMemory.mockResolvedValue(mockMemory);
      mockDb.updateMemory.mockResolvedValue({
        ...mockMemory,
        content: 'Updated content',
      });

      await memoryService.updateMemory(actor, TEST_MEMORY_ID, {
        content: 'Updated content',
      });

      expect(mockAuditService.log).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({
          action: 'memory:updated',
          resourceType: 'memory',
          resourceId: TEST_MEMORY_ID,
        })
      );
    });
  });

  // ─────────────────────────────────────────────────────────────
  // archiveMemory
  // ─────────────────────────────────────────────────────────────

  describe('archiveMemory', () => {
    it('should archive a memory', async () => {
      const actor = createTestActor();
      mockDb.getMemory.mockResolvedValue(mockMemory);
      mockDb.updateMemoryStatus.mockResolvedValue({
        ...mockMemory,
        status: 'archived',
      });

      const result = await memoryService.archiveMemory(actor, TEST_MEMORY_ID);

      expect(result.success).toBe(true);
      expect(mockDb.updateMemoryStatus).toHaveBeenCalledWith(
        TEST_MEMORY_ID,
        'archived'
      );
    });

    it('should deny AI_ACTOR from archiving memories', async () => {
      mockDb.getMemory.mockResolvedValue(mockMemory);

      const result = await memoryService.archiveMemory(
        AI_ACTOR,
        TEST_MEMORY_ID
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
        expect(result.error.message).toContain('AI cannot archive memories');
      }
    });

    it('should deny user from archiving another user memory', async () => {
      const actor = createTestActor();
      const otherUserMemory = { ...mockMemory, userId: TEST_OTHER_USER_ID };
      mockDb.getMemory.mockResolvedValue(otherUserMemory);

      const result = await memoryService.archiveMemory(actor, TEST_MEMORY_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should return error if memory already archived', async () => {
      const actor = createTestActor();
      const archivedMemory = { ...mockMemory, status: 'archived' as const };
      mockDb.getMemory.mockResolvedValue(archivedMemory);

      const result = await memoryService.archiveMemory(actor, TEST_MEMORY_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toContain('already archived');
      }
    });

    it('should emit audit event on archive', async () => {
      const actor = createTestActor();
      mockDb.getMemory.mockResolvedValue(mockMemory);
      mockDb.updateMemoryStatus.mockResolvedValue({
        ...mockMemory,
        status: 'archived',
      });

      await memoryService.archiveMemory(actor, TEST_MEMORY_ID);

      expect(mockAuditService.log).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({
          action: 'memory:archived',
          resourceType: 'memory',
          resourceId: TEST_MEMORY_ID,
        })
      );
    });
  });

  // ─────────────────────────────────────────────────────────────
  // deleteMemory
  // ─────────────────────────────────────────────────────────────

  describe('deleteMemory', () => {
    it('should delete a memory (soft delete)', async () => {
      const actor = createTestActor({
        permissions: ['memory:read', 'memory:write', 'memory:delete'],
      });
      mockDb.getMemory.mockResolvedValue(mockMemory);
      mockDb.updateMemoryStatus.mockResolvedValue({
        ...mockMemory,
        status: 'deleted',
      });

      const result = await memoryService.deleteMemory(actor, TEST_MEMORY_ID);

      expect(result.success).toBe(true);
      expect(mockDb.updateMemoryStatus).toHaveBeenCalledWith(
        TEST_MEMORY_ID,
        'deleted'
      );
    });

    it('should require memory:delete permission', async () => {
      const actor = createTestActor({
        permissions: ['memory:read', 'memory:write'],
      });
      mockDb.getMemory.mockResolvedValue(mockMemory);

      const result = await memoryService.deleteMemory(actor, TEST_MEMORY_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should deny AI_ACTOR from deleting memories', async () => {
      mockDb.getMemory.mockResolvedValue(mockMemory);

      const result = await memoryService.deleteMemory(AI_ACTOR, TEST_MEMORY_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
        expect(result.error.message).toContain('AI cannot delete memories');
      }
    });

    it('should deny user from deleting another user memory', async () => {
      const actor = createTestActor({
        permissions: ['memory:read', 'memory:write', 'memory:delete'],
      });
      const otherUserMemory = { ...mockMemory, userId: TEST_OTHER_USER_ID };
      mockDb.getMemory.mockResolvedValue(otherUserMemory);

      const result = await memoryService.deleteMemory(actor, TEST_MEMORY_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should emit audit event on delete', async () => {
      const actor = createTestActor({
        permissions: ['memory:read', 'memory:write', 'memory:delete'],
      });
      mockDb.getMemory.mockResolvedValue(mockMemory);
      mockDb.updateMemoryStatus.mockResolvedValue({
        ...mockMemory,
        status: 'deleted',
      });

      await memoryService.deleteMemory(actor, TEST_MEMORY_ID);

      expect(mockAuditService.log).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({
          action: 'memory:deleted',
          resourceType: 'memory',
          resourceId: TEST_MEMORY_ID,
        })
      );
    });
  });

  // ─────────────────────────────────────────────────────────────
  // searchMemories
  // ─────────────────────────────────────────────────────────────

  describe('searchMemories', () => {
    const mockSearchResults: MemorySearchResult[] = [
      { memory: mockMemory, similarity: 0.85 },
    ];

    it('should search memories by semantic similarity', async () => {
      const actor = createTestActor();
      mockDb.searchMemories.mockResolvedValue(mockSearchResults);

      const result = await memoryService.searchMemories(actor, TEST_USER_ID, {
        query: 'user preferences',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].similarity).toBe(0.85);
      }
    });

    it('should use default limit of 10', async () => {
      const actor = createTestActor();
      mockDb.searchMemories.mockResolvedValue(mockSearchResults);

      await memoryService.searchMemories(actor, TEST_USER_ID, {
        query: 'user preferences',
      });

      expect(mockDb.searchMemories).toHaveBeenCalledWith(
        TEST_USER_ID,
        expect.objectContaining({
          limit: 10,
        })
      );
    });

    it('should use default minSimilarity of 0.7', async () => {
      const actor = createTestActor();
      mockDb.searchMemories.mockResolvedValue(mockSearchResults);

      await memoryService.searchMemories(actor, TEST_USER_ID, {
        query: 'user preferences',
      });

      expect(mockDb.searchMemories).toHaveBeenCalledWith(
        TEST_USER_ID,
        expect.objectContaining({
          minSimilarity: 0.7,
        })
      );
    });

    it('should filter by categories', async () => {
      const actor = createTestActor();
      mockDb.searchMemories.mockResolvedValue(mockSearchResults);

      await memoryService.searchMemories(actor, TEST_USER_ID, {
        query: 'user preferences',
        categories: ['preferences', 'facts'],
      });

      expect(mockDb.searchMemories).toHaveBeenCalledWith(
        TEST_USER_ID,
        expect.objectContaining({
          categories: ['preferences', 'facts'],
        })
      );
    });

    it('should deny user from searching another user memories', async () => {
      const actor = createTestActor();

      const result = await memoryService.searchMemories(
        actor,
        TEST_OTHER_USER_ID,
        { query: 'user preferences' }
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow AI_ACTOR to search memories (for context assembly)', async () => {
      mockDb.searchMemories.mockResolvedValue(mockSearchResults);

      const result = await memoryService.searchMemories(
        AI_ACTOR,
        TEST_USER_ID,
        {
          query: 'user preferences',
        }
      );

      expect(result.success).toBe(true);
    });

    it('should validate query is not empty', async () => {
      const actor = createTestActor();

      const result = await memoryService.searchMemories(actor, TEST_USER_ID, {
        query: '',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // archiveInactiveMemories (System operation)
  // ─────────────────────────────────────────────────────────────

  describe('archiveInactiveMemories', () => {
    it('should archive memories not accessed in 180 days', async () => {
      mockDb.getInactiveMemoryIds.mockResolvedValue(['mem1', 'mem2', 'mem3']);
      mockDb.bulkUpdateStatus.mockResolvedValue(3);

      const result = await memoryService.archiveInactiveMemories(SYSTEM_ACTOR);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.archivedCount).toBe(3);
      }
    });

    it('should require SYSTEM_ACTOR', async () => {
      const actor = createTestActor();

      const result = await memoryService.archiveInactiveMemories(actor);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should deny AI_ACTOR', async () => {
      const result = await memoryService.archiveInactiveMemories(AI_ACTOR);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should emit audit event', async () => {
      mockDb.getInactiveMemoryIds.mockResolvedValue(['mem1', 'mem2']);
      mockDb.bulkUpdateStatus.mockResolvedValue(2);

      await memoryService.archiveInactiveMemories(SYSTEM_ACTOR);

      expect(mockAuditService.log).toHaveBeenCalledWith(
        SYSTEM_ACTOR,
        expect.objectContaining({
          action: 'memory:bulk_archived',
          resourceType: 'memory',
          details: expect.objectContaining({
            archivedCount: 2,
            reason: 'inactive_180_days',
          }),
        })
      );
    });
  });

  // ─────────────────────────────────────────────────────────────
  // reembedUserMemories (System operation)
  // ─────────────────────────────────────────────────────────────

  describe('reembedUserMemories', () => {
    it('should schedule re-embedding for all user memories', async () => {
      mockDb.clearVectorsForUser.mockResolvedValue(5);
      mockDb.listMemories.mockResolvedValue({
        items: [mockMemory, { ...mockMemory, id: 'mem2' }],
        hasMore: false,
      });

      const result = await memoryService.reembedUserMemories(
        SYSTEM_ACTOR,
        TEST_USER_ID,
        'text-embedding-3-large'
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.processedCount).toBe(2);
      }
    });

    it('should clear existing vectors before re-embedding', async () => {
      mockDb.clearVectorsForUser.mockResolvedValue(5);
      mockDb.listMemories.mockResolvedValue({
        items: [mockMemory],
        hasMore: false,
      });

      await memoryService.reembedUserMemories(
        SYSTEM_ACTOR,
        TEST_USER_ID,
        'text-embedding-3-large'
      );

      expect(mockDb.clearVectorsForUser).toHaveBeenCalledWith(TEST_USER_ID);
    });

    it('should require SYSTEM_ACTOR', async () => {
      const actor = createTestActor();

      const result = await memoryService.reembedUserMemories(
        actor,
        TEST_USER_ID,
        'text-embedding-3-large'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should deny AI_ACTOR', async () => {
      const result = await memoryService.reembedUserMemories(
        AI_ACTOR,
        TEST_USER_ID,
        'text-embedding-3-large'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should emit audit event', async () => {
      mockDb.clearVectorsForUser.mockResolvedValue(5);
      mockDb.listMemories.mockResolvedValue({
        items: [mockMemory],
        hasMore: false,
      });

      await memoryService.reembedUserMemories(
        SYSTEM_ACTOR,
        TEST_USER_ID,
        'text-embedding-3-large'
      );

      expect(mockAuditService.log).toHaveBeenCalledWith(
        SYSTEM_ACTOR,
        expect.objectContaining({
          action: 'memory:reembedding_scheduled',
          resourceType: 'memory',
          details: expect.objectContaining({
            userId: TEST_USER_ID,
            newModel: 'text-embedding-3-large',
          }),
        })
      );
    });
  });
});
