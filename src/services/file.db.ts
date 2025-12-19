/**
 * FileService Database Adapter
 * Implements FileServiceDb interface using Supabase
 *
 * Reference: docs/stage-2-service-layer.md Section 3.9
 * Reference: docs/stage-1-database-governance.md Section 2.7
 *
 * SCOPE: File upload and management (storage + metadata only)
 * NOT IN SCOPE: Orchestration, tools, content processing
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  File,
  FileStatus,
  ListFilesParams,
  StorageUsage,
  PaginatedResult,
} from '@/types/index.js';

import type { FileServiceDb } from './file.service.js';

/**
 * Database row types
 */
interface FileRow {
  id: string;
  user_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * Map database row to File entity
 */
function mapRowToFile(row: FileRow): File {
  return {
    id: row.id,
    userId: row.user_id,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    storagePath: row.storage_path,
    status: row.status as FileStatus,
    metadata: row.metadata,
    createdAt: new Date(row.created_at),
    deletedAt: row.deleted_at !== null ? new Date(row.deleted_at) : null,
  };
}

/**
 * Create FileServiceDb implementation using Supabase
 */
export function createFileServiceDb(supabase: SupabaseClient): FileServiceDb {
  return {
    /**
     * Create a new file record
     */
    async createFile(params: {
      userId: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
      storagePath: string;
    }): Promise<File> {
      const { data, error } = await supabase
        .from('files')
        .insert({
          user_id: params.userId,
          filename: params.filename,
          mime_type: params.mimeType,
          size_bytes: params.sizeBytes,
          storage_path: params.storagePath,
          status: 'uploading',
          metadata: {},
        })
        .select('*')
        .single();

      if (error !== null) {
        throw new Error(`Failed to create file: ${error.message}`);
      }

      return mapRowToFile(data as FileRow);
    },

    /**
     * Get file by ID
     */
    async getFile(fileId: string): Promise<File | null> {
      const { data, error } = await supabase
        .from('files')
        .select('*')
        .eq('id', fileId)
        .single();

      if (error !== null) {
        if (error.code === 'PGRST116') {
          return null; // Not found
        }
        throw new Error(`Failed to get file: ${error.message}`);
      }

      return mapRowToFile(data as FileRow);
    },

    /**
     * Update file status
     */
    async updateFileStatus(fileId: string, status: string): Promise<File> {
      const updateData: Record<string, unknown> = { status };

      // Set deleted_at if status is deleted
      if (status === 'deleted') {
        updateData.deleted_at = new Date().toISOString();
      }

      const { data, error } = await supabase
        .from('files')
        .update(updateData)
        .eq('id', fileId)
        .select('*')
        .single();

      if (error !== null) {
        throw new Error(`Failed to update file status: ${error.message}`);
      }

      return mapRowToFile(data as FileRow);
    },

    /**
     * List files for a user
     */
    async listFiles(
      userId: string,
      params: ListFilesParams
    ): Promise<PaginatedResult<File>> {
      let query = supabase
        .from('files')
        .select('*', { count: 'exact' })
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      // Filter by status if provided
      if (params.status !== undefined) {
        query = query.eq('status', params.status);
      } else {
        // By default, exclude deleted files
        query = query.neq('status', 'deleted');
      }

      // Apply cursor-based pagination
      if (params.cursor !== undefined) {
        // Cursor is the created_at of the last item
        query = query.lt('created_at', params.cursor);
      }

      // Apply limit
      query = query.limit(params.limit + 1); // Fetch one extra to check hasMore

      const { data, error } = await query;

      if (error !== null) {
        throw new Error(`Failed to list files: ${error.message}`);
      }

      const rows = data as FileRow[];
      const hasMore = rows.length > params.limit;
      const items = rows.slice(0, params.limit).map(mapRowToFile);

      const result: PaginatedResult<File> = {
        items,
        hasMore,
      };

      const lastItem = items[items.length - 1];
      if (hasMore && lastItem !== undefined) {
        result.nextCursor = lastItem.createdAt.toISOString();
      }

      return result;
    },

    /**
     * Get storage usage for a user
     */
    async getStorageUsage(userId: string): Promise<StorageUsage> {
      // Get total size and count of active files
      const { data, error } = await supabase
        .from('files')
        .select('size_bytes')
        .eq('user_id', userId)
        .in('status', ['uploading', 'active']);

      if (error !== null) {
        throw new Error(`Failed to get storage usage: ${error.message}`);
      }

      const rows = data as Array<{ size_bytes: number }>;
      const usedBytes = rows.reduce((sum, row) => sum + row.size_bytes, 0);
      const fileCount = rows.length;

      return {
        usedBytes,
        limitBytes: null, // Limit comes from entitlements, not DB
        fileCount,
      };
    },
  };
}
