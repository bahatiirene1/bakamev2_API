/**
 * RAGConfig Types
 * Types for admin-configurable RAG/Memory settings
 *
 * Reference: docs/stage-4-ai-orchestrator.md Section 2.4
 */

/**
 * Memory categories for extraction
 */
export type MemoryCategory = 'preference' | 'fact' | 'event' | 'instruction';

/**
 * RAG Configuration entity
 */
export interface RAGConfig {
  id: string;
  name: string;
  description: string | null;

  // Token Budgets
  memoryTokenBudget: number;
  knowledgeTokenBudget: number;
  conversationTokenBudget: number;

  // Retrieval Limits
  memoryLimit: number;
  knowledgeLimit: number;
  minSimilarity: number;

  // Reranking Weights
  importanceWeight: number;
  similarityWeight: number;
  recencyWeight: number;

  // Embedding Configuration
  embeddingModel: string;
  embeddingDimensions: number;

  // Memory Extraction Settings
  extractionEnabled: boolean;
  extractionPrompt: string | null;
  memoryCategories: MemoryCategory[];

  // Consolidation Settings
  consolidationEnabled: boolean;
  consolidationThreshold: number;

  // Status
  isActive: boolean;
  authorId: string;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  activatedAt: Date | null;
}

/**
 * Parameters for creating a RAG config
 */
export interface CreateRAGConfigParams {
  name: string;
  description?: string;

  // Token Budgets (optional, use defaults)
  memoryTokenBudget?: number;
  knowledgeTokenBudget?: number;
  conversationTokenBudget?: number;

  // Retrieval Limits (optional, use defaults)
  memoryLimit?: number;
  knowledgeLimit?: number;
  minSimilarity?: number;

  // Reranking Weights (optional, use defaults)
  importanceWeight?: number;
  similarityWeight?: number;
  recencyWeight?: number;

  // Embedding Configuration (optional, use defaults)
  embeddingModel?: string;
  embeddingDimensions?: number;

  // Memory Extraction Settings (optional, use defaults)
  extractionEnabled?: boolean;
  extractionPrompt?: string;
  memoryCategories?: MemoryCategory[];

  // Consolidation Settings (optional, use defaults)
  consolidationEnabled?: boolean;
  consolidationThreshold?: number;
}

/**
 * Parameters for updating a RAG config
 */
export interface RAGConfigUpdate {
  name?: string;
  description?: string;

  // Token Budgets
  memoryTokenBudget?: number;
  knowledgeTokenBudget?: number;
  conversationTokenBudget?: number;

  // Retrieval Limits
  memoryLimit?: number;
  knowledgeLimit?: number;
  minSimilarity?: number;

  // Reranking Weights
  importanceWeight?: number;
  similarityWeight?: number;
  recencyWeight?: number;

  // Embedding Configuration
  embeddingModel?: string;
  embeddingDimensions?: number;

  // Memory Extraction Settings
  extractionEnabled?: boolean;
  extractionPrompt?: string | null;
  memoryCategories?: MemoryCategory[];

  // Consolidation Settings
  consolidationEnabled?: boolean;
  consolidationThreshold?: number;
}

/**
 * Parameters for listing RAG configs
 */
export interface ListRAGConfigsParams {
  isActive?: boolean;
  authorId?: string;
}

/**
 * Default RAG config values
 */
export const DEFAULT_RAG_CONFIG: Omit<
  RAGConfig,
  'id' | 'name' | 'authorId' | 'createdAt' | 'updatedAt' | 'activatedAt'
> = {
  description: null,

  // Token Budgets
  memoryTokenBudget: 2000,
  knowledgeTokenBudget: 4000,
  conversationTokenBudget: 4000,

  // Retrieval Limits
  memoryLimit: 10,
  knowledgeLimit: 5,
  minSimilarity: 0.7,

  // Reranking Weights
  importanceWeight: 0.3,
  similarityWeight: 0.5,
  recencyWeight: 0.2,

  // Embedding Configuration
  embeddingModel: 'text-embedding-3-small',
  embeddingDimensions: 1536,

  // Memory Extraction Settings
  extractionEnabled: true,
  extractionPrompt: null,
  memoryCategories: ['preference', 'fact', 'event', 'instruction'],

  // Consolidation Settings
  consolidationEnabled: true,
  consolidationThreshold: 0.85,

  // Status
  isActive: false,
};
