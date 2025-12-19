/**
 * PromptService Database Adapter
 * Implements PromptServiceDb interface using Supabase
 *
 * Reference: docs/stage-2-service-layer.md Section 3.6
 *
 * SCOPE: System prompt governance
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  SystemPrompt,
  CreatePromptParams,
  PromptUpdate,
  ListPromptsParams,
  PaginationParams,
  PaginatedResult,
} from '@/types/index.js';

import type { PromptServiceDb, PromptVersion } from './prompt.service.js';

/**
 * Database row type for system_prompts
 */
interface SystemPromptRow {
  id: string;
  name: string;
  description: string | null;
  content: string;
  status: string;
  author_id: string;
  reviewer_id: string | null;
  version: number;
  is_default: boolean;
  activated_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Database row type for prompt_versions
 */
interface PromptVersionRow {
  id: string;
  prompt_id: string;
  version: number;
  name: string;
  content: string;
  author_id: string;
  created_at: string;
}

/**
 * Map database row to SystemPrompt entity
 */
function mapRowToPrompt(row: SystemPromptRow): SystemPrompt {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    content: row.content,
    status: row.status as SystemPrompt['status'],
    authorId: row.author_id,
    reviewerId: row.reviewer_id,
    version: row.version,
    isDefault: row.is_default,
    activatedAt: row.activated_at !== null ? new Date(row.activated_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Map database row to PromptVersion entity
 */
function mapRowToVersion(row: PromptVersionRow): PromptVersion {
  return {
    version: row.version,
    name: row.name,
    content: row.content,
    authorId: row.author_id,
    createdAt: new Date(row.created_at),
  };
}

/**
 * Create PromptServiceDb instance
 */
export function createPromptServiceDb(
  supabase: SupabaseClient
): PromptServiceDb {
  return {
    async createPrompt(
      authorId: string,
      params: CreatePromptParams
    ): Promise<SystemPrompt> {
      const { data, error } = await supabase
        .from('system_prompts')
        .insert({
          name: params.name,
          description: params.description ?? null,
          content: params.content,
          author_id: authorId,
          status: 'draft',
          version: 1,
          is_default: false,
        })
        .select()
        .single();

      if (error !== null) {
        throw new Error(`Failed to create prompt: ${error.message}`);
      }

      return mapRowToPrompt(data as SystemPromptRow);
    },

    async getPrompt(promptId: string): Promise<SystemPrompt | null> {
      const { data, error } = await supabase
        .from('system_prompts')
        .select()
        .eq('id', promptId)
        .single();

      if (error !== null) {
        if (error.code === 'PGRST116') {
          return null;
        }
        throw new Error(`Failed to get prompt: ${error.message}`);
      }

      return mapRowToPrompt(data as SystemPromptRow);
    },

    async getActivePrompt(): Promise<SystemPrompt | null> {
      const { data, error } = await supabase
        .from('system_prompts')
        .select()
        .eq('status', 'active')
        .eq('is_default', true)
        .single();

      if (error !== null) {
        if (error.code === 'PGRST116') {
          return null;
        }
        throw new Error(`Failed to get active prompt: ${error.message}`);
      }

      return mapRowToPrompt(data as SystemPromptRow);
    },

    async listPrompts(
      params: ListPromptsParams & PaginationParams
    ): Promise<PaginatedResult<SystemPrompt>> {
      let query = supabase.from('system_prompts').select();

      if (params.status !== undefined) {
        query = query.eq('status', params.status);
      }

      // Pagination
      const limit = params.limit ?? 20;
      query = query.order('created_at', { ascending: false }).limit(limit + 1);

      if (params.cursor !== undefined) {
        query = query.lt('created_at', params.cursor);
      }

      const { data, error } = await query;

      if (error !== null) {
        throw new Error(`Failed to list prompts: ${error.message}`);
      }

      const rows = data as SystemPromptRow[];
      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit).map(mapRowToPrompt);
      const lastItem = items[items.length - 1];

      const result: PaginatedResult<SystemPrompt> = { items, hasMore };
      if (hasMore && lastItem !== undefined) {
        result.nextCursor = lastItem.createdAt.toISOString();
      }

      return result;
    },

    async updatePrompt(
      promptId: string,
      updates: PromptUpdate
    ): Promise<SystemPrompt> {
      const updateData: Record<string, unknown> = {};
      if (updates.name !== undefined) {
        updateData.name = updates.name;
      }
      if (updates.description !== undefined) {
        updateData.description = updates.description;
      }
      if (updates.content !== undefined) {
        updateData.content = updates.content;
      }

      // Increment version on content change
      if (updates.content !== undefined) {
        const { data: currentData } = await supabase
          .from('system_prompts')
          .select('version')
          .eq('id', promptId)
          .single();

        if (currentData !== null) {
          updateData.version = (currentData as { version: number }).version + 1;
        }
      }

      const { data, error } = await supabase
        .from('system_prompts')
        .update(updateData)
        .eq('id', promptId)
        .select()
        .single();

      if (error !== null) {
        throw new Error(`Failed to update prompt: ${error.message}`);
      }

      return mapRowToPrompt(data as SystemPromptRow);
    },

    async updatePromptStatus(
      promptId: string,
      status: SystemPrompt['status'],
      reviewerId?: string | null
    ): Promise<SystemPrompt> {
      const updateData: Record<string, unknown> = { status };

      if (reviewerId !== undefined) {
        updateData.reviewer_id = reviewerId;
      }

      const { data, error } = await supabase
        .from('system_prompts')
        .update(updateData)
        .eq('id', promptId)
        .select()
        .single();

      if (error !== null) {
        throw new Error(`Failed to update prompt status: ${error.message}`);
      }

      return mapRowToPrompt(data as SystemPromptRow);
    },

    async activatePrompt(promptId: string): Promise<SystemPrompt> {
      // First, deactivate any existing default prompt
      await supabase
        .from('system_prompts')
        .update({ is_default: false })
        .eq('is_default', true);

      // Then activate the new prompt
      const { data, error } = await supabase
        .from('system_prompts')
        .update({
          status: 'active',
          is_default: true,
          activated_at: new Date().toISOString(),
        })
        .eq('id', promptId)
        .select()
        .single();

      if (error !== null) {
        throw new Error(`Failed to activate prompt: ${error.message}`);
      }

      return mapRowToPrompt(data as SystemPromptRow);
    },

    async getPromptVersionHistory(promptId: string): Promise<PromptVersion[]> {
      const { data, error } = await supabase
        .from('prompt_versions')
        .select()
        .eq('prompt_id', promptId)
        .order('version', { ascending: false });

      if (error !== null) {
        throw new Error(`Failed to get version history: ${error.message}`);
      }

      return (data as PromptVersionRow[]).map(mapRowToVersion);
    },

    async createVersion(
      promptId: string,
      version: Omit<PromptVersion, 'createdAt'>
    ): Promise<PromptVersion> {
      const { data, error } = await supabase
        .from('prompt_versions')
        .insert({
          prompt_id: promptId,
          version: version.version,
          name: version.name,
          content: version.content,
          author_id: version.authorId,
        })
        .select()
        .single();

      if (error !== null) {
        throw new Error(`Failed to create prompt version: ${error.message}`);
      }

      return mapRowToVersion(data as PromptVersionRow);
    },
  };
}
