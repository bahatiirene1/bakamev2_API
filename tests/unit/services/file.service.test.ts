/**
 * FileService Unit Tests
 * Phase 2: TDD - RED phase
 *
 * Reference: docs/stage-2-service-layer.md Section 3.9
 * Reference: docs/stage-1-database-governance.md Section 2.7
 *
 * SCOPE: File upload and management
 *
 * Policy: File storage quotas via entitlements (Stage 1 Section 9.5)
 * - Limits come from entitlements, not hardcoded
 * - max_file_size_mb, total_storage_mb, max_files_per_user
 *
 * GUARDRAILS:
 * - Users can only access their own files
 * - AI_ACTOR CANNOT initiate uploads or delete files
 * - Quota checks happen before upload
 * - All mutations emit audit events
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import type {
  FileService,
  FileServiceDb,
  FileServiceAudit,
  FileServiceStorage,
  FileServiceSubscription,
} from '@/services/file.service.js';
import { createFileService } from '@/services/file.service.js';
import type {
  ActorContext,
  File,
  PaginatedResult,
  StorageUsage,
} from '@/types/index.js';
import { AI_ACTOR, SYSTEM_ACTOR } from '@/types/index.js';

// ─────────────────────────────────────────────────────────────
// TEST FIXTURES
// ─────────────────────────────────────────────────────────────

const TEST_USER_ID = 'test-user-123';
const TEST_OTHER_USER_ID = 'test-other-user-456';
const TEST_FILE_ID = 'test-file-789';
const TEST_REQUEST_ID = 'test-request-xyz';

const mockFile: File = {
  id: TEST_FILE_ID,
  userId: TEST_USER_ID,
  filename: 'document.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 1024 * 1024, // 1 MB
  storagePath: `uploads/${TEST_USER_ID}/${TEST_FILE_ID}`,
  status: 'active',
  metadata: {},
  createdAt: new Date('2024-01-01'),
  deletedAt: null,
};

const mockUploadingFile: File = {
  ...mockFile,
  status: 'uploading',
};

function createTestActor(overrides?: Partial<ActorContext>): ActorContext {
  return {
    type: 'user',
    userId: TEST_USER_ID,
    requestId: TEST_REQUEST_ID,
    permissions: ['file:read', 'file:write'],
    ...overrides,
  };
}

function createAdminActor(overrides?: Partial<ActorContext>): ActorContext {
  return {
    type: 'admin',
    userId: 'admin-user-id',
    requestId: TEST_REQUEST_ID,
    permissions: ['file:read', 'file:write', 'file:manage'],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────
// MOCK SETUP
// ─────────────────────────────────────────────────────────────

function createMockDb(): FileServiceDb {
  return {
    createFile: vi.fn(),
    getFile: vi.fn(),
    updateFileStatus: vi.fn(),
    listFiles: vi.fn(),
    getStorageUsage: vi.fn(),
  };
}

function createMockAuditService(): FileServiceAudit {
  return {
    log: vi.fn().mockResolvedValue({ success: true, data: undefined }),
  };
}

function createMockStorage(): FileServiceStorage {
  return {
    generateUploadUrl: vi.fn(),
    generateDownloadUrl: vi.fn(),
    deleteObject: vi.fn(),
  };
}

function createMockSubscription(): FileServiceSubscription {
  return {
    getEntitlementValue: vi.fn(),
  };
}

// ─────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────

describe('FileService', () => {
  let fileService: FileService;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockAuditService: ReturnType<typeof createMockAuditService>;
  let mockStorage: ReturnType<typeof createMockStorage>;
  let mockSubscription: ReturnType<typeof createMockSubscription>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockAuditService = createMockAuditService();
    mockStorage = createMockStorage();
    mockSubscription = createMockSubscription();
    fileService = createFileService({
      db: mockDb,
      auditService: mockAuditService,
      storage: mockStorage,
      subscription: mockSubscription,
    });

    // Default entitlement values (generous limits)
    mockSubscription.getEntitlementValue.mockResolvedValue({
      success: true,
      data: { limit: 100 * 1024 * 1024 }, // 100 MB
    });
  });

  // ─────────────────────────────────────────────────────────────
  // initiateUpload
  // ─────────────────────────────────────────────────────────────

  describe('initiateUpload', () => {
    it('should initiate file upload for the user', async () => {
      const actor = createTestActor();
      mockDb.getStorageUsage.mockResolvedValue({
        usedBytes: 0,
        limitBytes: 100 * 1024 * 1024,
        fileCount: 0,
      });
      mockDb.createFile.mockResolvedValue(mockUploadingFile);
      mockStorage.generateUploadUrl.mockResolvedValue({
        url: 'https://storage.example.com/upload/signed-url',
        expiresAt: new Date('2024-01-01T01:00:00Z'),
      });

      const result = await fileService.initiateUpload(actor, {
        filename: 'document.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024 * 1024,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.fileId).toBe(TEST_FILE_ID);
        expect(result.data.uploadUrl).toContain('signed-url');
        expect(result.data.expiresAt).toBeInstanceOf(Date);
      }
    });

    it('should check file size against max_file_size_mb entitlement', async () => {
      const actor = createTestActor();
      // Set max file size to 1 MB
      mockSubscription.getEntitlementValue.mockImplementation(
        async (_actor, _userId, featureCode) => {
          if (featureCode === 'max_file_size_mb') {
            return { success: true, data: { limit: 1 } }; // 1 MB limit
          }
          return { success: true, data: { limit: 100 * 1024 * 1024 } };
        }
      );

      const result = await fileService.initiateUpload(actor, {
        filename: 'large.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2 * 1024 * 1024, // 2 MB - exceeds limit
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('FILE_TOO_LARGE');
      }
    });

    it('should check total storage against total_storage_mb entitlement', async () => {
      const actor = createTestActor();
      mockDb.getStorageUsage.mockResolvedValue({
        usedBytes: 99 * 1024 * 1024, // 99 MB used
        limitBytes: 100 * 1024 * 1024, // 100 MB limit
        fileCount: 50,
      });
      mockSubscription.getEntitlementValue.mockImplementation(
        async (_actor, _userId, featureCode) => {
          if (featureCode === 'total_storage_mb') {
            return { success: true, data: { limit: 100 } }; // 100 MB limit
          }
          if (featureCode === 'max_file_size_mb') {
            return { success: true, data: { limit: 50 } }; // 50 MB per file
          }
          return { success: true, data: null };
        }
      );

      const result = await fileService.initiateUpload(actor, {
        filename: 'document.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 5 * 1024 * 1024, // 5 MB - would exceed storage limit
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('QUOTA_EXCEEDED');
      }
    });

    it('should deny AI_ACTOR from initiating uploads', async () => {
      const result = await fileService.initiateUpload(AI_ACTOR, {
        filename: 'document.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024 * 1024,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
        expect(result.error.message).toContain('AI cannot upload files');
      }
    });

    it('should validate filename is not empty', async () => {
      const actor = createTestActor();

      const result = await fileService.initiateUpload(actor, {
        filename: '',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toContain('filename');
      }
    });

    it('should validate mimeType is not empty', async () => {
      const actor = createTestActor();

      const result = await fileService.initiateUpload(actor, {
        filename: 'document.pdf',
        mimeType: '',
        sizeBytes: 1024,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toContain('mimeType');
      }
    });

    it('should validate sizeBytes is positive', async () => {
      const actor = createTestActor();

      const result = await fileService.initiateUpload(actor, {
        filename: 'document.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 0,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toContain('size');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // confirmUpload
  // ─────────────────────────────────────────────────────────────

  describe('confirmUpload', () => {
    it('should confirm upload and change status to active', async () => {
      const actor = createTestActor();
      mockDb.getFile.mockResolvedValue(mockUploadingFile);
      mockDb.updateFileStatus.mockResolvedValue(mockFile);

      const result = await fileService.confirmUpload(actor, TEST_FILE_ID);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('active');
      }
      expect(mockDb.updateFileStatus).toHaveBeenCalledWith(
        TEST_FILE_ID,
        'active'
      );
    });

    it('should return NOT_FOUND for non-existent file', async () => {
      const actor = createTestActor();
      mockDb.getFile.mockResolvedValue(null);

      const result = await fileService.confirmUpload(actor, 'non-existent-id');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should deny confirming another user file', async () => {
      const actor = createTestActor();
      const otherUserFile = {
        ...mockUploadingFile,
        userId: TEST_OTHER_USER_ID,
      };
      mockDb.getFile.mockResolvedValue(otherUserFile);

      const result = await fileService.confirmUpload(actor, TEST_FILE_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should return error if file is not in uploading status', async () => {
      const actor = createTestActor();
      mockDb.getFile.mockResolvedValue(mockFile); // already active

      const result = await fileService.confirmUpload(actor, TEST_FILE_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toContain('not in uploading state');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // getFile
  // ─────────────────────────────────────────────────────────────

  describe('getFile', () => {
    it('should get file by ID', async () => {
      const actor = createTestActor();
      mockDb.getFile.mockResolvedValue(mockFile);

      const result = await fileService.getFile(actor, TEST_FILE_ID);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(TEST_FILE_ID);
        expect(result.data.filename).toBe('document.pdf');
      }
    });

    it('should return NOT_FOUND for non-existent file', async () => {
      const actor = createTestActor();
      mockDb.getFile.mockResolvedValue(null);

      const result = await fileService.getFile(actor, 'non-existent-id');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should deny access to another user file', async () => {
      const actor = createTestActor();
      const otherUserFile = { ...mockFile, userId: TEST_OTHER_USER_ID };
      mockDb.getFile.mockResolvedValue(otherUserFile);

      const result = await fileService.getFile(actor, TEST_FILE_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow AI_ACTOR to read files (for context assembly)', async () => {
      mockDb.getFile.mockResolvedValue(mockFile);

      const result = await fileService.getFile(AI_ACTOR, TEST_FILE_ID);

      expect(result.success).toBe(true);
    });

    it('should validate file ID is not empty', async () => {
      const actor = createTestActor();

      const result = await fileService.getFile(actor, '');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // getDownloadUrl
  // ─────────────────────────────────────────────────────────────

  describe('getDownloadUrl', () => {
    it('should get signed download URL', async () => {
      const actor = createTestActor();
      mockDb.getFile.mockResolvedValue(mockFile);
      mockStorage.generateDownloadUrl.mockResolvedValue({
        url: 'https://storage.example.com/download/signed-url',
        expiresAt: new Date('2024-01-01T01:00:00Z'),
      });

      const result = await fileService.getDownloadUrl(actor, TEST_FILE_ID);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.url).toContain('signed-url');
        expect(result.data.expiresAt).toBeInstanceOf(Date);
      }
    });

    it('should return NOT_FOUND for non-existent file', async () => {
      const actor = createTestActor();
      mockDb.getFile.mockResolvedValue(null);

      const result = await fileService.getDownloadUrl(actor, 'non-existent-id');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should deny download of another user file', async () => {
      const actor = createTestActor();
      const otherUserFile = { ...mockFile, userId: TEST_OTHER_USER_ID };
      mockDb.getFile.mockResolvedValue(otherUserFile);

      const result = await fileService.getDownloadUrl(actor, TEST_FILE_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should return error for deleted files', async () => {
      const actor = createTestActor();
      const deletedFile = { ...mockFile, status: 'deleted' as const };
      mockDb.getFile.mockResolvedValue(deletedFile);

      const result = await fileService.getDownloadUrl(actor, TEST_FILE_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
        expect(result.error.message).toContain('deleted');
      }
    });

    it('should allow AI_ACTOR to get download URL (for context assembly)', async () => {
      mockDb.getFile.mockResolvedValue(mockFile);
      mockStorage.generateDownloadUrl.mockResolvedValue({
        url: 'https://storage.example.com/download/signed-url',
        expiresAt: new Date('2024-01-01T01:00:00Z'),
      });

      const result = await fileService.getDownloadUrl(AI_ACTOR, TEST_FILE_ID);

      expect(result.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // listFiles
  // ─────────────────────────────────────────────────────────────

  describe('listFiles', () => {
    const mockPaginatedResult: PaginatedResult<File> = {
      items: [mockFile],
      hasMore: false,
    };

    it('should list files for the user', async () => {
      const actor = createTestActor();
      mockDb.listFiles.mockResolvedValue(mockPaginatedResult);

      const result = await fileService.listFiles(actor, TEST_USER_ID, {
        limit: 20,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.items).toHaveLength(1);
        expect(result.data.items[0].id).toBe(TEST_FILE_ID);
      }
    });

    it('should support cursor-based pagination', async () => {
      const actor = createTestActor();
      mockDb.listFiles.mockResolvedValue({
        items: [mockFile],
        hasMore: true,
        nextCursor: 'next-cursor',
      });

      const result = await fileService.listFiles(actor, TEST_USER_ID, {
        limit: 10,
        cursor: 'some-cursor',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.hasMore).toBe(true);
        expect(result.data.nextCursor).toBe('next-cursor');
      }
    });

    it('should deny listing another user files', async () => {
      const actor = createTestActor();

      const result = await fileService.listFiles(actor, TEST_OTHER_USER_ID, {
        limit: 20,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow AI_ACTOR to list files (for context assembly)', async () => {
      mockDb.listFiles.mockResolvedValue(mockPaginatedResult);

      const result = await fileService.listFiles(AI_ACTOR, TEST_USER_ID, {
        limit: 20,
      });

      expect(result.success).toBe(true);
    });

    it('should filter by status', async () => {
      const actor = createTestActor();
      mockDb.listFiles.mockResolvedValue(mockPaginatedResult);

      await fileService.listFiles(actor, TEST_USER_ID, {
        limit: 20,
        status: 'active',
      });

      expect(mockDb.listFiles).toHaveBeenCalledWith(
        TEST_USER_ID,
        expect.objectContaining({
          status: 'active',
        })
      );
    });
  });

  // ─────────────────────────────────────────────────────────────
  // deleteFile
  // ─────────────────────────────────────────────────────────────

  describe('deleteFile', () => {
    it('should soft delete a file', async () => {
      const actor = createTestActor();
      mockDb.getFile.mockResolvedValue(mockFile);
      mockDb.updateFileStatus.mockResolvedValue({
        ...mockFile,
        status: 'deleted',
      });

      const result = await fileService.deleteFile(actor, TEST_FILE_ID);

      expect(result.success).toBe(true);
      expect(mockDb.updateFileStatus).toHaveBeenCalledWith(
        TEST_FILE_ID,
        'deleted'
      );
    });

    it('should deny AI_ACTOR from deleting files', async () => {
      mockDb.getFile.mockResolvedValue(mockFile);

      const result = await fileService.deleteFile(AI_ACTOR, TEST_FILE_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
        expect(result.error.message).toContain('AI cannot delete files');
      }
    });

    it('should deny deleting another user file', async () => {
      const actor = createTestActor();
      const otherUserFile = { ...mockFile, userId: TEST_OTHER_USER_ID };
      mockDb.getFile.mockResolvedValue(otherUserFile);

      const result = await fileService.deleteFile(actor, TEST_FILE_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should return NOT_FOUND for non-existent file', async () => {
      const actor = createTestActor();
      mockDb.getFile.mockResolvedValue(null);

      const result = await fileService.deleteFile(actor, 'non-existent-id');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should return error if file already deleted', async () => {
      const actor = createTestActor();
      const deletedFile = { ...mockFile, status: 'deleted' as const };
      mockDb.getFile.mockResolvedValue(deletedFile);

      const result = await fileService.deleteFile(actor, TEST_FILE_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toContain('already deleted');
      }
    });

    it('should emit audit event on delete', async () => {
      const actor = createTestActor();
      mockDb.getFile.mockResolvedValue(mockFile);
      mockDb.updateFileStatus.mockResolvedValue({
        ...mockFile,
        status: 'deleted',
      });

      await fileService.deleteFile(actor, TEST_FILE_ID);

      expect(mockAuditService.log).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({
          action: 'file:deleted',
          resourceType: 'file',
          resourceId: TEST_FILE_ID,
        })
      );
    });
  });

  // ─────────────────────────────────────────────────────────────
  // getStorageUsage
  // ─────────────────────────────────────────────────────────────

  describe('getStorageUsage', () => {
    it('should get storage usage for the user', async () => {
      const actor = createTestActor();
      const mockUsage: StorageUsage = {
        usedBytes: 50 * 1024 * 1024, // 50 MB
        limitBytes: 100 * 1024 * 1024, // 100 MB
        fileCount: 25,
      };
      mockDb.getStorageUsage.mockResolvedValue(mockUsage);
      mockSubscription.getEntitlementValue.mockResolvedValue({
        success: true,
        data: { limit: 100 }, // 100 MB
      });

      const result = await fileService.getStorageUsage(actor, TEST_USER_ID);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.usedBytes).toBe(50 * 1024 * 1024);
        expect(result.data.limitBytes).toBe(100 * 1024 * 1024);
        expect(result.data.fileCount).toBe(25);
      }
    });

    it('should deny getting storage usage for another user', async () => {
      const actor = createTestActor();

      const result = await fileService.getStorageUsage(
        actor,
        TEST_OTHER_USER_ID
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should return unlimited if no entitlement set', async () => {
      const actor = createTestActor();
      mockDb.getStorageUsage.mockResolvedValue({
        usedBytes: 50 * 1024 * 1024,
        limitBytes: null,
        fileCount: 25,
      });
      mockSubscription.getEntitlementValue.mockResolvedValue({
        success: true,
        data: null,
      });

      const result = await fileService.getStorageUsage(actor, TEST_USER_ID);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limitBytes).toBeNull();
      }
    });

    it('should allow admin to get any user storage usage', async () => {
      const actor = createAdminActor();
      const mockUsage: StorageUsage = {
        usedBytes: 50 * 1024 * 1024,
        limitBytes: 100 * 1024 * 1024,
        fileCount: 25,
      };
      mockDb.getStorageUsage.mockResolvedValue(mockUsage);
      mockSubscription.getEntitlementValue.mockResolvedValue({
        success: true,
        data: { limit: 100 },
      });

      const result = await fileService.getStorageUsage(
        actor,
        TEST_OTHER_USER_ID
      );

      expect(result.success).toBe(true);
    });
  });
});
