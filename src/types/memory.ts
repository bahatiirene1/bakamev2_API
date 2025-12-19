/**
 * Memory Domain Types
 * Phase 2: TDD - Type definitions for MemoryService
 *
 * Reference: docs/stage-2-service-layer.md Section 3.4
 * Reference: docs/stage-1-database-governance.md Section 2.6
 *
 * SCOPE: Long-term user memory management
 * NOT IN SCOPE: Embedding generation (AI-agnostic principle)
 *
 * Policy: Memory Retention (Stage 1 Section 9.2)
 * - Default retention: Indefinite
 * - Auto-archive: After 180 days of no access
 * - Auto-delete: Never
 * - User override: Always allowed
 */

/**
 * Memory source - where the memory came from
 */
export type MemorySource = 'conversation' | 'user_input' | 'system';

/**
 * Memory status
 */
export type MemoryStatus = 'active' | 'archived' | 'deleted';

/**
 * Memory entity - long-term knowledge about the user
 */
export interface Memory {
  id: string;
  userId: string;
  content: string;
  category: string | null;
  source: MemorySource;
  importance: number; // 1-10, default 5
  status: MemoryStatus;
  createdAt: Date;
  updatedAt: Date;
  lastAccessed: Date | null;
}

/**
 * Parameters for creating a memory
 */
export interface CreateMemoryParams {
  userId: string;
  content: string;
  category?: string;
  source: MemorySource;
  importance?: number; // 1-10, default 5
}

/**
 * Parameters for updating a memory
 */
export interface MemoryUpdate {
  content?: string;
  category?: string;
  importance?: number;
}

/**
 * Parameters for listing memories
 */
export interface ListMemoriesParams {
  cursor?: string;
  limit: number;
  category?: string;
  status?: 'active' | 'archived';
}

/**
 * Parameters for searching memories semantically
 */
export interface SearchMemoriesParams {
  query: string;
  limit?: number; // default 10
  minSimilarity?: number; // default 0.7
  categories?: string[];
}

/**
 * Memory search result with similarity score
 */
export interface MemorySearchResult {
  memory: Memory;
  similarity: number; // 0-1
}

/**
 * Memory vector for semantic search
 * NOTE: MemoryService does NOT generate embeddings
 * Embedding generation is handled by Stage 5 (Tool Execution)
 */
export interface MemoryVector {
  id: string;
  memoryId: string;
  embedding: number[] | null; // null when pending embedding
  model: string;
  createdAt: Date;
}
