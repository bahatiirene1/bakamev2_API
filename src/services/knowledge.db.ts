/**
 * KnowledgeService Database Adapter
 * Implements KnowledgeServiceDb interface using Supabase
 *
 * Reference: docs/stage-2-service-layer.md Section 3.5
 *
 * SCOPE: RAG knowledge base management with governance
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  KnowledgeItem,
  KnowledgeStatus,
  CreateKnowledgeItemParams,
  KnowledgeItemUpdate,
  ListKnowledgeItemsParams,
  KnowledgeSearchResult,
  KnowledgeVersion,
  SearchKnowledgeParams,
  PaginationParams,
  PaginatedResult,
} from '@/types/index.js';

import type { KnowledgeServiceDb } from './knowledge.service.js';

/**
 * Database row type for knowledge_items
 */
interface KnowledgeItemRow {
  id: string;
  title: string;
  content: string;
  category: string | null;
  status: string;
  author_id: string;
  reviewer_id: string | null;
  published_at: string | null;
  version: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/**
 * Database row type for knowledge_versions
 */
interface KnowledgeVersionRow {
  id: string;
  item_id: string;
  version: number;
  title: string;
  content: string;
  author_id: string;
  created_at: string;
}

/**
 * Map database row to KnowledgeItem entity
 */
function mapRowToItem(row: KnowledgeItemRow): KnowledgeItem {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    category: row.category,
    status: row.status as KnowledgeStatus,
    authorId: row.author_id,
    reviewerId: row.reviewer_id,
    publishedAt: row.published_at !== null ? new Date(row.published_at) : null,
    version: row.version,
    metadata: row.metadata,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Map database row to KnowledgeVersion entity
 */
function mapRowToVersion(row: KnowledgeVersionRow): KnowledgeVersion {
  return {
    version: row.version,
    title: row.title,
    content: row.content,
    authorId: row.author_id,
    createdAt: new Date(row.created_at),
  };
}

/**
 * Create KnowledgeServiceDb instance
 */
export function createKnowledgeServiceDb(
  supabase: SupabaseClient
): KnowledgeServiceDb {
  return {
    async createItem(
      authorId: string,
      params: CreateKnowledgeItemParams
    ): Promise<KnowledgeItem> {
      const { data, error } = await supabase
        .from('knowledge_items')
        .insert({
          title: params.title,
          content: params.content,
          category: params.category ?? null,
          metadata: params.metadata ?? {},
          author_id: authorId,
          status: 'draft',
          version: 1,
        })
        .select()
        .single();

      if (error !== null) {
        throw new Error(`Failed to create knowledge item: ${error.message}`);
      }

      return mapRowToItem(data as KnowledgeItemRow);
    },

    async getItem(itemId: string): Promise<KnowledgeItem | null> {
      const { data, error } = await supabase
        .from('knowledge_items')
        .select()
        .eq('id', itemId)
        .single();

      if (error !== null) {
        if (error.code === 'PGRST116') {
          return null;
        }
        throw new Error(`Failed to get knowledge item: ${error.message}`);
      }

      return mapRowToItem(data as KnowledgeItemRow);
    },

    async listItems(
      params: ListKnowledgeItemsParams & PaginationParams
    ): Promise<PaginatedResult<KnowledgeItem>> {
      let query = supabase.from('knowledge_items').select();

      if (params.status !== undefined) {
        query = query.eq('status', params.status);
      }
      if (params.category !== undefined) {
        query = query.eq('category', params.category);
      }
      if (params.authorId !== undefined) {
        query = query.eq('author_id', params.authorId);
      }

      // Pagination
      const limit = params.limit ?? 20;
      query = query.order('created_at', { ascending: false }).limit(limit + 1);

      if (params.cursor !== undefined) {
        query = query.lt('created_at', params.cursor);
      }

      const { data, error } = await query;

      if (error !== null) {
        throw new Error(`Failed to list knowledge items: ${error.message}`);
      }

      const rows = data as KnowledgeItemRow[];
      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit).map(mapRowToItem);
      const lastItem = items[items.length - 1];

      const result: PaginatedResult<KnowledgeItem> = { items, hasMore };
      if (hasMore && lastItem !== undefined) {
        result.nextCursor = lastItem.createdAt.toISOString();
      }

      return result;
    },

    async updateItem(
      itemId: string,
      updates: KnowledgeItemUpdate
    ): Promise<KnowledgeItem> {
      const updateData: Record<string, unknown> = {};
      if (updates.title !== undefined) {
        updateData.title = updates.title;
      }
      if (updates.content !== undefined) {
        updateData.content = updates.content;
      }
      if (updates.category !== undefined) {
        updateData.category = updates.category;
      }
      if (updates.metadata !== undefined) {
        updateData.metadata = updates.metadata;
      }

      // Increment version on content change
      if (updates.content !== undefined) {
        const { data: currentData } = await supabase
          .from('knowledge_items')
          .select('version')
          .eq('id', itemId)
          .single();

        if (currentData !== null) {
          updateData.version = (currentData as { version: number }).version + 1;
        }
      }

      const { data, error } = await supabase
        .from('knowledge_items')
        .update(updateData)
        .eq('id', itemId)
        .select()
        .single();

      if (error !== null) {
        throw new Error(`Failed to update knowledge item: ${error.message}`);
      }

      return mapRowToItem(data as KnowledgeItemRow);
    },

    async updateItemStatus(
      itemId: string,
      status: KnowledgeItem['status'],
      reviewerId?: string | null
    ): Promise<KnowledgeItem> {
      const updateData: Record<string, unknown> = { status };

      if (reviewerId !== undefined) {
        updateData.reviewer_id = reviewerId;
      }

      const { data, error } = await supabase
        .from('knowledge_items')
        .update(updateData)
        .eq('id', itemId)
        .select()
        .single();

      if (error !== null) {
        throw new Error(
          `Failed to update knowledge item status: ${error.message}`
        );
      }

      return mapRowToItem(data as KnowledgeItemRow);
    },

    async publishItem(itemId: string): Promise<KnowledgeItem> {
      const { data, error } = await supabase
        .from('knowledge_items')
        .update({
          status: 'published',
          published_at: new Date().toISOString(),
        })
        .eq('id', itemId)
        .select()
        .single();

      if (error !== null) {
        throw new Error(`Failed to publish knowledge item: ${error.message}`);
      }

      return mapRowToItem(data as KnowledgeItemRow);
    },

    async createVersion(
      itemId: string,
      version: Omit<KnowledgeVersion, 'createdAt'>
    ): Promise<KnowledgeVersion> {
      const { data, error } = await supabase
        .from('knowledge_versions')
        .insert({
          item_id: itemId,
          version: version.version,
          title: version.title,
          content: version.content,
          author_id: version.authorId,
        })
        .select()
        .single();

      if (error !== null) {
        throw new Error(`Failed to create knowledge version: ${error.message}`);
      }

      return mapRowToVersion(data as KnowledgeVersionRow);
    },

    async getVersionHistory(itemId: string): Promise<KnowledgeVersion[]> {
      const { data, error } = await supabase
        .from('knowledge_versions')
        .select()
        .eq('item_id', itemId)
        .order('version', { ascending: false });

      if (error !== null) {
        throw new Error(`Failed to get version history: ${error.message}`);
      }

      return (data as KnowledgeVersionRow[]).map(mapRowToVersion);
    },

    async searchItems(
      params: SearchKnowledgeParams
    ): Promise<KnowledgeSearchResult[]> {
      // Note: Full vector search implementation requires pgvector extension
      // This is a simplified text search fallback
      let query = supabase
        .from('knowledge_items')
        .select()
        .eq('status', 'published')
        .ilike('content', `%${params.query}%`);

      if (params.categories !== undefined && params.categories.length > 0) {
        query = query.in('category', params.categories);
      }

      const limit = params.limit ?? 10;
      query = query.limit(limit);

      const { data, error } = await query;

      if (error !== null) {
        throw new Error(`Failed to search knowledge items: ${error.message}`);
      }

      // Return results with simulated similarity scores
      // In production, this would use vector similarity from pgvector
      return (data as KnowledgeItemRow[]).map((row, index) => ({
        item: mapRowToItem(row),
        chunk: row.content.substring(0, 200),
        chunkIndex: 0,
        similarity: 1 - index * 0.1, // Placeholder similarity
      }));
    },
  };
}
