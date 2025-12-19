/**
 * FileService Integration Tests
 * Phase 2: Tests with real Supabase database
 *
 * These tests require:
 * - SUPABASE_URL environment variable
 * - SUPABASE_SERVICE_KEY environment variable
 * - Database with files table
 *
 * Tests are skipped if credentials are not available.
 *
 * SCOPE: File upload and management (storage + metadata only)
 * NOT IN SCOPE: Orchestration, tools, content processing
 *
 * NOTE: Storage operations (signed URLs) are mocked since we're testing
 * the database adapter, not actual file storage.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

import {
  createFileService,
  createFileServiceDb,
  createAuditService,
  createAuditServiceDb,
  createUserService,
  createUserServiceDb,
} from '@/services/index.js';
import type {
  FileService,
  FileServiceStorage,
  FileServiceSubscription,
  AuditService,
  UserService,
} from '@/services/index.js';
import type { ActorContext } from '@/types/index.js';
import { AI_ACTOR } from '@/types/index.js';

// Check if we have database credentials
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const HAS_CREDENTIALS =
  SUPABASE_URL !== undefined &&
  SUPABASE_URL !== '' &&
  SUPABASE_SERVICE_KEY !== undefined &&
  SUPABASE_SERVICE_KEY !== '';

// Test fixtures - use nanoid for unique test identifiers
const TEST_PREFIX = `file_test_${nanoid(6)}`;

// Helper to create unique test IDs
function testId(prefix: string): string {
  return `${TEST_PREFIX}_${prefix}_${nanoid(6)}`;
}

// Helper to create test actor
function createTestActor(
  userId: string,
  overrides?: Partial<ActorContext>
): ActorContext {
  return {
    type: 'user',
    userId,
    requestId: testId('req'),
    permissions: ['file:read', 'file:write'],
    ...overrides,
  };
}

// Helper to create admin actor
function createAdminActor(overrides?: Partial<ActorContext>): ActorContext {
  return {
    type: 'admin',
    userId: testId('admin'),
    requestId: testId('req'),
    permissions: ['file:read', 'file:write', 'file:manage'],
    ...overrides,
  };
}

// Mock storage service (we're testing DB integration, not actual storage)
function createMockStorage(): FileServiceStorage {
  return {
    generateUploadUrl: vi.fn().mockResolvedValue({
      url: 'https://storage.example.com/upload/mock-signed-url',
      expiresAt: new Date(Date.now() + 3600000), // 1 hour
    }),
    generateDownloadUrl: vi.fn().mockResolvedValue({
      url: 'https://storage.example.com/download/mock-signed-url',
      expiresAt: new Date(Date.now() + 3600000), // 1 hour
    }),
    deleteObject: vi.fn().mockResolvedValue(undefined),
  };
}

// Mock subscription service (returns generous limits)
function createMockSubscription(): FileServiceSubscription {
  return {
    getEntitlementValue: vi.fn().mockResolvedValue({
      success: true,
      data: { limit: 1000 }, // 1000 MB
    }),
  };
}

describe.skipIf(!HAS_CREDENTIALS)('FileService Integration', () => {
  let supabase: SupabaseClient;
  let fileService: FileService;
  let auditService: AuditService;
  let userService: UserService;
  let mockStorage: FileServiceStorage;
  let mockSubscription: FileServiceSubscription;

  // Track created resources for cleanup
  const createdUserIds: string[] = [];
  const createdFileIds: string[] = [];

  beforeAll(async () => {
    // Create Supabase client with service key (bypasses RLS)
    supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);

    // Create database adapters and services
    const auditDb = createAuditServiceDb(supabase);
    auditService = createAuditService({ db: auditDb });

    const userDb = createUserServiceDb(supabase);
    userService = createUserService({ db: userDb, auditService });

    const fileDb = createFileServiceDb(supabase);
    mockStorage = createMockStorage();
    mockSubscription = createMockSubscription();

    fileService = createFileService({
      db: fileDb,
      auditService,
      storage: mockStorage,
      subscription: mockSubscription,
    });
  });

  afterAll(async () => {
    // Cleanup in reverse order (files first, then users)

    // Delete files
    if (createdFileIds.length > 0) {
      await supabase.from('files').delete().in('id', createdFileIds);
    }

    // Delete test users
    if (createdUserIds.length > 0) {
      await supabase.from('users').delete().in('id', createdUserIds);
    }
  });

  // Helper to create a test user
  async function createTestUser(): Promise<string> {
    const userId = testId('user');
    const email = `${userId}@test.example.com`;
    await userService.onUserSignup(
      { type: 'system', requestId: testId('req'), permissions: ['*'] },
      {
        authUserId: userId,
        email,
      }
    );
    createdUserIds.push(userId);
    return userId;
  }

  // ─────────────────────────────────────────────────────────────
  // CRUD Operations
  // ─────────────────────────────────────────────────────────────

  describe('File CRUD Operations', () => {
    it('should initiate upload and create file record', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      const result = await fileService.initiateUpload(actor, {
        filename: 'test-document.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024 * 1024, // 1 MB
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.fileId).toBeDefined();
        expect(result.data.uploadUrl).toContain('mock-signed-url');
        expect(result.data.expiresAt).toBeInstanceOf(Date);
        createdFileIds.push(result.data.fileId);
      }
    });

    it('should confirm upload and activate file', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      // Initiate upload
      const initResult = await fileService.initiateUpload(actor, {
        filename: 'confirm-test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
      });

      expect(initResult.success).toBe(true);
      if (!initResult.success) {
        return;
      }
      createdFileIds.push(initResult.data.fileId);

      // Confirm upload
      const confirmResult = await fileService.confirmUpload(
        actor,
        initResult.data.fileId
      );

      expect(confirmResult.success).toBe(true);
      if (confirmResult.success) {
        expect(confirmResult.data.status).toBe('active');
        expect(confirmResult.data.filename).toBe('confirm-test.pdf');
      }
    });

    it('should get file by ID', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      // Create and confirm file
      const initResult = await fileService.initiateUpload(actor, {
        filename: 'get-test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 4096,
      });

      expect(initResult.success).toBe(true);
      if (!initResult.success) {
        return;
      }
      createdFileIds.push(initResult.data.fileId);

      await fileService.confirmUpload(actor, initResult.data.fileId);

      // Get file
      const getResult = await fileService.getFile(
        actor,
        initResult.data.fileId
      );

      expect(getResult.success).toBe(true);
      if (getResult.success) {
        expect(getResult.data.id).toBe(initResult.data.fileId);
        expect(getResult.data.filename).toBe('get-test.pdf');
        expect(getResult.data.status).toBe('active');
      }
    });

    it('should list files for user', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      // Create multiple files
      for (let i = 0; i < 3; i++) {
        const result = await fileService.initiateUpload(actor, {
          filename: `list-test-${i}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: 1000 + i,
        });
        if (result.success) {
          createdFileIds.push(result.data.fileId);
          await fileService.confirmUpload(actor, result.data.fileId);
        }
      }

      // List files
      const listResult = await fileService.listFiles(actor, userId, {
        limit: 10,
      });

      expect(listResult.success).toBe(true);
      if (listResult.success) {
        expect(listResult.data.items.length).toBeGreaterThanOrEqual(3);
        expect(listResult.data.items[0].userId).toBe(userId);
      }
    });

    it('should soft delete file', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      // Create and confirm file
      const initResult = await fileService.initiateUpload(actor, {
        filename: 'delete-test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 8192,
      });

      expect(initResult.success).toBe(true);
      if (!initResult.success) {
        return;
      }
      createdFileIds.push(initResult.data.fileId);

      await fileService.confirmUpload(actor, initResult.data.fileId);

      // Delete file
      const deleteResult = await fileService.deleteFile(
        actor,
        initResult.data.fileId
      );

      expect(deleteResult.success).toBe(true);

      // Verify file is marked as deleted
      const getResult = await fileService.getFile(
        actor,
        initResult.data.fileId
      );
      expect(getResult.success).toBe(true);
      if (getResult.success) {
        expect(getResult.data.status).toBe('deleted');
      }
    });

    it('should get storage usage', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      // Create some files
      const sizes = [1000, 2000, 3000];
      for (const size of sizes) {
        const result = await fileService.initiateUpload(actor, {
          filename: `usage-test-${size}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: size,
        });
        if (result.success) {
          createdFileIds.push(result.data.fileId);
          await fileService.confirmUpload(actor, result.data.fileId);
        }
      }

      // Get storage usage
      const usageResult = await fileService.getStorageUsage(actor, userId);

      expect(usageResult.success).toBe(true);
      if (usageResult.success) {
        expect(usageResult.data.usedBytes).toBeGreaterThanOrEqual(6000);
        expect(usageResult.data.fileCount).toBeGreaterThanOrEqual(3);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Permission Tests
  // ─────────────────────────────────────────────────────────────

  describe('Permission Enforcement', () => {
    it('should deny AI_ACTOR from uploading', async () => {
      const result = await fileService.initiateUpload(AI_ACTOR, {
        filename: 'ai-upload.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should deny AI_ACTOR from deleting', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      // Create file as user
      const initResult = await fileService.initiateUpload(actor, {
        filename: 'ai-delete-test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      });

      expect(initResult.success).toBe(true);
      if (!initResult.success) {
        return;
      }
      createdFileIds.push(initResult.data.fileId);

      await fileService.confirmUpload(actor, initResult.data.fileId);

      // Try to delete as AI
      const deleteResult = await fileService.deleteFile(
        AI_ACTOR,
        initResult.data.fileId
      );

      expect(deleteResult.success).toBe(false);
      if (!deleteResult.success) {
        expect(deleteResult.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow AI_ACTOR to read files', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      // Create file as user
      const initResult = await fileService.initiateUpload(actor, {
        filename: 'ai-read-test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      });

      expect(initResult.success).toBe(true);
      if (!initResult.success) {
        return;
      }
      createdFileIds.push(initResult.data.fileId);

      await fileService.confirmUpload(actor, initResult.data.fileId);

      // Read as AI
      const getResult = await fileService.getFile(
        AI_ACTOR,
        initResult.data.fileId
      );

      expect(getResult.success).toBe(true);
    });

    it('should deny access to another user files', async () => {
      const userId1 = await createTestUser();
      const userId2 = await createTestUser();
      const actor1 = createTestActor(userId1);
      const actor2 = createTestActor(userId2);

      // Create file as user1
      const initResult = await fileService.initiateUpload(actor1, {
        filename: 'user1-only.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      });

      expect(initResult.success).toBe(true);
      if (!initResult.success) {
        return;
      }
      createdFileIds.push(initResult.data.fileId);

      await fileService.confirmUpload(actor1, initResult.data.fileId);

      // Try to access as user2
      const getResult = await fileService.getFile(
        actor2,
        initResult.data.fileId
      );

      expect(getResult.success).toBe(false);
      if (!getResult.success) {
        expect(getResult.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow admin to get any user storage usage', async () => {
      const userId = await createTestUser();
      const userActor = createTestActor(userId);
      const adminActor = createAdminActor();

      // Create file as user
      const initResult = await fileService.initiateUpload(userActor, {
        filename: 'admin-check.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 5000,
      });

      expect(initResult.success).toBe(true);
      if (!initResult.success) {
        return;
      }
      createdFileIds.push(initResult.data.fileId);

      await fileService.confirmUpload(userActor, initResult.data.fileId);

      // Admin checks user's storage
      const usageResult = await fileService.getStorageUsage(adminActor, userId);

      expect(usageResult.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Validation Tests
  // ─────────────────────────────────────────────────────────────

  describe('Validation', () => {
    it('should reject empty filename', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      const result = await fileService.initiateUpload(actor, {
        filename: '',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should reject zero size', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      const result = await fileService.initiateUpload(actor, {
        filename: 'zero-size.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 0,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should reject confirming already active file', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      // Create and confirm file
      const initResult = await fileService.initiateUpload(actor, {
        filename: 'double-confirm.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      });

      expect(initResult.success).toBe(true);
      if (!initResult.success) {
        return;
      }
      createdFileIds.push(initResult.data.fileId);

      await fileService.confirmUpload(actor, initResult.data.fileId);

      // Try to confirm again
      const secondConfirm = await fileService.confirmUpload(
        actor,
        initResult.data.fileId
      );

      expect(secondConfirm.success).toBe(false);
      if (!secondConfirm.success) {
        expect(secondConfirm.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should reject deleting already deleted file', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      // Create, confirm, and delete file
      const initResult = await fileService.initiateUpload(actor, {
        filename: 'double-delete.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      });

      expect(initResult.success).toBe(true);
      if (!initResult.success) {
        return;
      }
      createdFileIds.push(initResult.data.fileId);

      await fileService.confirmUpload(actor, initResult.data.fileId);
      await fileService.deleteFile(actor, initResult.data.fileId);

      // Try to delete again
      const secondDelete = await fileService.deleteFile(
        actor,
        initResult.data.fileId
      );

      expect(secondDelete.success).toBe(false);
      if (!secondDelete.success) {
        expect(secondDelete.error.code).toBe('VALIDATION_ERROR');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Pagination Tests
  // ─────────────────────────────────────────────────────────────

  describe('Pagination', () => {
    it('should support cursor-based pagination', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      // Create 5 files
      for (let i = 0; i < 5; i++) {
        const result = await fileService.initiateUpload(actor, {
          filename: `pagination-${i}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: 1000 + i,
        });
        if (result.success) {
          createdFileIds.push(result.data.fileId);
          await fileService.confirmUpload(actor, result.data.fileId);
        }
        // Small delay to ensure different timestamps
        await new Promise((r) => setTimeout(r, 10));
      }

      // Get first page
      const page1 = await fileService.listFiles(actor, userId, { limit: 2 });

      expect(page1.success).toBe(true);
      if (!page1.success) {
        return;
      }

      expect(page1.data.items.length).toBe(2);
      expect(page1.data.hasMore).toBe(true);
      expect(page1.data.nextCursor).toBeDefined();

      // Get second page
      const page2 = await fileService.listFiles(actor, userId, {
        limit: 2,
        cursor: page1.data.nextCursor,
      });

      expect(page2.success).toBe(true);
      if (!page2.success) {
        return;
      }

      expect(page2.data.items.length).toBe(2);
      // Files should be different
      expect(page2.data.items[0].id).not.toBe(page1.data.items[0].id);
    });
  });
});
