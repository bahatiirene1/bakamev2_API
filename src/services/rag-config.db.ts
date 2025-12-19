/**
 * RAGConfigService Database Adapter
 * Implements RAGConfigServiceDb interface using Supabase
 *
 * Reference: docs/stage-4-ai-orchestrator.md Section 2.4
 *
 * SCOPE: Admin-configurable RAG settings
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  RAGConfig,
  CreateRAGConfigParams,
  RAGConfigUpdate,
  ListRAGConfigsParams,
  PaginationParams,
  PaginatedResult,
  MemoryCategory,
} from '@/types/index.js';
import { DEFAULT_RAG_CONFIG } from '@/types/index.js';

import type { RAGConfigServiceDb } from './rag-config.service.js';

/**
 * Database row type for rag_configs
 */
interface RAGConfigRow {
  id: string;
  name: string;
  description: string | null;
  memory_token_budget: number;
  knowledge_token_budget: number;
  conversation_token_budget: number;
  memory_limit: number;
  knowledge_limit: number;
  min_similarity: number;
  importance_weight: number;
  similarity_weight: number;
  recency_weight: number;
  embedding_model: string;
  embedding_dimensions: number;
  extraction_enabled: boolean;
  extraction_prompt: string | null;
  memory_categories: string[];
  consolidation_enabled: boolean;
  consolidation_threshold: number;
  is_active: boolean;
  author_id: string;
  created_at: string;
  updated_at: string;
  activated_at: string | null;
}

/**
 * Map database row to RAGConfig entity
 */
function mapRowToConfig(row: RAGConfigRow): RAGConfig {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    memoryTokenBudget: row.memory_token_budget,
    knowledgeTokenBudget: row.knowledge_token_budget,
    conversationTokenBudget: row.conversation_token_budget,
    memoryLimit: row.memory_limit,
    knowledgeLimit: row.knowledge_limit,
    minSimilarity: Number(row.min_similarity),
    importanceWeight: Number(row.importance_weight),
    similarityWeight: Number(row.similarity_weight),
    recencyWeight: Number(row.recency_weight),
    embeddingModel: row.embedding_model,
    embeddingDimensions: row.embedding_dimensions,
    extractionEnabled: row.extraction_enabled,
    extractionPrompt: row.extraction_prompt,
    memoryCategories: row.memory_categories as MemoryCategory[],
    consolidationEnabled: row.consolidation_enabled,
    consolidationThreshold: Number(row.consolidation_threshold),
    isActive: row.is_active,
    authorId: row.author_id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    activatedAt: row.activated_at !== null ? new Date(row.activated_at) : null,
  };
}

/**
 * Create RAGConfigServiceDb instance
 */
export function createRAGConfigServiceDb(
  supabase: SupabaseClient
): RAGConfigServiceDb {
  return {
    async createConfig(
      authorId: string,
      params: CreateRAGConfigParams
    ): Promise<RAGConfig> {
      const { data, error } = await supabase
        .from('rag_configs')
        .insert({
          name: params.name,
          description: params.description ?? null,
          memory_token_budget:
            params.memoryTokenBudget ?? DEFAULT_RAG_CONFIG.memoryTokenBudget,
          knowledge_token_budget:
            params.knowledgeTokenBudget ??
            DEFAULT_RAG_CONFIG.knowledgeTokenBudget,
          conversation_token_budget:
            params.conversationTokenBudget ??
            DEFAULT_RAG_CONFIG.conversationTokenBudget,
          memory_limit: params.memoryLimit ?? DEFAULT_RAG_CONFIG.memoryLimit,
          knowledge_limit:
            params.knowledgeLimit ?? DEFAULT_RAG_CONFIG.knowledgeLimit,
          min_similarity:
            params.minSimilarity ?? DEFAULT_RAG_CONFIG.minSimilarity,
          importance_weight:
            params.importanceWeight ?? DEFAULT_RAG_CONFIG.importanceWeight,
          similarity_weight:
            params.similarityWeight ?? DEFAULT_RAG_CONFIG.similarityWeight,
          recency_weight:
            params.recencyWeight ?? DEFAULT_RAG_CONFIG.recencyWeight,
          embedding_model:
            params.embeddingModel ?? DEFAULT_RAG_CONFIG.embeddingModel,
          embedding_dimensions:
            params.embeddingDimensions ??
            DEFAULT_RAG_CONFIG.embeddingDimensions,
          extraction_enabled:
            params.extractionEnabled ?? DEFAULT_RAG_CONFIG.extractionEnabled,
          extraction_prompt: params.extractionPrompt ?? null,
          memory_categories:
            params.memoryCategories ?? DEFAULT_RAG_CONFIG.memoryCategories,
          consolidation_enabled:
            params.consolidationEnabled ??
            DEFAULT_RAG_CONFIG.consolidationEnabled,
          consolidation_threshold:
            params.consolidationThreshold ??
            DEFAULT_RAG_CONFIG.consolidationThreshold,
          author_id: authorId,
        })
        .select()
        .single();

      if (error !== null) {
        throw new Error(`Failed to create RAG config: ${error.message}`);
      }

      return mapRowToConfig(data as RAGConfigRow);
    },

    async getConfig(configId: string): Promise<RAGConfig | null> {
      const { data, error } = await supabase
        .from('rag_configs')
        .select('*')
        .eq('id', configId)
        .single();

      if (error !== null) {
        if (error.code === 'PGRST116') {
          return null; // Not found
        }
        throw new Error(`Failed to get RAG config: ${error.message}`);
      }

      return mapRowToConfig(data as RAGConfigRow);
    },

    async getActiveConfig(): Promise<RAGConfig | null> {
      const { data, error } = await supabase
        .from('rag_configs')
        .select('*')
        .eq('is_active', true)
        .single();

      if (error !== null) {
        if (error.code === 'PGRST116') {
          return null; // Not found
        }
        throw new Error(`Failed to get active RAG config: ${error.message}`);
      }

      return mapRowToConfig(data as RAGConfigRow);
    },

    async listConfigs(
      params: ListRAGConfigsParams & PaginationParams
    ): Promise<PaginatedResult<RAGConfig>> {
      let query = supabase.from('rag_configs').select('*');

      // Apply filters
      if (params.isActive !== undefined) {
        query = query.eq('is_active', params.isActive);
      }
      if (params.authorId !== undefined) {
        query = query.eq('author_id', params.authorId);
      }

      // Apply cursor-based pagination
      if (params.cursor !== undefined) {
        query = query.lt('created_at', params.cursor);
      }

      // Apply limit and ordering
      const limit = params.limit ?? 20;
      query = query.order('created_at', { ascending: false }).limit(limit + 1); // Fetch one extra to check hasMore

      const { data, error } = await query;

      if (error !== null) {
        throw new Error(`Failed to list RAG configs: ${error.message}`);
      }

      const rows = data as RAGConfigRow[];
      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit).map(mapRowToConfig);

      const result: PaginatedResult<RAGConfig> = {
        items,
        hasMore,
      };

      if (hasMore && items.length > 0) {
        const lastItem = items[items.length - 1];
        if (lastItem !== undefined) {
          result.nextCursor = lastItem.createdAt.toISOString();
        }
      }

      return result;
    },

    async updateConfig(
      configId: string,
      updates: RAGConfigUpdate
    ): Promise<RAGConfig> {
      // Build update object with snake_case keys
      const updateData: Record<string, unknown> = {};

      if (updates.name !== undefined) {
        updateData.name = updates.name;
      }
      if (updates.description !== undefined) {
        updateData.description = updates.description;
      }
      if (updates.memoryTokenBudget !== undefined) {
        updateData.memory_token_budget = updates.memoryTokenBudget;
      }
      if (updates.knowledgeTokenBudget !== undefined) {
        updateData.knowledge_token_budget = updates.knowledgeTokenBudget;
      }
      if (updates.conversationTokenBudget !== undefined) {
        updateData.conversation_token_budget = updates.conversationTokenBudget;
      }
      if (updates.memoryLimit !== undefined) {
        updateData.memory_limit = updates.memoryLimit;
      }
      if (updates.knowledgeLimit !== undefined) {
        updateData.knowledge_limit = updates.knowledgeLimit;
      }
      if (updates.minSimilarity !== undefined) {
        updateData.min_similarity = updates.minSimilarity;
      }
      if (updates.importanceWeight !== undefined) {
        updateData.importance_weight = updates.importanceWeight;
      }
      if (updates.similarityWeight !== undefined) {
        updateData.similarity_weight = updates.similarityWeight;
      }
      if (updates.recencyWeight !== undefined) {
        updateData.recency_weight = updates.recencyWeight;
      }
      if (updates.embeddingModel !== undefined) {
        updateData.embedding_model = updates.embeddingModel;
      }
      if (updates.embeddingDimensions !== undefined) {
        updateData.embedding_dimensions = updates.embeddingDimensions;
      }
      if (updates.extractionEnabled !== undefined) {
        updateData.extraction_enabled = updates.extractionEnabled;
      }
      if (updates.extractionPrompt !== undefined) {
        updateData.extraction_prompt = updates.extractionPrompt;
      }
      if (updates.memoryCategories !== undefined) {
        updateData.memory_categories = updates.memoryCategories;
      }
      if (updates.consolidationEnabled !== undefined) {
        updateData.consolidation_enabled = updates.consolidationEnabled;
      }
      if (updates.consolidationThreshold !== undefined) {
        updateData.consolidation_threshold = updates.consolidationThreshold;
      }

      const { data, error } = await supabase
        .from('rag_configs')
        .update(updateData)
        .eq('id', configId)
        .select()
        .single();

      if (error !== null) {
        throw new Error(`Failed to update RAG config: ${error.message}`);
      }

      return mapRowToConfig(data as RAGConfigRow);
    },

    async activateConfig(configId: string): Promise<RAGConfig> {
      // First deactivate any currently active config
      await supabase
        .from('rag_configs')
        .update({ is_active: false, activated_at: null })
        .eq('is_active', true);

      // Then activate the requested config
      const { data, error } = await supabase
        .from('rag_configs')
        .update({
          is_active: true,
          activated_at: new Date().toISOString(),
        })
        .eq('id', configId)
        .select()
        .single();

      if (error !== null) {
        throw new Error(`Failed to activate RAG config: ${error.message}`);
      }

      return mapRowToConfig(data as RAGConfigRow);
    },

    async deactivateConfig(configId: string): Promise<RAGConfig> {
      const { data, error } = await supabase
        .from('rag_configs')
        .update({
          is_active: false,
          activated_at: null,
        })
        .eq('id', configId)
        .select()
        .single();

      if (error !== null) {
        throw new Error(`Failed to deactivate RAG config: ${error.message}`);
      }

      return mapRowToConfig(data as RAGConfigRow);
    },

    async deleteConfig(configId: string): Promise<void> {
      const { error } = await supabase
        .from('rag_configs')
        .delete()
        .eq('id', configId);

      if (error !== null) {
        throw new Error(`Failed to delete RAG config: ${error.message}`);
      }
    },
  };
}
