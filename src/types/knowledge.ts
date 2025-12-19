/**
 * Knowledge Domain Types
 * Phase 2: TDD - Type definitions for KnowledgeService
 *
 * Reference: docs/stage-2-service-layer.md Section 3.5
 *
 * SCOPE: RAG knowledge base management with governance
 *
 * Policy Enforcement: Knowledge versioning policy (Stage 1 Section 9.3)
 */

/**
 * Knowledge item status - lifecycle states
 */
export type KnowledgeStatus =
  | 'draft'
  | 'pending_review'
  | 'approved'
  | 'published'
  | 'archived';

/**
 * Knowledge item entity
 */
export interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  category: string | null;
  status: KnowledgeStatus;
  authorId: string;
  reviewerId: string | null;
  publishedAt: Date | null;
  version: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Parameters for creating a knowledge item
 */
export interface CreateKnowledgeItemParams {
  title: string;
  content: string;
  category?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Parameters for updating a knowledge item
 */
export interface KnowledgeItemUpdate {
  title?: string;
  content?: string;
  category?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Parameters for listing knowledge items
 */
export interface ListKnowledgeItemsParams {
  status?: KnowledgeStatus;
  category?: string;
  authorId?: string;
}

/**
 * Knowledge search result (for RAG)
 */
export interface KnowledgeSearchResult {
  item: KnowledgeItem;
  chunk: string;
  chunkIndex: number;
  similarity: number;
}

/**
 * Knowledge version history entry
 */
export interface KnowledgeVersion {
  version: number;
  title: string;
  content: string;
  authorId: string;
  createdAt: Date;
}

/**
 * Knowledge search parameters
 */
export interface SearchKnowledgeParams {
  query: string;
  limit?: number;
  minSimilarity?: number;
  categories?: string[];
}
