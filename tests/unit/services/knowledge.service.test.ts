/**
 * KnowledgeService Unit Tests
 * Phase 2: TDD - RED phase
 *
 * Reference: docs/stage-2-service-layer.md Section 3.5
 *
 * SCOPE: RAG knowledge base management with governance
 *
 * GUARDRAILS:
 * - createKnowledgeItem requires 'knowledge:write' permission
 * - Published items visible to anyone with 'knowledge:read'
 * - Draft items visible only to author or 'knowledge:review' permission
 * - submitForReview requires author ownership
 * - approveItem/rejectItem require 'knowledge:review' permission
 * - publishItem requires 'knowledge:publish' permission
 * - AI_ACTOR cannot approve/reject/publish (governance is human-only)
 * - SYSTEM_ACTOR can perform any operation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import type {
  KnowledgeService,
  KnowledgeServiceDb,
  KnowledgeServiceAudit,
  KnowledgeServiceApproval,
} from '@/services/knowledge.service.js';
import { createKnowledgeService } from '@/services/knowledge.service.js';
import type {
  ActorContext,
  KnowledgeItem,
  KnowledgeVersion,
  KnowledgeSearchResult,
} from '@/types/index.js';
import { AI_ACTOR, SYSTEM_ACTOR } from '@/types/index.js';

// ─────────────────────────────────────────────────────────────
// TEST FIXTURES
// ─────────────────────────────────────────────────────────────

const TEST_USER_ID = 'test-user-123';
const TEST_AUTHOR_ID = 'test-author-456';
const TEST_REVIEWER_ID = 'test-reviewer-789';
const TEST_OTHER_USER_ID = 'test-other-user-abc';
const TEST_REQUEST_ID = 'test-request-xyz';
const TEST_ITEM_ID = 'item-001';

const mockDraftItem: KnowledgeItem = {
  id: TEST_ITEM_ID,
  title: 'Test Knowledge Item',
  content: 'This is test content for the knowledge base.',
  category: 'general',
  status: 'draft',
  authorId: TEST_AUTHOR_ID,
  reviewerId: null,
  publishedAt: null,
  version: 1,
  metadata: {},
  createdAt: new Date('2024-01-15'),
  updatedAt: new Date('2024-01-15'),
};

const mockPendingReviewItem: KnowledgeItem = {
  ...mockDraftItem,
  id: 'item-002',
  status: 'pending_review',
};

const mockApprovedItem: KnowledgeItem = {
  ...mockDraftItem,
  id: 'item-003',
  status: 'approved',
  reviewerId: TEST_REVIEWER_ID,
};

const mockPublishedItem: KnowledgeItem = {
  ...mockDraftItem,
  id: 'item-004',
  status: 'published',
  reviewerId: TEST_REVIEWER_ID,
  publishedAt: new Date('2024-01-20'),
};

const mockArchivedItem: KnowledgeItem = {
  ...mockDraftItem,
  id: 'item-005',
  status: 'archived',
};

const mockVersion: KnowledgeVersion = {
  version: 1,
  title: 'Test Knowledge Item',
  content: 'This is test content for the knowledge base.',
  authorId: TEST_AUTHOR_ID,
  createdAt: new Date('2024-01-15'),
};

const mockSearchResult: KnowledgeSearchResult = {
  item: mockPublishedItem,
  chunk: 'This is test content',
  chunkIndex: 0,
  similarity: 0.95,
};

// ─────────────────────────────────────────────────────────────
// ACTOR FACTORIES
// ─────────────────────────────────────────────────────────────

function createUserActor(
  userId: string,
  permissions: string[] = []
): ActorContext {
  return {
    type: 'user',
    userId,
    requestId: TEST_REQUEST_ID,
    permissions,
  };
}

function createAdminActor(
  userId: string,
  permissions: string[] = [
    'knowledge:read',
    'knowledge:write',
    'knowledge:review',
    'knowledge:publish',
  ]
): ActorContext {
  return {
    type: 'admin',
    userId,
    requestId: TEST_REQUEST_ID,
    permissions,
  };
}

// ─────────────────────────────────────────────────────────────
// MOCK FACTORIES
// ─────────────────────────────────────────────────────────────

function createMockDb(): KnowledgeServiceDb {
  return {
    createItem: vi.fn(),
    getItem: vi.fn(),
    listItems: vi.fn(),
    updateItem: vi.fn(),
    updateItemStatus: vi.fn(),
    publishItem: vi.fn(),
    createVersion: vi.fn(),
    getVersionHistory: vi.fn(),
    searchItems: vi.fn(),
  };
}

function createMockAuditService(): KnowledgeServiceAudit {
  return {
    log: vi.fn().mockResolvedValue({ success: true, data: undefined }),
  };
}

function createMockApprovalService(): KnowledgeServiceApproval {
  return {
    createRequest: vi
      .fn()
      .mockResolvedValue({ success: true, data: { id: 'approval-001' } }),
  };
}

// ─────────────────────────────────────────────────────────────
// TEST SUITES
// ─────────────────────────────────────────────────────────────

describe('KnowledgeService', () => {
  let service: KnowledgeService;
  let mockDb: KnowledgeServiceDb;
  let mockAuditService: KnowledgeServiceAudit;
  let mockApprovalService: KnowledgeServiceApproval;

  beforeEach(() => {
    mockDb = createMockDb();
    mockAuditService = createMockAuditService();
    mockApprovalService = createMockApprovalService();
    service = createKnowledgeService({
      db: mockDb,
      auditService: mockAuditService,
      approvalService: mockApprovalService,
    });
  });

  // ─────────────────────────────────────────────────────────────
  // CREATE KNOWLEDGE ITEM
  // ─────────────────────────────────────────────────────────────

  describe('createKnowledgeItem', () => {
    it('should create item with knowledge:write permission', async () => {
      const actor = createUserActor(TEST_AUTHOR_ID, ['knowledge:write']);
      vi.mocked(mockDb.createItem).mockResolvedValue(mockDraftItem);

      const result = await service.createKnowledgeItem(actor, {
        title: 'Test Knowledge Item',
        content: 'This is test content for the knowledge base.',
        category: 'general',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(TEST_ITEM_ID);
        expect(result.data.status).toBe('draft');
        expect(result.data.authorId).toBe(TEST_AUTHOR_ID);
      }
      expect(mockDb.createItem).toHaveBeenCalledWith(TEST_AUTHOR_ID, {
        title: 'Test Knowledge Item',
        content: 'This is test content for the knowledge base.',
        category: 'general',
      });
    });

    it('should deny user without knowledge:write permission', async () => {
      const actor = createUserActor(TEST_USER_ID, ['knowledge:read']);

      const result = await service.createKnowledgeItem(actor, {
        title: 'Test',
        content: 'Content',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
      expect(mockDb.createItem).not.toHaveBeenCalled();
    });

    it('should deny AI_ACTOR from creating items', async () => {
      const result = await service.createKnowledgeItem(AI_ACTOR, {
        title: 'AI Created',
        content: 'AI Content',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow SYSTEM_ACTOR to create items', async () => {
      vi.mocked(mockDb.createItem).mockResolvedValue({
        ...mockDraftItem,
        authorId: 'system',
      });

      const result = await service.createKnowledgeItem(SYSTEM_ACTOR, {
        title: 'System Created',
        content: 'System Content',
      });

      expect(result.success).toBe(true);
    });

    it('should create item with optional metadata', async () => {
      const actor = createUserActor(TEST_AUTHOR_ID, ['knowledge:write']);
      const itemWithMetadata = {
        ...mockDraftItem,
        metadata: { source: 'manual', priority: 'high' },
      };
      vi.mocked(mockDb.createItem).mockResolvedValue(itemWithMetadata);

      const result = await service.createKnowledgeItem(actor, {
        title: 'Test',
        content: 'Content',
        metadata: { source: 'manual', priority: 'high' },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.metadata).toEqual({
          source: 'manual',
          priority: 'high',
        });
      }
    });

    it('should log audit event on creation', async () => {
      const actor = createUserActor(TEST_AUTHOR_ID, ['knowledge:write']);
      vi.mocked(mockDb.createItem).mockResolvedValue(mockDraftItem);

      await service.createKnowledgeItem(actor, {
        title: 'Test',
        content: 'Content',
      });

      expect(mockAuditService.log).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // GET KNOWLEDGE ITEM
  // ─────────────────────────────────────────────────────────────

  describe('getKnowledgeItem', () => {
    it('should allow author to view their draft item', async () => {
      const actor = createUserActor(TEST_AUTHOR_ID, ['knowledge:read']);
      vi.mocked(mockDb.getItem).mockResolvedValue(mockDraftItem);

      const result = await service.getKnowledgeItem(actor, TEST_ITEM_ID);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(TEST_ITEM_ID);
      }
    });

    it('should deny non-author from viewing draft item without knowledge:review', async () => {
      const actor = createUserActor(TEST_OTHER_USER_ID, ['knowledge:read']);
      vi.mocked(mockDb.getItem).mockResolvedValue(mockDraftItem);

      const result = await service.getKnowledgeItem(actor, TEST_ITEM_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow reviewer to view draft items', async () => {
      const actor = createUserActor(TEST_REVIEWER_ID, [
        'knowledge:read',
        'knowledge:review',
      ]);
      vi.mocked(mockDb.getItem).mockResolvedValue(mockDraftItem);

      const result = await service.getKnowledgeItem(actor, TEST_ITEM_ID);

      expect(result.success).toBe(true);
    });

    it('should allow anyone with knowledge:read to view published items', async () => {
      const actor = createUserActor(TEST_OTHER_USER_ID, ['knowledge:read']);
      vi.mocked(mockDb.getItem).mockResolvedValue(mockPublishedItem);

      const result = await service.getKnowledgeItem(
        actor,
        mockPublishedItem.id
      );

      expect(result.success).toBe(true);
    });

    it('should return NOT_FOUND for non-existent item', async () => {
      const actor = createUserActor(TEST_USER_ID, ['knowledge:read']);
      vi.mocked(mockDb.getItem).mockResolvedValue(null);

      const result = await service.getKnowledgeItem(actor, 'non-existent');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should allow SYSTEM_ACTOR to view any item', async () => {
      vi.mocked(mockDb.getItem).mockResolvedValue(mockDraftItem);

      const result = await service.getKnowledgeItem(SYSTEM_ACTOR, TEST_ITEM_ID);

      expect(result.success).toBe(true);
    });

    it('should allow AI_ACTOR to view published items for RAG', async () => {
      vi.mocked(mockDb.getItem).mockResolvedValue(mockPublishedItem);

      const result = await service.getKnowledgeItem(
        AI_ACTOR,
        mockPublishedItem.id
      );

      expect(result.success).toBe(true);
    });

    it('should deny AI_ACTOR from viewing draft items', async () => {
      vi.mocked(mockDb.getItem).mockResolvedValue(mockDraftItem);

      const result = await service.getKnowledgeItem(AI_ACTOR, TEST_ITEM_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // LIST KNOWLEDGE ITEMS
  // ─────────────────────────────────────────────────────────────

  describe('listKnowledgeItems', () => {
    it('should list published items for user with knowledge:read', async () => {
      const actor = createUserActor(TEST_USER_ID, ['knowledge:read']);
      vi.mocked(mockDb.listItems).mockResolvedValue({
        items: [mockPublishedItem],
        hasMore: false,
        nextCursor: undefined,
      });

      const result = await service.listKnowledgeItems(actor, { limit: 20 });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.items.length).toBe(1);
      }
    });

    it('should include draft items for author', async () => {
      const actor = createUserActor(TEST_AUTHOR_ID, ['knowledge:read']);
      vi.mocked(mockDb.listItems).mockResolvedValue({
        items: [mockDraftItem, mockPublishedItem],
        hasMore: false,
        nextCursor: undefined,
      });

      const result = await service.listKnowledgeItems(actor, {
        authorId: TEST_AUTHOR_ID,
        limit: 20,
      });

      expect(result.success).toBe(true);
    });

    it('should filter by status', async () => {
      const actor = createAdminActor(TEST_REVIEWER_ID);
      vi.mocked(mockDb.listItems).mockResolvedValue({
        items: [mockPendingReviewItem],
        hasMore: false,
        nextCursor: undefined,
      });

      const result = await service.listKnowledgeItems(actor, {
        status: 'pending_review',
        limit: 20,
      });

      expect(result.success).toBe(true);
      expect(mockDb.listItems).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'pending_review' })
      );
    });

    it('should filter by category', async () => {
      const actor = createUserActor(TEST_USER_ID, ['knowledge:read']);
      vi.mocked(mockDb.listItems).mockResolvedValue({
        items: [],
        hasMore: false,
        nextCursor: undefined,
      });

      const result = await service.listKnowledgeItems(actor, {
        category: 'technical',
        limit: 20,
      });

      expect(result.success).toBe(true);
      expect(mockDb.listItems).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'technical' })
      );
    });

    it('should support pagination', async () => {
      const actor = createUserActor(TEST_USER_ID, ['knowledge:read']);
      vi.mocked(mockDb.listItems).mockResolvedValue({
        items: [mockPublishedItem],
        hasMore: true,
        nextCursor: 'cursor-123',
      });

      const result = await service.listKnowledgeItems(actor, { limit: 10 });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.hasMore).toBe(true);
        expect(result.data.nextCursor).toBe('cursor-123');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // UPDATE KNOWLEDGE ITEM
  // ─────────────────────────────────────────────────────────────

  describe('updateKnowledgeItem', () => {
    it('should allow author to update their draft item', async () => {
      const actor = createUserActor(TEST_AUTHOR_ID, ['knowledge:write']);
      vi.mocked(mockDb.getItem).mockResolvedValue(mockDraftItem);
      vi.mocked(mockDb.updateItem).mockResolvedValue({
        ...mockDraftItem,
        title: 'Updated Title',
        version: 2,
      });

      const result = await service.updateKnowledgeItem(actor, TEST_ITEM_ID, {
        title: 'Updated Title',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.title).toBe('Updated Title');
        expect(result.data.version).toBe(2);
      }
    });

    it('should deny non-author from updating item', async () => {
      const actor = createUserActor(TEST_OTHER_USER_ID, ['knowledge:write']);
      vi.mocked(mockDb.getItem).mockResolvedValue(mockDraftItem);

      const result = await service.updateKnowledgeItem(actor, TEST_ITEM_ID, {
        title: 'Hacked Title',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should deny update of published item', async () => {
      const actor = createUserActor(TEST_AUTHOR_ID, ['knowledge:write']);
      vi.mocked(mockDb.getItem).mockResolvedValue(mockPublishedItem);

      const result = await service.updateKnowledgeItem(
        actor,
        mockPublishedItem.id,
        {
          title: 'Cannot Update Published',
        }
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_STATE');
      }
    });

    it('should deny update of archived item', async () => {
      const actor = createUserActor(TEST_AUTHOR_ID, ['knowledge:write']);
      vi.mocked(mockDb.getItem).mockResolvedValue(mockArchivedItem);

      const result = await service.updateKnowledgeItem(
        actor,
        mockArchivedItem.id,
        {
          title: 'Cannot Update Archived',
        }
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_STATE');
      }
    });

    it('should allow admin to update any draft item', async () => {
      const actor = createAdminActor(TEST_REVIEWER_ID);
      vi.mocked(mockDb.getItem).mockResolvedValue(mockDraftItem);
      vi.mocked(mockDb.updateItem).mockResolvedValue({
        ...mockDraftItem,
        title: 'Admin Updated',
      });

      const result = await service.updateKnowledgeItem(actor, TEST_ITEM_ID, {
        title: 'Admin Updated',
      });

      expect(result.success).toBe(true);
    });

    it('should create version on content update', async () => {
      const actor = createUserActor(TEST_AUTHOR_ID, ['knowledge:write']);
      vi.mocked(mockDb.getItem).mockResolvedValue(mockDraftItem);
      vi.mocked(mockDb.updateItem).mockResolvedValue({
        ...mockDraftItem,
        content: 'Updated content',
        version: 2,
      });
      vi.mocked(mockDb.createVersion).mockResolvedValue({
        ...mockVersion,
        version: 2,
      });

      const result = await service.updateKnowledgeItem(actor, TEST_ITEM_ID, {
        content: 'Updated content',
      });

      expect(result.success).toBe(true);
      expect(mockDb.createVersion).toHaveBeenCalled();
    });

    it('should allow SYSTEM_ACTOR to update any item', async () => {
      vi.mocked(mockDb.getItem).mockResolvedValue(mockDraftItem);
      vi.mocked(mockDb.updateItem).mockResolvedValue({
        ...mockDraftItem,
        title: 'System Updated',
      });

      const result = await service.updateKnowledgeItem(
        SYSTEM_ACTOR,
        TEST_ITEM_ID,
        {
          title: 'System Updated',
        }
      );

      expect(result.success).toBe(true);
    });

    it('should deny AI_ACTOR from updating items', async () => {
      vi.mocked(mockDb.getItem).mockResolvedValue(mockDraftItem);

      const result = await service.updateKnowledgeItem(AI_ACTOR, TEST_ITEM_ID, {
        title: 'AI Updated',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // SUBMIT FOR REVIEW
  // ─────────────────────────────────────────────────────────────

  describe('submitForReview', () => {
    it('should allow author to submit draft for review', async () => {
      const actor = createUserActor(TEST_AUTHOR_ID, ['knowledge:write']);
      vi.mocked(mockDb.getItem).mockResolvedValue(mockDraftItem);
      vi.mocked(mockDb.updateItemStatus).mockResolvedValue(
        mockPendingReviewItem
      );

      const result = await service.submitForReview(
        actor,
        TEST_ITEM_ID,
        'Ready for review'
      );

      expect(result.success).toBe(true);
      expect(mockDb.updateItemStatus).toHaveBeenCalledWith(
        TEST_ITEM_ID,
        'pending_review',
        undefined
      );
    });

    it('should deny non-author from submitting for review', async () => {
      const actor = createUserActor(TEST_OTHER_USER_ID, ['knowledge:write']);
      vi.mocked(mockDb.getItem).mockResolvedValue(mockDraftItem);

      const result = await service.submitForReview(actor, TEST_ITEM_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should deny submitting non-draft item', async () => {
      const actor = createUserActor(TEST_AUTHOR_ID, ['knowledge:write']);
      vi.mocked(mockDb.getItem).mockResolvedValue(mockPublishedItem);

      const result = await service.submitForReview(actor, mockPublishedItem.id);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_STATE');
      }
    });

    it('should create approval request on submit', async () => {
      const actor = createUserActor(TEST_AUTHOR_ID, ['knowledge:write']);
      vi.mocked(mockDb.getItem).mockResolvedValue(mockDraftItem);
      vi.mocked(mockDb.updateItemStatus).mockResolvedValue(
        mockPendingReviewItem
      );

      await service.submitForReview(actor, TEST_ITEM_ID, 'Please review');

      expect(mockApprovalService.createRequest).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({
          resourceType: 'knowledge_item',
          resourceId: TEST_ITEM_ID,
          action: 'publish',
        })
      );
    });

    it('should deny AI_ACTOR from submitting for review', async () => {
      vi.mocked(mockDb.getItem).mockResolvedValue({
        ...mockDraftItem,
        authorId: 'ai',
      });

      const result = await service.submitForReview(AI_ACTOR, TEST_ITEM_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // APPROVE ITEM
  // ─────────────────────────────────────────────────────────────

  describe('approveItem', () => {
    it('should allow reviewer to approve pending item', async () => {
      const actor = createUserActor(TEST_REVIEWER_ID, ['knowledge:review']);
      vi.mocked(mockDb.getItem).mockResolvedValue(mockPendingReviewItem);
      vi.mocked(mockDb.updateItemStatus).mockResolvedValue(mockApprovedItem);

      const result = await service.approveItem(
        actor,
        mockPendingReviewItem.id,
        'Looks good'
      );

      expect(result.success).toBe(true);
      expect(mockDb.updateItemStatus).toHaveBeenCalledWith(
        mockPendingReviewItem.id,
        'approved',
        TEST_REVIEWER_ID
      );
    });

    it('should deny user without knowledge:review permission', async () => {
      const actor = createUserActor(TEST_USER_ID, ['knowledge:read']);
      vi.mocked(mockDb.getItem).mockResolvedValue(mockPendingReviewItem);

      const result = await service.approveItem(actor, mockPendingReviewItem.id);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should deny approving non-pending item', async () => {
      const actor = createUserActor(TEST_REVIEWER_ID, ['knowledge:review']);
      vi.mocked(mockDb.getItem).mockResolvedValue(mockDraftItem);

      const result = await service.approveItem(actor, TEST_ITEM_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_STATE');
      }
    });

    it('should deny AI_ACTOR from approving (governance is human-only)', async () => {
      vi.mocked(mockDb.getItem).mockResolvedValue(mockPendingReviewItem);

      const result = await service.approveItem(
        AI_ACTOR,
        mockPendingReviewItem.id
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
        expect(result.error.message).toContain('human');
      }
    });

    it('should allow SYSTEM_ACTOR to approve', async () => {
      vi.mocked(mockDb.getItem).mockResolvedValue(mockPendingReviewItem);
      vi.mocked(mockDb.updateItemStatus).mockResolvedValue(mockApprovedItem);

      const result = await service.approveItem(
        SYSTEM_ACTOR,
        mockPendingReviewItem.id
      );

      expect(result.success).toBe(true);
    });

    it('should deny self-approval', async () => {
      const actor = createUserActor(TEST_AUTHOR_ID, ['knowledge:review']);
      vi.mocked(mockDb.getItem).mockResolvedValue({
        ...mockPendingReviewItem,
        authorId: TEST_AUTHOR_ID,
      });

      const result = await service.approveItem(actor, mockPendingReviewItem.id);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // REJECT ITEM
  // ─────────────────────────────────────────────────────────────

  describe('rejectItem', () => {
    it('should allow reviewer to reject pending item with reason', async () => {
      const actor = createUserActor(TEST_REVIEWER_ID, ['knowledge:review']);
      vi.mocked(mockDb.getItem).mockResolvedValue(mockPendingReviewItem);
      vi.mocked(mockDb.updateItemStatus).mockResolvedValue({
        ...mockDraftItem,
        id: mockPendingReviewItem.id,
      });

      const result = await service.rejectItem(
        actor,
        mockPendingReviewItem.id,
        'Needs more detail'
      );

      expect(result.success).toBe(true);
      expect(mockDb.updateItemStatus).toHaveBeenCalledWith(
        mockPendingReviewItem.id,
        'draft',
        null
      );
    });

    it('should deny user without knowledge:review permission', async () => {
      const actor = createUserActor(TEST_USER_ID, ['knowledge:read']);
      vi.mocked(mockDb.getItem).mockResolvedValue(mockPendingReviewItem);

      const result = await service.rejectItem(
        actor,
        mockPendingReviewItem.id,
        'No permission'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should deny rejecting non-pending item', async () => {
      const actor = createUserActor(TEST_REVIEWER_ID, ['knowledge:review']);
      vi.mocked(mockDb.getItem).mockResolvedValue(mockPublishedItem);

      const result = await service.rejectItem(
        actor,
        mockPublishedItem.id,
        'Cannot reject'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_STATE');
      }
    });

    it('should deny AI_ACTOR from rejecting (governance is human-only)', async () => {
      vi.mocked(mockDb.getItem).mockResolvedValue(mockPendingReviewItem);

      const result = await service.rejectItem(
        AI_ACTOR,
        mockPendingReviewItem.id,
        'AI rejection'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
        expect(result.error.message).toContain('human');
      }
    });

    it('should allow SYSTEM_ACTOR to reject', async () => {
      vi.mocked(mockDb.getItem).mockResolvedValue(mockPendingReviewItem);
      vi.mocked(mockDb.updateItemStatus).mockResolvedValue(mockDraftItem);

      const result = await service.rejectItem(
        SYSTEM_ACTOR,
        mockPendingReviewItem.id,
        'System rejection'
      );

      expect(result.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // PUBLISH ITEM
  // ─────────────────────────────────────────────────────────────

  describe('publishItem', () => {
    it('should allow user with knowledge:publish to publish approved item', async () => {
      const actor = createUserActor(TEST_REVIEWER_ID, ['knowledge:publish']);
      vi.mocked(mockDb.getItem).mockResolvedValue(mockApprovedItem);
      vi.mocked(mockDb.publishItem).mockResolvedValue(mockPublishedItem);

      const result = await service.publishItem(actor, mockApprovedItem.id);

      expect(result.success).toBe(true);
      expect(mockDb.publishItem).toHaveBeenCalledWith(mockApprovedItem.id);
    });

    it('should deny user without knowledge:publish permission', async () => {
      const actor = createUserActor(TEST_USER_ID, ['knowledge:review']);
      vi.mocked(mockDb.getItem).mockResolvedValue(mockApprovedItem);

      const result = await service.publishItem(actor, mockApprovedItem.id);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should deny publishing non-approved item', async () => {
      const actor = createUserActor(TEST_REVIEWER_ID, ['knowledge:publish']);
      vi.mocked(mockDb.getItem).mockResolvedValue(mockDraftItem);

      const result = await service.publishItem(actor, TEST_ITEM_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_STATE');
      }
    });

    it('should deny publishing pending_review item (must be approved first)', async () => {
      const actor = createUserActor(TEST_REVIEWER_ID, ['knowledge:publish']);
      vi.mocked(mockDb.getItem).mockResolvedValue(mockPendingReviewItem);

      const result = await service.publishItem(actor, mockPendingReviewItem.id);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_STATE');
      }
    });

    it('should deny AI_ACTOR from publishing (governance is human-only)', async () => {
      vi.mocked(mockDb.getItem).mockResolvedValue(mockApprovedItem);

      const result = await service.publishItem(AI_ACTOR, mockApprovedItem.id);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
        expect(result.error.message).toContain('human');
      }
    });

    it('should allow SYSTEM_ACTOR to publish', async () => {
      vi.mocked(mockDb.getItem).mockResolvedValue(mockApprovedItem);
      vi.mocked(mockDb.publishItem).mockResolvedValue(mockPublishedItem);

      const result = await service.publishItem(
        SYSTEM_ACTOR,
        mockApprovedItem.id
      );

      expect(result.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // ARCHIVE ITEM
  // ─────────────────────────────────────────────────────────────

  describe('archiveItem', () => {
    it('should allow author to archive their item', async () => {
      const actor = createUserActor(TEST_AUTHOR_ID, ['knowledge:write']);
      vi.mocked(mockDb.getItem).mockResolvedValue(mockPublishedItem);
      vi.mocked(mockDb.updateItemStatus).mockResolvedValue(mockArchivedItem);

      const result = await service.archiveItem(
        actor,
        mockPublishedItem.id,
        'Outdated content'
      );

      expect(result.success).toBe(true);
      expect(mockDb.updateItemStatus).toHaveBeenCalledWith(
        mockPublishedItem.id,
        'archived',
        undefined
      );
    });

    it('should allow admin to archive any item', async () => {
      const actor = createAdminActor(TEST_REVIEWER_ID);
      vi.mocked(mockDb.getItem).mockResolvedValue(mockPublishedItem);
      vi.mocked(mockDb.updateItemStatus).mockResolvedValue(mockArchivedItem);

      const result = await service.archiveItem(
        actor,
        mockPublishedItem.id,
        'Admin archive'
      );

      expect(result.success).toBe(true);
    });

    it('should deny non-author without admin permissions', async () => {
      const actor = createUserActor(TEST_OTHER_USER_ID, ['knowledge:write']);
      vi.mocked(mockDb.getItem).mockResolvedValue(mockPublishedItem);

      const result = await service.archiveItem(
        actor,
        mockPublishedItem.id,
        'Cannot archive'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should deny archiving already archived item', async () => {
      const actor = createUserActor(TEST_AUTHOR_ID, ['knowledge:write']);
      vi.mocked(mockDb.getItem).mockResolvedValue(mockArchivedItem);

      const result = await service.archiveItem(
        actor,
        mockArchivedItem.id,
        'Already archived'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_STATE');
      }
    });

    it('should allow SYSTEM_ACTOR to archive any item', async () => {
      vi.mocked(mockDb.getItem).mockResolvedValue(mockPublishedItem);
      vi.mocked(mockDb.updateItemStatus).mockResolvedValue(mockArchivedItem);

      const result = await service.archiveItem(
        SYSTEM_ACTOR,
        mockPublishedItem.id,
        'System archive'
      );

      expect(result.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // SEARCH KNOWLEDGE
  // ─────────────────────────────────────────────────────────────

  describe('searchKnowledge', () => {
    it('should search published items', async () => {
      const actor = createUserActor(TEST_USER_ID, ['knowledge:read']);
      vi.mocked(mockDb.searchItems).mockResolvedValue([mockSearchResult]);

      const result = await service.searchKnowledge(actor, {
        query: 'test content',
        limit: 10,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBe(1);
        expect(result.data[0].similarity).toBe(0.95);
      }
    });

    it('should filter by minimum similarity', async () => {
      const actor = createUserActor(TEST_USER_ID, ['knowledge:read']);
      vi.mocked(mockDb.searchItems).mockResolvedValue([mockSearchResult]);

      await service.searchKnowledge(actor, {
        query: 'test',
        minSimilarity: 0.8,
      });

      expect(mockDb.searchItems).toHaveBeenCalledWith(
        expect.objectContaining({ minSimilarity: 0.8 })
      );
    });

    it('should filter by categories', async () => {
      const actor = createUserActor(TEST_USER_ID, ['knowledge:read']);
      vi.mocked(mockDb.searchItems).mockResolvedValue([]);

      await service.searchKnowledge(actor, {
        query: 'test',
        categories: ['technical', 'general'],
      });

      expect(mockDb.searchItems).toHaveBeenCalledWith(
        expect.objectContaining({ categories: ['technical', 'general'] })
      );
    });

    it('should allow AI_ACTOR to search for RAG', async () => {
      vi.mocked(mockDb.searchItems).mockResolvedValue([mockSearchResult]);

      const result = await service.searchKnowledge(AI_ACTOR, {
        query: 'test',
      });

      expect(result.success).toBe(true);
    });

    it('should deny user without knowledge:read', async () => {
      const actor = createUserActor(TEST_USER_ID, []);

      const result = await service.searchKnowledge(actor, {
        query: 'test',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // GET VERSION HISTORY
  // ─────────────────────────────────────────────────────────────

  describe('getVersionHistory', () => {
    it('should return version history for author', async () => {
      const actor = createUserActor(TEST_AUTHOR_ID, ['knowledge:read']);
      vi.mocked(mockDb.getItem).mockResolvedValue(mockDraftItem);
      vi.mocked(mockDb.getVersionHistory).mockResolvedValue([
        mockVersion,
        { ...mockVersion, version: 2 },
      ]);

      const result = await service.getVersionHistory(actor, TEST_ITEM_ID);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBe(2);
      }
    });

    it('should deny non-author from viewing draft item history', async () => {
      const actor = createUserActor(TEST_OTHER_USER_ID, ['knowledge:read']);
      vi.mocked(mockDb.getItem).mockResolvedValue(mockDraftItem);

      const result = await service.getVersionHistory(actor, TEST_ITEM_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow anyone to view published item history', async () => {
      const actor = createUserActor(TEST_OTHER_USER_ID, ['knowledge:read']);
      vi.mocked(mockDb.getItem).mockResolvedValue(mockPublishedItem);
      vi.mocked(mockDb.getVersionHistory).mockResolvedValue([mockVersion]);

      const result = await service.getVersionHistory(
        actor,
        mockPublishedItem.id
      );

      expect(result.success).toBe(true);
    });

    it('should return NOT_FOUND for non-existent item', async () => {
      const actor = createUserActor(TEST_USER_ID, ['knowledge:read']);
      vi.mocked(mockDb.getItem).mockResolvedValue(null);

      const result = await service.getVersionHistory(actor, 'non-existent');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should allow reviewer to view any item history', async () => {
      const actor = createUserActor(TEST_REVIEWER_ID, [
        'knowledge:read',
        'knowledge:review',
      ]);
      vi.mocked(mockDb.getItem).mockResolvedValue(mockDraftItem);
      vi.mocked(mockDb.getVersionHistory).mockResolvedValue([mockVersion]);

      const result = await service.getVersionHistory(actor, TEST_ITEM_ID);

      expect(result.success).toBe(true);
    });
  });
});
