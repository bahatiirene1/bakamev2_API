/**
 * MemoryService Implementation
 * Phase 2: TDD - GREEN phase
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
 *
 * Dependencies: AuditService (for logging)
 */

import type {
  ActorContext,
  Memory,
  CreateMemoryParams,
  MemoryUpdate,
  ListMemoriesParams,
  SearchMemoriesParams,
  MemorySearchResult,
  PaginatedResult,
  Result,
  AuditEvent,
} from '@/types/index.js';
import { success, failure } from '@/types/index.js';

/**
 * Database abstraction interface for MemoryService
 */
export interface MemoryServiceDb {
  createMemory: (params: {
    userId: string;
    content: string;
    category?: string;
    source: string;
    importance: number;
  }) => Promise<Memory>;
  getMemory: (memoryId: string) => Promise<Memory | null>;
  updateMemory: (memoryId: string, updates: MemoryUpdate) => Promise<Memory>;
  updateMemoryStatus: (memoryId: string, status: string) => Promise<Memory>;
  listMemories: (
    userId: string,
    params: ListMemoriesParams
  ) => Promise<PaginatedResult<Memory>>;
  searchMemories: (
    userId: string,
    params: SearchMemoriesParams & { limit: number; minSimilarity: number }
  ) => Promise<MemorySearchResult[]>;
  updateLastAccessed: (memoryId: string) => Promise<void>;
  getInactiveMemoryIds: (daysInactive: number) => Promise<string[]>;
  bulkUpdateStatus: (memoryIds: string[], status: string) => Promise<number>;
  clearVectorsForUser: (userId: string) => Promise<number>;
  scheduleEmbedding: (memoryId: string) => Promise<void>;
}

/**
 * Minimal AuditService interface (subset needed by MemoryService)
 */
export interface MemoryServiceAudit {
  log: (actor: ActorContext, event: AuditEvent) => Promise<Result<void>>;
}

/**
 * MemoryService interface
 */
export interface MemoryService {
  createMemory(
    actor: ActorContext,
    params: CreateMemoryParams
  ): Promise<Result<Memory>>;
  getMemory(actor: ActorContext, memoryId: string): Promise<Result<Memory>>;
  listMemories(
    actor: ActorContext,
    userId: string,
    params: ListMemoriesParams
  ): Promise<Result<PaginatedResult<Memory>>>;
  updateMemory(
    actor: ActorContext,
    memoryId: string,
    updates: MemoryUpdate
  ): Promise<Result<Memory>>;
  archiveMemory(actor: ActorContext, memoryId: string): Promise<Result<void>>;
  deleteMemory(actor: ActorContext, memoryId: string): Promise<Result<void>>;
  searchMemories(
    actor: ActorContext,
    userId: string,
    params: SearchMemoriesParams
  ): Promise<Result<MemorySearchResult[]>>;
  archiveInactiveMemories(
    actor: ActorContext
  ): Promise<Result<{ archivedCount: number }>>;
  reembedUserMemories(
    actor: ActorContext,
    userId: string,
    newModel: string
  ): Promise<Result<{ processedCount: number }>>;
}

// ─────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────

/**
 * Check if actor is AI_ACTOR
 */
function isAIActor(actor: ActorContext): boolean {
  return actor.type === 'ai';
}

/**
 * Check if actor is SYSTEM_ACTOR
 */
function isSystemActor(actor: ActorContext): boolean {
  return actor.type === 'system';
}

/**
 * Check if actor has wildcard permission
 */
function hasWildcardPermission(actor: ActorContext): boolean {
  return actor.permissions.includes('*');
}

/**
 * Check if actor can access a memory (read)
 * - Owner can always access
 * - AI_ACTOR can read (for context assembly)
 * - System actor can access
 */
function canAccessMemory(actor: ActorContext, memory: Memory): boolean {
  // System actor can access any memory
  if (isSystemActor(actor)) {
    return true;
  }
  // AI_ACTOR can read any memory (for context assembly)
  if (isAIActor(actor)) {
    return true;
  }
  // Owner can always access
  if (actor.userId === memory.userId) {
    return true;
  }
  // Wildcard permission
  if (hasWildcardPermission(actor)) {
    return true;
  }
  return false;
}

/**
 * Check if actor can access memories for a user
 */
function canAccessUserMemories(actor: ActorContext, userId: string): boolean {
  // System actor can access any user's memories
  if (isSystemActor(actor)) {
    return true;
  }
  // AI_ACTOR can read any user's memories (for context assembly)
  if (isAIActor(actor)) {
    return true;
  }
  // Owner can access their own memories
  if (actor.userId === userId) {
    return true;
  }
  // Wildcard permission
  if (hasWildcardPermission(actor)) {
    return true;
  }
  return false;
}

/**
 * Check if actor has a specific permission
 */
function hasPermission(actor: ActorContext, permission: string): boolean {
  if (hasWildcardPermission(actor)) {
    return true;
  }
  return actor.permissions.includes(permission);
}

// ─────────────────────────────────────────────────────────────
// SERVICE IMPLEMENTATION
// ─────────────────────────────────────────────────────────────

/**
 * Create MemoryService instance
 */
export function createMemoryService(deps: {
  db: MemoryServiceDb;
  auditService: MemoryServiceAudit;
}): MemoryService {
  const { db, auditService } = deps;

  return {
    /**
     * Create a new memory
     * AI_ACTOR cannot create memories
     * Schedules embedding generation (async)
     */
    async createMemory(
      actor: ActorContext,
      params: CreateMemoryParams
    ): Promise<Result<Memory>> {
      // AI_ACTOR cannot create memories
      if (isAIActor(actor)) {
        return failure('PERMISSION_DENIED', 'AI cannot create memories');
      }

      // Validate content
      if (!params.content || params.content.trim() === '') {
        return failure('VALIDATION_ERROR', 'Memory content is required');
      }

      // Validate importance if provided
      if (params.importance !== undefined) {
        if (params.importance < 1 || params.importance > 10) {
          return failure(
            'VALIDATION_ERROR',
            'Memory importance must be between 1 and 10'
          );
        }
      }

      // Check permission - user can only create memories for themselves
      if (!isSystemActor(actor) && actor.userId !== params.userId) {
        return failure(
          'PERMISSION_DENIED',
          'Cannot create memory for another user'
        );
      }

      try {
        const createParams: {
          userId: string;
          content: string;
          category?: string;
          source: string;
          importance: number;
        } = {
          userId: params.userId,
          content: params.content,
          source: params.source,
          importance: params.importance ?? 5,
        };
        if (params.category !== undefined) {
          createParams.category = params.category;
        }

        const memory = await db.createMemory(createParams);

        // Schedule embedding generation (async - AI-agnostic principle)
        await db.scheduleEmbedding(memory.id);

        // Emit audit event
        await auditService.log(actor, {
          action: 'memory:created',
          resourceType: 'memory',
          resourceId: memory.id,
          details: { source: params.source, category: params.category },
        });

        return success(memory);
      } catch {
        return failure('INTERNAL_ERROR', 'Failed to create memory');
      }
    },

    /**
     * Get a memory by ID
     * AI_ACTOR can read (for context assembly)
     * Updates last_accessed timestamp
     */
    async getMemory(
      actor: ActorContext,
      memoryId: string
    ): Promise<Result<Memory>> {
      // Validate memoryId
      if (!memoryId || memoryId.trim() === '') {
        return failure('VALIDATION_ERROR', 'Memory ID is required');
      }

      const memory = await db.getMemory(memoryId);
      if (memory === null) {
        return failure('NOT_FOUND', 'Memory not found');
      }

      // Check permission
      if (!canAccessMemory(actor, memory)) {
        return failure(
          'PERMISSION_DENIED',
          'Cannot access memory without permission'
        );
      }

      // Update last_accessed timestamp
      await db.updateLastAccessed(memoryId);

      return success(memory);
    },

    /**
     * List user's memories
     * AI_ACTOR can read (for context assembly)
     */
    async listMemories(
      actor: ActorContext,
      userId: string,
      params: ListMemoriesParams
    ): Promise<Result<PaginatedResult<Memory>>> {
      // Check permission
      if (!canAccessUserMemories(actor, userId)) {
        return failure(
          'PERMISSION_DENIED',
          'Cannot access memories for this user'
        );
      }

      const result = await db.listMemories(userId, params);
      return success(result);
    },

    /**
     * Update memory content
     * AI_ACTOR cannot update memories
     * Schedules re-embedding if content changes (async)
     */
    async updateMemory(
      actor: ActorContext,
      memoryId: string,
      updates: MemoryUpdate
    ): Promise<Result<Memory>> {
      // AI_ACTOR cannot update memories
      if (isAIActor(actor)) {
        return failure('PERMISSION_DENIED', 'AI cannot update memories');
      }

      const memory = await db.getMemory(memoryId);
      if (memory === null) {
        return failure('NOT_FOUND', 'Memory not found');
      }

      // Check permission - user can only update their own memories
      if (!isSystemActor(actor) && actor.userId !== memory.userId) {
        return failure(
          'PERMISSION_DENIED',
          "Cannot update another user's memory"
        );
      }

      const updatedMemory = await db.updateMemory(memoryId, updates);

      // Schedule re-embedding only if content changed
      if (updates.content !== undefined) {
        await db.scheduleEmbedding(memoryId);
      }

      // Emit audit event
      await auditService.log(actor, {
        action: 'memory:updated',
        resourceType: 'memory',
        resourceId: memoryId,
        details: { updatedFields: Object.keys(updates) },
      });

      return success(updatedMemory);
    },

    /**
     * Archive a memory (reversible)
     * AI_ACTOR cannot archive memories
     */
    async archiveMemory(
      actor: ActorContext,
      memoryId: string
    ): Promise<Result<void>> {
      // AI_ACTOR cannot archive memories
      if (isAIActor(actor)) {
        return failure('PERMISSION_DENIED', 'AI cannot archive memories');
      }

      const memory = await db.getMemory(memoryId);
      if (memory === null) {
        return failure('NOT_FOUND', 'Memory not found');
      }

      // Check permission - user can only archive their own memories
      if (!isSystemActor(actor) && actor.userId !== memory.userId) {
        return failure(
          'PERMISSION_DENIED',
          "Cannot archive another user's memory"
        );
      }

      // Cannot archive already archived memory
      if (memory.status === 'archived') {
        return failure('VALIDATION_ERROR', 'Memory is already archived');
      }

      await db.updateMemoryStatus(memoryId, 'archived');

      // Emit audit event
      await auditService.log(actor, {
        action: 'memory:archived',
        resourceType: 'memory',
        resourceId: memoryId,
      });

      return success(undefined);
    },

    /**
     * Delete a memory (user-initiated, per policy)
     * AI_ACTOR cannot delete memories
     * Requires memory:delete permission
     */
    async deleteMemory(
      actor: ActorContext,
      memoryId: string
    ): Promise<Result<void>> {
      // AI_ACTOR cannot delete memories
      if (isAIActor(actor)) {
        return failure('PERMISSION_DENIED', 'AI cannot delete memories');
      }

      // Check permission
      if (!hasPermission(actor, 'memory:delete')) {
        return failure(
          'PERMISSION_DENIED',
          'memory:delete permission required'
        );
      }

      const memory = await db.getMemory(memoryId);
      if (memory === null) {
        return failure('NOT_FOUND', 'Memory not found');
      }

      // Check permission - user can only delete their own memories
      if (!isSystemActor(actor) && actor.userId !== memory.userId) {
        return failure(
          'PERMISSION_DENIED',
          "Cannot delete another user's memory"
        );
      }

      await db.updateMemoryStatus(memoryId, 'deleted');

      // Emit audit event
      await auditService.log(actor, {
        action: 'memory:deleted',
        resourceType: 'memory',
        resourceId: memoryId,
      });

      return success(undefined);
    },

    /**
     * Search memories by semantic similarity
     * AI_ACTOR can search (for context assembly)
     */
    async searchMemories(
      actor: ActorContext,
      userId: string,
      params: SearchMemoriesParams
    ): Promise<Result<MemorySearchResult[]>> {
      // Validate query
      if (!params.query || params.query.trim() === '') {
        return failure('VALIDATION_ERROR', 'Search query is required');
      }

      // Check permission
      if (!canAccessUserMemories(actor, userId)) {
        return failure(
          'PERMISSION_DENIED',
          'Cannot search memories for this user'
        );
      }

      const searchParams = {
        ...params,
        limit: params.limit ?? 10,
        minSimilarity: params.minSimilarity ?? 0.7,
      };

      const results = await db.searchMemories(userId, searchParams);
      return success(results);
    },

    /**
     * Auto-archive inactive memories (per policy: 180 days)
     * Called by system job
     * Requires: SYSTEM_ACTOR
     */
    async archiveInactiveMemories(
      actor: ActorContext
    ): Promise<Result<{ archivedCount: number }>> {
      // Requires SYSTEM_ACTOR
      if (!isSystemActor(actor)) {
        return failure(
          'PERMISSION_DENIED',
          'Only system can archive inactive memories'
        );
      }

      const INACTIVE_DAYS = 180;
      const inactiveIds = await db.getInactiveMemoryIds(INACTIVE_DAYS);

      if (inactiveIds.length === 0) {
        return success({ archivedCount: 0 });
      }

      const archivedCount = await db.bulkUpdateStatus(inactiveIds, 'archived');

      // Emit audit event
      await auditService.log(actor, {
        action: 'memory:bulk_archived',
        resourceType: 'memory',
        details: {
          archivedCount,
          reason: 'inactive_180_days',
        },
      });

      return success({ archivedCount });
    },

    /**
     * Re-embed all memories for a user (when model changes)
     * Requires: SYSTEM_ACTOR
     */
    async reembedUserMemories(
      actor: ActorContext,
      userId: string,
      newModel: string
    ): Promise<Result<{ processedCount: number }>> {
      // Requires SYSTEM_ACTOR
      if (!isSystemActor(actor)) {
        return failure(
          'PERMISSION_DENIED',
          'Only system can trigger re-embedding'
        );
      }

      // Clear existing vectors
      await db.clearVectorsForUser(userId);

      // Get all active memories for the user
      const memories = await db.listMemories(userId, {
        limit: 1000, // Process in batches for large sets
        status: 'active',
      });

      // Schedule embedding for each memory
      for (const memory of memories.items) {
        await db.scheduleEmbedding(memory.id);
      }

      // Emit audit event
      await auditService.log(actor, {
        action: 'memory:reembedding_scheduled',
        resourceType: 'memory',
        details: {
          userId,
          newModel,
          processedCount: memories.items.length,
        },
      });

      return success({ processedCount: memories.items.length });
    },
  };
}
