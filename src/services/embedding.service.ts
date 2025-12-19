/**
 * EmbeddingService Implementation
 * Phase 5: RAG system - Vector embedding generation
 *
 * Reference: docs/stage-4-ai-orchestrator.md
 *
 * SCOPE: Generate vector embeddings for text content
 * Uses OpenAI text-embedding-3-small via OpenRouter
 *
 * GUARDRAILS:
 * - Validates input text is not empty
 * - Handles API errors gracefully
 * - Supports batching for efficiency
 * - Provides text chunking for long content
 *
 * AI-AGNOSTIC PRINCIPLE:
 * - This service is injected into DB adapters
 * - Services schedule embedding, don't block on it
 */

import type {
  EmbeddingConfig,
  EmbeddingResult,
  BatchEmbeddingResult,
  ChunkingOptions,
  TextChunk,
} from '@/types/embedding.js';
import { DEFAULT_EMBEDDING_CONFIG } from '@/types/embedding.js';
import type { Result } from '@/types/index.js';
import { success, failure } from '@/types/index.js';

/**
 * Embedding client interface (abstraction over OpenAI/OpenRouter)
 */
export interface EmbeddingServiceClient {
  createEmbedding: (
    text: string,
    config?: EmbeddingConfig
  ) => Promise<EmbeddingResult>;
  createBatchEmbeddings: (
    texts: string[],
    config?: EmbeddingConfig
  ) => Promise<BatchEmbeddingResult>;
}

/**
 * Chunked embedding result
 */
export interface ChunkedEmbeddingResult {
  chunks: TextChunk[];
  embeddings: number[][];
  model: string;
  totalTokens: number;
}

/**
 * EmbeddingService interface
 */
export interface EmbeddingService {
  /** Generate embedding for single text */
  generateEmbedding(
    text: string,
    config?: EmbeddingConfig
  ): Promise<Result<EmbeddingResult>>;

  /** Generate embeddings for multiple texts */
  generateBatchEmbeddings(
    texts: string[],
    config?: EmbeddingConfig
  ): Promise<Result<BatchEmbeddingResult>>;

  /** Chunk text into smaller pieces */
  chunkText(text: string, options?: ChunkingOptions): TextChunk[];

  /** Chunk and embed long content */
  embedAndChunk(
    text: string,
    options?: ChunkingOptions,
    config?: EmbeddingConfig
  ): Promise<Result<ChunkedEmbeddingResult>>;

  /** Estimate token count for text */
  estimateTokens(text: string): number;
}

/**
 * Default chunking options
 */
const DEFAULT_CHUNKING: Required<ChunkingOptions> = {
  maxTokens: 512,
  overlapTokens: 50,
};

/**
 * Approximate tokens per character ratio
 * OpenAI tokenizer averages ~4 chars per token for English
 */
const CHARS_PER_TOKEN = 4;

/**
 * Create EmbeddingService instance
 */
export function createEmbeddingService(deps: {
  client: EmbeddingServiceClient;
}): EmbeddingService {
  const { client } = deps;

  /**
   * Estimate token count for text
   * Uses character-based approximation (~4 chars per token)
   */
  function estimateTokens(text: string): number {
    if (!text) {
      return 0;
    }
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  /**
   * Chunk text into smaller pieces for embedding
   * Uses sentence-aware splitting with overlap
   */
  function chunkText(text: string, options?: ChunkingOptions): TextChunk[] {
    const trimmed = text.trim();
    if (!trimmed) {
      return [];
    }

    const opts = { ...DEFAULT_CHUNKING, ...options };
    const maxChars = opts.maxTokens * CHARS_PER_TOKEN;
    const overlapChars = opts.overlapTokens * CHARS_PER_TOKEN;

    // If text fits in one chunk, return as-is
    if (trimmed.length <= maxChars) {
      return [
        {
          content: trimmed,
          index: 0,
          tokenCount: estimateTokens(trimmed),
        },
      ];
    }

    // Split by sentences for cleaner chunks
    const sentences = trimmed.split(/(?<=[.!?])\s+/);
    const chunks: TextChunk[] = [];

    let currentChunk = '';
    let chunkIndex = 0;

    for (const sentence of sentences) {
      const testChunk = currentChunk ? `${currentChunk} ${sentence}` : sentence;

      if (testChunk.length > maxChars && currentChunk) {
        // Save current chunk
        chunks.push({
          content: currentChunk.trim(),
          index: chunkIndex,
          tokenCount: estimateTokens(currentChunk),
        });
        chunkIndex++;

        // Start new chunk with overlap
        if (overlapChars > 0) {
          const overlapText = currentChunk.slice(-overlapChars);
          currentChunk = overlapText + ' ' + sentence;
        } else {
          currentChunk = sentence;
        }
      } else {
        currentChunk = testChunk;
      }
    }

    // Add final chunk
    if (currentChunk.trim()) {
      chunks.push({
        content: currentChunk.trim(),
        index: chunkIndex,
        tokenCount: estimateTokens(currentChunk),
      });
    }

    return chunks;
  }

  return {
    estimateTokens,
    chunkText,

    async generateEmbedding(
      text: string,
      config?: EmbeddingConfig
    ): Promise<Result<EmbeddingResult>> {
      // Validate input
      const trimmed = text.trim();
      if (!trimmed) {
        return failure('VALIDATION_ERROR', 'Text cannot be empty');
      }

      try {
        const embeddingConfig = config ?? DEFAULT_EMBEDDING_CONFIG;
        const result = await client.createEmbedding(trimmed, embeddingConfig);
        return success(result);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        return failure(
          'INTERNAL_ERROR',
          `Failed to generate embedding: ${message}`
        );
      }
    },

    async generateBatchEmbeddings(
      texts: string[],
      config?: EmbeddingConfig
    ): Promise<Result<BatchEmbeddingResult>> {
      // Filter empty strings
      const validTexts = texts.map((t) => t.trim()).filter((t) => t.length > 0);

      // Validate input
      if (validTexts.length === 0) {
        return failure('VALIDATION_ERROR', 'Texts array cannot be empty');
      }

      try {
        const embeddingConfig = config ?? DEFAULT_EMBEDDING_CONFIG;
        const result = await client.createBatchEmbeddings(
          validTexts,
          embeddingConfig
        );
        return success(result);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        return failure(
          'INTERNAL_ERROR',
          `Failed to generate batch embeddings: ${message}`
        );
      }
    },

    async embedAndChunk(
      text: string,
      options?: ChunkingOptions,
      config?: EmbeddingConfig
    ): Promise<Result<ChunkedEmbeddingResult>> {
      // Chunk the text
      const chunks = chunkText(text, options);
      if (chunks.length === 0) {
        return failure('VALIDATION_ERROR', 'Text cannot be empty');
      }

      // Generate embeddings for all chunks
      const chunkTexts = chunks.map((c) => c.content);
      const embeddingsResult = await this.generateBatchEmbeddings(
        chunkTexts,
        config
      );

      if (!embeddingsResult.success) {
        return failure(
          embeddingsResult.error.code,
          embeddingsResult.error.message
        );
      }

      return success({
        chunks,
        embeddings: embeddingsResult.data.embeddings,
        model: embeddingsResult.data.model,
        totalTokens: embeddingsResult.data.totalTokens,
      });
    },
  };
}

/**
 * Create OpenAI/OpenRouter embedding client
 * This connects to OpenRouter which provides OpenAI-compatible API
 */
export function createOpenRouterEmbeddingClient(
  apiKey: string
): EmbeddingServiceClient {
  const baseUrl = 'https://openrouter.ai/api/v1';

  async function callEmbeddingAPI(
    input: string | string[],
    config: EmbeddingConfig
  ): Promise<{
    data: Array<{ embedding: number[] }>;
    model: string;
    usage: { total_tokens: number };
  }> {
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://bakame.ai',
        'X-Title': 'Bakame AI',
      },
      body: JSON.stringify({
        model: config.model,
        input,
        dimensions: config.dimensions,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Embedding API error: ${response.status} - ${error}`);
    }

    const json = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
      model: string;
      usage: { total_tokens: number };
    };
    return json;
  }

  return {
    async createEmbedding(
      text: string,
      config: EmbeddingConfig = DEFAULT_EMBEDDING_CONFIG
    ): Promise<EmbeddingResult> {
      const result = await callEmbeddingAPI(text, config);
      const firstData = result.data[0];
      if (!firstData) {
        throw new Error('No embedding returned from API');
      }
      return {
        embedding: firstData.embedding,
        model: result.model,
        tokenCount: result.usage.total_tokens,
      };
    },

    async createBatchEmbeddings(
      texts: string[],
      config: EmbeddingConfig = DEFAULT_EMBEDDING_CONFIG
    ): Promise<BatchEmbeddingResult> {
      const result = await callEmbeddingAPI(texts, config);
      return {
        embeddings: result.data.map((d) => d.embedding),
        model: result.model,
        totalTokens: result.usage.total_tokens,
      };
    },
  };
}
