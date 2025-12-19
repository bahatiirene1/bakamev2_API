/**
 * File Domain Types
 * Phase 2: TDD - Type definitions for FileService
 *
 * Reference: docs/stage-2-service-layer.md Section 3.9
 * Reference: docs/stage-1-database-governance.md Section 2.7
 *
 * SCOPE: File upload and management
 *
 * Policy: File storage quotas via entitlements (Stage 1 Section 9.5)
 * - Limits come from entitlements, not hardcoded
 * - max_file_size_mb, total_storage_mb, max_files_per_user
 */

/**
 * File status
 */
export type FileStatus = 'uploading' | 'active' | 'deleted';

/**
 * File entity
 */
export interface File {
  id: string;
  userId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  status: FileStatus;
  metadata: Record<string, unknown>;
  createdAt: Date;
  deletedAt: Date | null;
}

/**
 * Parameters for initiating file upload
 */
export interface InitiateUploadParams {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * Result of initiating file upload
 */
export interface UploadInitiation {
  fileId: string;
  uploadUrl: string;
  expiresAt: Date;
}

/**
 * Result of getting download URL
 */
export interface DownloadUrl {
  url: string;
  expiresAt: Date;
}

/**
 * Parameters for listing files
 */
export interface ListFilesParams {
  cursor?: string;
  limit: number;
  status?: 'active' | 'deleted';
}

/**
 * Storage usage for a user
 */
export interface StorageUsage {
  usedBytes: number;
  limitBytes: number | null; // null = unlimited
  fileCount: number;
}
