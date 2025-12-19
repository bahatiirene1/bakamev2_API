/**
 * Embedding Domain Types
 * Phase 5: RAG system embedding types
 *
 * Reference: docs/stage-4-ai-orchestrator.md
 *
 * SCOPE: Vector embedding generation for RAG
 */

/**
 * Embedding configuration (from RAGConfig)
 */
export interface EmbeddingConfig {
  /** OpenAI embedding model to use */
  model: string;
  /** Vector dimensions */
  dimensions: number;
}

/**
 * Default embedding configuration
 */
export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  model: 'text-embedding-3-small',
  dimensions: 1536,
};

/**
 * Embedding result
 */
export interface EmbeddingResult {
  /** The embedding vector */
  embedding: number[];
  /** Model used to generate */
  model: string;
  /** Number of tokens in input */
  tokenCount: number;
}

/**
 * Batch embedding request
 */
export interface BatchEmbeddingRequest {
  /** Texts to embed */
  texts: string[];
  /** Optional configuration override */
  config?: Partial<EmbeddingConfig>;
}

/**
 * Batch embedding result
 */
export interface BatchEmbeddingResult {
  /** Embeddings in same order as input texts */
  embeddings: number[][];
  /** Model used */
  model: string;
  /** Total tokens processed */
  totalTokens: number;
}

/**
 * Chunking options for long texts
 */
export interface ChunkingOptions {
  /** Maximum tokens per chunk (default: 512) */
  maxTokens?: number;
  /** Overlap tokens between chunks (default: 50) */
  overlapTokens?: number;
}

/**
 * Chunked text result
 */
export interface TextChunk {
  /** Chunk content */
  content: string;
  /** Chunk index (0-based) */
  index: number;
  /** Estimated token count */
  tokenCount: number;
}
