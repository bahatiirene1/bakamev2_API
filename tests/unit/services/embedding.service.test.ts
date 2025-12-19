/**
 * EmbeddingService Unit Tests
 * Phase 5: RAG system - TDD RED phase
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  createEmbeddingService,
  type EmbeddingService,
  type EmbeddingServiceClient,
} from '@/services/embedding.service.js';
import type { EmbeddingConfig } from '@/types/embedding.js';

// ─────────────────────────────────────────────────────────────
// MOCK FACTORIES
// ─────────────────────────────────────────────────────────────

function createMockClient(): EmbeddingServiceClient {
  return {
    createEmbedding: vi.fn(),
    createBatchEmbeddings: vi.fn(),
  };
}

function createMockEmbedding(dimensions: number = 1536): number[] {
  return Array.from({ length: dimensions }, () => Math.random() * 2 - 1);
}

// ─────────────────────────────────────────────────────────────
// TEST SUITES
// ─────────────────────────────────────────────────────────────

describe('EmbeddingService', () => {
  let service: EmbeddingService;
  let mockClient: EmbeddingServiceClient;

  beforeEach(() => {
    mockClient = createMockClient();
    service = createEmbeddingService({ client: mockClient });
  });

  describe('generateEmbedding', () => {
    it('should generate embedding for text', async () => {
      const embedding = createMockEmbedding();
      vi.mocked(mockClient.createEmbedding).mockResolvedValue({
        embedding,
        model: 'text-embedding-3-small',
        tokenCount: 10,
      });

      const result = await service.generateEmbedding('Hello world');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.embedding).toEqual(embedding);
        expect(result.data.model).toBe('text-embedding-3-small');
        expect(result.data.tokenCount).toBe(10);
      }
    });

    it('should use custom config when provided', async () => {
      const config: EmbeddingConfig = {
        model: 'text-embedding-3-large',
        dimensions: 3072,
      };
      const embedding = createMockEmbedding(3072);
      vi.mocked(mockClient.createEmbedding).mockResolvedValue({
        embedding,
        model: 'text-embedding-3-large',
        tokenCount: 15,
      });

      const result = await service.generateEmbedding('Test text', config);

      expect(result.success).toBe(true);
      expect(mockClient.createEmbedding).toHaveBeenCalledWith(
        'Test text',
        config
      );
    });

    it('should fail for empty text', async () => {
      const result = await service.generateEmbedding('');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toContain('empty');
      }
    });

    it('should fail for whitespace-only text', async () => {
      const result = await service.generateEmbedding('   \n\t   ');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should handle API errors gracefully', async () => {
      vi.mocked(mockClient.createEmbedding).mockRejectedValue(
        new Error('API rate limit exceeded')
      );

      const result = await service.generateEmbedding('Test');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Failed to generate embedding');
      }
    });
  });

  describe('generateBatchEmbeddings', () => {
    it('should generate embeddings for multiple texts', async () => {
      const embeddings = [createMockEmbedding(), createMockEmbedding()];
      vi.mocked(mockClient.createBatchEmbeddings).mockResolvedValue({
        embeddings,
        model: 'text-embedding-3-small',
        totalTokens: 25,
      });

      const result = await service.generateBatchEmbeddings(['Hello', 'World']);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.embeddings).toHaveLength(2);
        expect(result.data.totalTokens).toBe(25);
      }
    });

    it('should fail for empty batch', async () => {
      const result = await service.generateBatchEmbeddings([]);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toContain('empty');
      }
    });

    it('should filter out empty strings from batch', async () => {
      const embedding = createMockEmbedding();
      vi.mocked(mockClient.createBatchEmbeddings).mockResolvedValue({
        embeddings: [embedding],
        model: 'text-embedding-3-small',
        totalTokens: 5,
      });

      const result = await service.generateBatchEmbeddings(['Hello', '', '  ']);

      expect(result.success).toBe(true);
      expect(mockClient.createBatchEmbeddings).toHaveBeenCalledWith(['Hello'], {
        model: 'text-embedding-3-small',
        dimensions: 1536,
      });
    });

    it('should fail if all texts are empty after filtering', async () => {
      const result = await service.generateBatchEmbeddings(['', '  ', '\n']);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should handle API errors gracefully', async () => {
      vi.mocked(mockClient.createBatchEmbeddings).mockRejectedValue(
        new Error('Network error')
      );

      const result = await service.generateBatchEmbeddings(['Test1', 'Test2']);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });

  describe('chunkText', () => {
    it('should return single chunk for short text', () => {
      const result = service.chunkText('Hello world');

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Hello world');
      expect(result[0].index).toBe(0);
    });

    it('should split long text into chunks', () => {
      // Create text with sentences longer than maxTokens
      // Each sentence is ~25 chars = ~6 tokens, 50 sentences = ~300 tokens
      const longText = 'This is a test sentence. '.repeat(50);

      const result = service.chunkText(longText, { maxTokens: 50 });

      expect(result.length).toBeGreaterThan(1);
      expect(result[0].index).toBe(0);
      expect(result[1].index).toBe(1);
    });

    it('should respect maxTokens option', () => {
      const text = 'This is a test sentence. '.repeat(50);

      const result = service.chunkText(text, { maxTokens: 50 });

      // Each chunk should be roughly 50 tokens
      for (const chunk of result) {
        expect(chunk.tokenCount).toBeLessThanOrEqual(60); // Allow some margin
      }
    });

    it('should include overlap between chunks', () => {
      const sentences = Array.from(
        { length: 20 },
        (_, i) => `Sentence ${i + 1}.`
      );
      const text = sentences.join(' ');

      const result = service.chunkText(text, {
        maxTokens: 50,
        overlapTokens: 10,
      });

      if (result.length > 1) {
        // Check that consecutive chunks have overlapping content
        const chunk1End = result[0].content.slice(-50);
        const chunk2Start = result[1].content.slice(0, 50);
        // Due to overlap, there should be some shared words
        const chunk1Words = new Set(chunk1End.split(/\s+/));
        const chunk2Words = chunk2Start.split(/\s+/);
        const hasOverlap = chunk2Words.some((w) => chunk1Words.has(w));
        expect(hasOverlap).toBe(true);
      }
    });

    it('should return empty array for empty text', () => {
      const result = service.chunkText('');

      expect(result).toHaveLength(0);
    });

    it('should handle whitespace-only text', () => {
      const result = service.chunkText('   \n\t   ');

      expect(result).toHaveLength(0);
    });
  });

  describe('estimateTokens', () => {
    it('should estimate tokens for text', () => {
      const count = service.estimateTokens('Hello world, this is a test.');

      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThan(20); // Roughly 7-8 tokens
    });

    it('should return 0 for empty text', () => {
      const count = service.estimateTokens('');

      expect(count).toBe(0);
    });

    it('should scale with text length', () => {
      const short = service.estimateTokens('Hello');
      const long = service.estimateTokens(
        'Hello world, this is a much longer sentence.'
      );

      expect(long).toBeGreaterThan(short);
    });
  });
});

describe('EmbeddingService Integration', () => {
  describe('embedAndChunk', () => {
    it('should chunk and embed long content', async () => {
      const mockClient = createMockClient();
      const service = createEmbeddingService({ client: mockClient });

      const longText = 'This is a test paragraph. '.repeat(100);

      // First chunk to know how many embeddings we need
      const chunks = service.chunkText(longText, { maxTokens: 100 });
      const embeddings = Array.from({ length: chunks.length }, () =>
        createMockEmbedding()
      );

      vi.mocked(mockClient.createBatchEmbeddings).mockResolvedValue({
        embeddings,
        model: 'text-embedding-3-small',
        totalTokens: 500,
      });

      const result = await service.embedAndChunk(longText, { maxTokens: 100 });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.chunks.length).toBeGreaterThan(1);
        expect(result.data.embeddings.length).toBe(result.data.chunks.length);
      }
    });

    it('should return single chunk for short content', async () => {
      const mockClient = createMockClient();
      const service = createEmbeddingService({ client: mockClient });

      const shortText = 'Hello world';
      const embedding = createMockEmbedding();

      vi.mocked(mockClient.createBatchEmbeddings).mockResolvedValue({
        embeddings: [embedding],
        model: 'text-embedding-3-small',
        totalTokens: 3,
      });

      const result = await service.embedAndChunk(shortText);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.chunks).toHaveLength(1);
        expect(result.data.embeddings).toHaveLength(1);
      }
    });
  });
});
