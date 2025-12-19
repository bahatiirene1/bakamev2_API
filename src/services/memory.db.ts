/**
 * MemoryService Database Adapter
 * Implements MemoryServiceDb interface using Supabase
 *
 * Reference: docs/stage-2-service-layer.md Section 3.4
 * Reference: docs/stage-1-database-governance.md Section 9.2 (Memory Retention Policy)
 *
 * SCOPE: Long-term user memory management
 * NOT IN SCOPE: Embedding generation (AI-agnostic)
 *
 * NOTE: Embedding generation is scheduled via scheduleEmbedding()
 * Actual embedding is done by Stage 5 (Tool Execution) or a background job
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  Memory,
  MemoryStatus,
  MemorySource,
  MemoryUpdate,
  ListMemoriesParams,
  SearchMemoriesParams,
  MemorySearchResult,
  PaginatedResult,
} from '@/types/index.js';

import type { MemoryServiceDb } from './memory.service.js';

/**
 * Database row types
 */
interface MemoryRow {
  id: string;
  user_id: string;
  content: string;
  category: string | null;
  source: string;
  importance: number;
  status: string;
  created_at: string;
  updated_at: string;
  last_accessed: string | null;
}

/**
 * Map database row to Memory entity
 */
function mapRowToMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    userId: row.user_id,
    content: row.content,
    category: row.category,
    source: row.source as MemorySource,
    importance: row.importance,
    status: row.status as MemoryStatus,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    lastAccessed:
      row.last_accessed !== null ? new Date(row.last_accessed) : null,
  };
}

/**
 * Create MemoryServiceDb implementation using Supabase
 */
export function createMemoryServiceDb(
  supabase: SupabaseClient
): MemoryServiceDb {
  return {
    /**
     * Create a new memory
     */
    async createMemory(params: {
      userId: string;
      content: string;
      category?: string;
      source: string;
      importance: number;
    }): Promise<Memory> {
      const { data, error } = await supabase
        .from('memories')
        .insert({
          user_id: params.userId,
          content: params.content,
          category: params.category ?? null,
          source: params.source,
          importance: params.importance,
          status: 'active',
        })
        .select('*')
        .single();

      if (error !== null) {
        throw new Error(`Failed to create memory: ${error.message}`);
      }

      return mapRowToMemory(data as MemoryRow);
    },

    /**
     * Get memory by ID
     */
    async getMemory(memoryId: string): Promise<Memory | null> {
      const { data, error } = await supabase
        .from('memories')
        .select('*')
        .eq('id', memoryId)
        .single();

      if (error !== null) {
        if (error.code === 'PGRST116') {
          return null;
        }
        throw new Error(`Failed to get memory: ${error.message}`);
      }

      return mapRowToMemory(data as MemoryRow);
    },

    /**
     * Update memory
     */
    async updateMemory(
      memoryId: string,
      updates: MemoryUpdate
    ): Promise<Memory> {
      const updateData: Record<string, unknown> = {};

      if (updates.content !== undefined) {
        updateData.content = updates.content;
      }
      if (updates.category !== undefined) {
        updateData.category = updates.category;
      }
      if (updates.importance !== undefined) {
        updateData.importance = updates.importance;
      }

      const { data, error } = await supabase
        .from('memories')
        .update(updateData)
        .eq('id', memoryId)
        .select('*')
        .single();

      if (error !== null) {
        throw new Error(`Failed to update memory: ${error.message}`);
      }

      return mapRowToMemory(data as MemoryRow);
    },

    /**
     * Update memory status
     */
    async updateMemoryStatus(
      memoryId: string,
      status: string
    ): Promise<Memory> {
      const { data, error } = await supabase
        .from('memories')
        .update({ status })
        .eq('id', memoryId)
        .select('*')
        .single();

      if (error !== null) {
        throw new Error(`Failed to update memory status: ${error.message}`);
      }

      return mapRowToMemory(data as MemoryRow);
    },

    /**
     * List memories for a user with pagination
     */
    async listMemories(
      userId: string,
      params: ListMemoriesParams
    ): Promise<PaginatedResult<Memory>> {
      let query = supabase
        .from('memories')
        .select('*')
        .eq('user_id', userId)
        .neq('status', 'deleted')
        .order('created_at', { ascending: false });

      // Filter by category if provided
      if (params.category !== undefined) {
        query = query.eq('category', params.category);
      }

      // Filter by status if provided
      if (params.status !== undefined) {
        query = query.eq('status', params.status);
      }

      // Apply cursor-based pagination
      if (params.cursor !== undefined) {
        query = query.lt('created_at', params.cursor);
      }

      // Fetch one more than limit to determine hasMore
      const limit = params.limit;
      query = query.limit(limit + 1);

      const { data, error } = await query;

      if (error !== null) {
        throw new Error(`Failed to list memories: ${error.message}`);
      }

      const rows = (data ?? []) as MemoryRow[];
      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit).map(mapRowToMemory);

      const result: PaginatedResult<Memory> = { items, hasMore };
      const lastItem = items[items.length - 1];
      if (hasMore && lastItem !== undefined) {
        result.nextCursor = lastItem.createdAt.toISOString();
      }

      return result;
    },

    /**
     * Search memories by semantic similarity
     * Uses pgvector for cosine similarity search
     */
    async searchMemories(
      userId: string,
      params: SearchMemoriesParams & { limit: number; minSimilarity: number }
    ): Promise<MemorySearchResult[]> {
      // NOTE: This is a placeholder implementation
      // In production, this would:
      // 1. Generate embedding for the query (via external service)
      // 2. Use pgvector to find similar embeddings
      // 3. Return memories with similarity scores
      //
      // For now, we use a text search fallback until Stage 5 provides embedding

      let query = supabase
        .from('memories')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active')
        .ilike('content', `%${params.query}%`)
        .limit(params.limit);

      // Filter by categories if provided
      if (params.categories !== undefined && params.categories.length > 0) {
        query = query.in('category', params.categories);
      }

      const { data, error } = await query;

      if (error !== null) {
        throw new Error(`Failed to search memories: ${error.message}`);
      }

      const rows = (data ?? []) as MemoryRow[];

      // Return with placeholder similarity (text search doesn't provide real similarity)
      return rows.map((row) => ({
        memory: mapRowToMemory(row),
        similarity: 0.8, // Placeholder - real similarity comes from vector search
      }));
    },

    /**
     * Update last_accessed timestamp
     */
    async updateLastAccessed(memoryId: string): Promise<void> {
      const { error } = await supabase
        .from('memories')
        .update({ last_accessed: new Date().toISOString() })
        .eq('id', memoryId);

      if (error !== null) {
        throw new Error(`Failed to update last_accessed: ${error.message}`);
      }
    },

    /**
     * Get memory IDs that haven't been accessed in N days
     */
    async getInactiveMemoryIds(daysInactive: number): Promise<string[]> {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysInactive);

      const { data, error } = await supabase
        .from('memories')
        .select('id')
        .eq('status', 'active')
        .or(
          `last_accessed.is.null,last_accessed.lt.${cutoffDate.toISOString()}`
        )
        .lt('created_at', cutoffDate.toISOString());

      if (error !== null) {
        throw new Error(`Failed to get inactive memories: ${error.message}`);
      }

      return (data ?? []).map((row: { id: string }) => row.id);
    },

    /**
     * Bulk update status for multiple memories
     */
    async bulkUpdateStatus(
      memoryIds: string[],
      status: string
    ): Promise<number> {
      if (memoryIds.length === 0) {
        return 0;
      }

      const { data, error } = await supabase
        .from('memories')
        .update({ status })
        .in('id', memoryIds)
        .select('id');

      if (error !== null) {
        throw new Error(`Failed to bulk update status: ${error.message}`);
      }

      return (data ?? []).length;
    },

    /**
     * Clear all vectors for a user (for re-embedding)
     */
    async clearVectorsForUser(userId: string): Promise<number> {
      // Get all memory IDs for this user
      const { data: memories, error: memoriesError } = await supabase
        .from('memories')
        .select('id')
        .eq('user_id', userId);

      if (memoriesError !== null) {
        throw new Error(
          `Failed to get user memories: ${memoriesError.message}`
        );
      }

      const memoryIds = (memories ?? []).map((m: { id: string }) => m.id);

      if (memoryIds.length === 0) {
        return 0;
      }

      // Delete all vectors for these memories
      const { data, error } = await supabase
        .from('memory_vectors')
        .delete()
        .in('memory_id', memoryIds)
        .select('id');

      if (error !== null) {
        throw new Error(`Failed to clear vectors: ${error.message}`);
      }

      return (data ?? []).length;
    },

    /**
     * Schedule embedding generation for a memory
     * NOTE: This is a placeholder - actual embedding is done by Stage 5
     *
     * In production, this would:
     * 1. Insert a job into a queue (e.g., pg_boss, BullMQ)
     * 2. A worker picks up the job and generates the embedding
     * 3. The worker stores the embedding in memory_vectors
     */
    async scheduleEmbedding(memoryId: string): Promise<void> {
      // Placeholder implementation
      // In a real implementation, this would insert a job into a queue
      // For now, we'll create a placeholder vector entry

      // Check if vector already exists
      const { data: existing } = await supabase
        .from('memory_vectors')
        .select('id')
        .eq('memory_id', memoryId)
        .single();

      if (existing !== null) {
        // Vector exists, delete it so it can be regenerated
        await supabase
          .from('memory_vectors')
          .delete()
          .eq('memory_id', memoryId);
      }

      // Insert placeholder entry (embedding will be populated by Stage 5 worker)
      const { error } = await supabase.from('memory_vectors').insert({
        memory_id: memoryId,
        embedding: null, // Will be populated by embedding worker
        model: 'pending', // Indicates embedding is pending
      });

      if (error !== null) {
        // Don't throw - embedding scheduling is best-effort
        console.error(`Failed to schedule embedding: ${error.message}`);
      }
    },
  };
}
