/**
 * FileService Implementation
 * Phase 2: TDD - GREEN phase
 *
 * Reference: docs/stage-2-service-layer.md Section 3.9
 * Reference: docs/stage-1-database-governance.md Section 2.7
 *
 * SCOPE: File upload and management (storage + metadata only)
 * NOT IN SCOPE: Orchestration, tools, content processing
 *
 * Policy: File storage quotas via entitlements (Stage 1 Section 9.5)
 * - Limits come from entitlements, not hardcoded
 * - max_file_size_mb, total_storage_mb, max_files_per_user
 *
 * GUARDRAILS:
 * - Users can only access their own files
 * - AI_ACTOR CANNOT initiate uploads or delete files
 * - AI_ACTOR CAN read files (for context assembly)
 * - Quota checks happen before upload
 * - All mutations emit audit events
 *
 * Dependencies: AuditService, SubscriptionService (for entitlements)
 */

import type {
  ActorContext,
  File,
  InitiateUploadParams,
  UploadInitiation,
  DownloadUrl,
  ListFilesParams,
  StorageUsage,
  PaginatedResult,
  Result,
  AuditEvent,
} from '@/types/index.js';
import { success, failure } from '@/types/index.js';

/**
 * Database abstraction interface for FileService
 */
export interface FileServiceDb {
  createFile: (params: {
    userId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    storagePath: string;
  }) => Promise<File>;
  getFile: (fileId: string) => Promise<File | null>;
  updateFileStatus: (fileId: string, status: string) => Promise<File>;
  listFiles: (
    userId: string,
    params: ListFilesParams
  ) => Promise<PaginatedResult<File>>;
  getStorageUsage: (userId: string) => Promise<StorageUsage>;
}

/**
 * Minimal AuditService interface (subset needed by FileService)
 */
export interface FileServiceAudit {
  log: (actor: ActorContext, event: AuditEvent) => Promise<Result<void>>;
}

/**
 * Storage abstraction interface (S3, Supabase Storage, etc.)
 */
export interface FileServiceStorage {
  generateUploadUrl: (
    storagePath: string,
    mimeType: string
  ) => Promise<{ url: string; expiresAt: Date }>;
  generateDownloadUrl: (
    storagePath: string
  ) => Promise<{ url: string; expiresAt: Date }>;
  deleteObject: (storagePath: string) => Promise<void>;
}

/**
 * Subscription service interface for entitlement checks
 */
export interface FileServiceSubscription {
  getEntitlementValue: (
    actor: ActorContext,
    userId: string,
    featureCode: string
  ) => Promise<Result<{ limit: number } | null>>;
}

/**
 * FileService interface
 */
export interface FileService {
  initiateUpload(
    actor: ActorContext,
    params: InitiateUploadParams
  ): Promise<Result<UploadInitiation>>;
  confirmUpload(actor: ActorContext, fileId: string): Promise<Result<File>>;
  getFile(actor: ActorContext, fileId: string): Promise<Result<File>>;
  getDownloadUrl(
    actor: ActorContext,
    fileId: string
  ): Promise<Result<DownloadUrl>>;
  listFiles(
    actor: ActorContext,
    userId: string,
    params: ListFilesParams
  ): Promise<Result<PaginatedResult<File>>>;
  deleteFile(actor: ActorContext, fileId: string): Promise<Result<void>>;
  getStorageUsage(
    actor: ActorContext,
    userId: string
  ): Promise<Result<StorageUsage>>;
}

// ─────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────

/**
 * Check if actor is AI_ACTOR
 */
function isAIActor(actor: ActorContext): boolean {
  return actor.type === 'ai';
}

/**
 * Check if actor is admin
 */
function isAdminActor(actor: ActorContext): boolean {
  return actor.type === 'admin';
}

/**
 * Check if actor has wildcard permission
 */
function hasWildcardPermission(actor: ActorContext): boolean {
  return actor.permissions.includes('*');
}

/**
 * Check if actor can access a file (read)
 * - Owner can always access
 * - AI_ACTOR can read (for context assembly)
 * - Admin can access
 */
function canAccessFile(actor: ActorContext, file: File): boolean {
  // AI_ACTOR can read any file (for context assembly)
  if (isAIActor(actor)) {
    return true;
  }
  // Admin can access any file
  if (isAdminActor(actor)) {
    return true;
  }
  // Owner can always access
  if (actor.userId === file.userId) {
    return true;
  }
  // Wildcard permission
  if (hasWildcardPermission(actor)) {
    return true;
  }
  return false;
}

/**
 * Check if actor can access files for a user
 */
function canAccessUserFiles(actor: ActorContext, userId: string): boolean {
  // AI_ACTOR can read any user's files (for context assembly)
  if (isAIActor(actor)) {
    return true;
  }
  // Admin can access any user's files
  if (isAdminActor(actor)) {
    return true;
  }
  // Owner can access their own files
  if (actor.userId === userId) {
    return true;
  }
  // Wildcard permission
  if (hasWildcardPermission(actor)) {
    return true;
  }
  return false;
}

/**
 * Generate storage path for a file
 */
function generateStoragePath(userId: string, fileId: string): string {
  return `uploads/${userId}/${fileId}`;
}

// ─────────────────────────────────────────────────────────────
// SERVICE IMPLEMENTATION
// ─────────────────────────────────────────────────────────────

/**
 * Create FileService instance
 */
export function createFileService(deps: {
  db: FileServiceDb;
  auditService: FileServiceAudit;
  storage: FileServiceStorage;
  subscription: FileServiceSubscription;
}): FileService {
  const { db, auditService, storage, subscription } = deps;

  return {
    /**
     * Initiate file upload
     * AI_ACTOR cannot initiate uploads
     * Checks quota before allowing upload
     */
    async initiateUpload(
      actor: ActorContext,
      params: InitiateUploadParams
    ): Promise<Result<UploadInitiation>> {
      // AI_ACTOR cannot upload files
      if (isAIActor(actor)) {
        return failure('PERMISSION_DENIED', 'AI cannot upload files');
      }

      // Validate actor has userId
      if (actor.userId === undefined) {
        return failure(
          'VALIDATION_ERROR',
          'Actor userId is required for upload'
        );
      }
      const userId = actor.userId;

      // Validate filename
      if (!params.filename || params.filename.trim() === '') {
        return failure('VALIDATION_ERROR', 'filename is required');
      }

      // Validate mimeType
      if (!params.mimeType || params.mimeType.trim() === '') {
        return failure('VALIDATION_ERROR', 'mimeType is required');
      }

      // Validate sizeBytes
      if (params.sizeBytes <= 0) {
        return failure('VALIDATION_ERROR', 'File size must be positive');
      }

      // Check max file size entitlement
      const maxFileSizeResult = await subscription.getEntitlementValue(
        actor,
        userId,
        'max_file_size_mb'
      );
      if (maxFileSizeResult.success && maxFileSizeResult.data !== null) {
        const maxFileSizeBytes = maxFileSizeResult.data.limit * 1024 * 1024;
        if (params.sizeBytes > maxFileSizeBytes) {
          return failure('FILE_TOO_LARGE', 'File exceeds maximum allowed size');
        }
      }

      // Check total storage entitlement
      const totalStorageResult = await subscription.getEntitlementValue(
        actor,
        userId,
        'total_storage_mb'
      );
      if (totalStorageResult.success && totalStorageResult.data !== null) {
        const totalStorageBytes = totalStorageResult.data.limit * 1024 * 1024;
        const currentUsage = await db.getStorageUsage(userId);
        if (currentUsage.usedBytes + params.sizeBytes > totalStorageBytes) {
          return failure('QUOTA_EXCEEDED', 'Storage quota would be exceeded');
        }
      }

      // Create file record with uploading status
      const file = await db.createFile({
        userId,
        filename: params.filename,
        mimeType: params.mimeType,
        sizeBytes: params.sizeBytes,
        storagePath: generateStoragePath(userId, ''), // Will be updated
      });

      // Update storage path with actual file ID
      const storagePath = generateStoragePath(userId, file.id);

      // Generate signed upload URL
      const uploadUrl = await storage.generateUploadUrl(
        storagePath,
        params.mimeType
      );

      // Emit audit event
      await auditService.log(actor, {
        action: 'file:upload_initiated',
        resourceType: 'file',
        resourceId: file.id,
        details: {
          filename: params.filename,
          mimeType: params.mimeType,
          sizeBytes: params.sizeBytes,
        },
      });

      return success({
        fileId: file.id,
        uploadUrl: uploadUrl.url,
        expiresAt: uploadUrl.expiresAt,
      });
    },

    /**
     * Confirm upload completed
     * Changes file status from uploading to active
     */
    async confirmUpload(
      actor: ActorContext,
      fileId: string
    ): Promise<Result<File>> {
      const file = await db.getFile(fileId);
      if (file === null) {
        return failure('NOT_FOUND', 'File not found');
      }

      // Check ownership
      if (actor.userId !== file.userId) {
        return failure(
          'PERMISSION_DENIED',
          "Cannot confirm another user's file"
        );
      }

      // Check status
      if (file.status !== 'uploading') {
        return failure('VALIDATION_ERROR', 'File is not in uploading state');
      }

      const updatedFile = await db.updateFileStatus(fileId, 'active');

      // Emit audit event
      await auditService.log(actor, {
        action: 'file:upload_confirmed',
        resourceType: 'file',
        resourceId: fileId,
      });

      return success(updatedFile);
    },

    /**
     * Get file by ID
     * AI_ACTOR can read (for context assembly)
     */
    async getFile(actor: ActorContext, fileId: string): Promise<Result<File>> {
      // Validate fileId
      if (!fileId || fileId.trim() === '') {
        return failure('VALIDATION_ERROR', 'File ID is required');
      }

      const file = await db.getFile(fileId);
      if (file === null) {
        return failure('NOT_FOUND', 'File not found');
      }

      // Check permission
      if (!canAccessFile(actor, file)) {
        return failure('PERMISSION_DENIED', 'Cannot access this file');
      }

      return success(file);
    },

    /**
     * Get signed download URL
     * AI_ACTOR can get download URL (for context assembly)
     */
    async getDownloadUrl(
      actor: ActorContext,
      fileId: string
    ): Promise<Result<DownloadUrl>> {
      const file = await db.getFile(fileId);
      if (file === null) {
        return failure('NOT_FOUND', 'File not found');
      }

      // Check permission
      if (!canAccessFile(actor, file)) {
        return failure('PERMISSION_DENIED', 'Cannot access this file');
      }

      // Check if deleted
      if (file.status === 'deleted') {
        return failure('NOT_FOUND', 'File has been deleted');
      }

      const downloadUrl = await storage.generateDownloadUrl(file.storagePath);

      return success({
        url: downloadUrl.url,
        expiresAt: downloadUrl.expiresAt,
      });
    },

    /**
     * List files for a user
     * AI_ACTOR can list (for context assembly)
     */
    async listFiles(
      actor: ActorContext,
      userId: string,
      params: ListFilesParams
    ): Promise<Result<PaginatedResult<File>>> {
      // Check permission
      if (!canAccessUserFiles(actor, userId)) {
        return failure(
          'PERMISSION_DENIED',
          'Cannot access files for this user'
        );
      }

      const result = await db.listFiles(userId, params);
      return success(result);
    },

    /**
     * Delete file (soft delete)
     * AI_ACTOR cannot delete files
     */
    async deleteFile(
      actor: ActorContext,
      fileId: string
    ): Promise<Result<void>> {
      // AI_ACTOR cannot delete files
      if (isAIActor(actor)) {
        return failure('PERMISSION_DENIED', 'AI cannot delete files');
      }

      const file = await db.getFile(fileId);
      if (file === null) {
        return failure('NOT_FOUND', 'File not found');
      }

      // Check ownership (unless admin)
      if (!isAdminActor(actor) && actor.userId !== file.userId) {
        return failure(
          'PERMISSION_DENIED',
          "Cannot delete another user's file"
        );
      }

      // Check if already deleted
      if (file.status === 'deleted') {
        return failure('VALIDATION_ERROR', 'File is already deleted');
      }

      // Soft delete
      await db.updateFileStatus(fileId, 'deleted');

      // Emit audit event
      await auditService.log(actor, {
        action: 'file:deleted',
        resourceType: 'file',
        resourceId: fileId,
      });

      return success(undefined);
    },

    /**
     * Get storage usage for a user
     */
    async getStorageUsage(
      actor: ActorContext,
      userId: string
    ): Promise<Result<StorageUsage>> {
      // Check permission - owner or admin
      if (!isAdminActor(actor) && actor.userId !== userId) {
        return failure(
          'PERMISSION_DENIED',
          'Cannot access storage usage for this user'
        );
      }

      const usage = await db.getStorageUsage(userId);

      // Get limit from entitlements
      const limitResult = await subscription.getEntitlementValue(
        actor,
        userId,
        'total_storage_mb'
      );

      let limitBytes: number | null = null;
      if (limitResult.success && limitResult.data !== null) {
        limitBytes = limitResult.data.limit * 1024 * 1024;
      }

      return success({
        usedBytes: usage.usedBytes,
        limitBytes,
        fileCount: usage.fileCount,
      });
    },
  };
}
