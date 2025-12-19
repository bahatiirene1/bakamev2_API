/**
 * ApprovalService Unit Tests
 * Phase 2: TDD - RED phase
 *
 * Reference: docs/stage-2-service-layer.md Section 3.11
 *
 * SCOPE: Governance approval workflow management
 *
 * GUARDRAILS:
 * - Any user can create approval requests (for resources they own)
 * - Listing pending requires 'knowledge:review' or 'prompt:review' permission
 * - Approve/Reject requires appropriate review permission
 * - Cancel requires requester to be the actor
 * - AI_ACTOR cannot approve/reject (governance is human-only)
 * - SYSTEM_ACTOR can perform any action
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import type {
  ApprovalService,
  ApprovalServiceDb,
  ApprovalServiceAudit,
} from '@/services/approval.service.js';
import { createApprovalService } from '@/services/approval.service.js';
import type { ActorContext, ApprovalRequest } from '@/types/index.js';
import { AI_ACTOR, SYSTEM_ACTOR } from '@/types/index.js';

// ─────────────────────────────────────────────────────────────
// TEST FIXTURES
// ─────────────────────────────────────────────────────────────

const TEST_USER_ID = 'test-user-123';
const TEST_REVIEWER_ID = 'test-reviewer-456';
const TEST_OTHER_USER_ID = 'test-other-user-789';
const TEST_REQUEST_ID = 'test-request-xyz';
const TEST_RESOURCE_ID = 'test-resource-001';
const TEST_APPROVAL_ID = 'approval-request-001';

const mockApprovalRequest: ApprovalRequest = {
  id: TEST_APPROVAL_ID,
  resourceType: 'knowledge_item',
  resourceId: TEST_RESOURCE_ID,
  action: 'publish',
  status: 'pending',
  requesterId: TEST_USER_ID,
  reviewerId: null,
  requestNotes: 'Please review this knowledge item',
  reviewNotes: null,
  createdAt: new Date('2024-01-15'),
  reviewedAt: null,
};

const mockApprovedRequest: ApprovalRequest = {
  ...mockApprovalRequest,
  id: 'approval-request-002',
  status: 'approved',
  reviewerId: TEST_REVIEWER_ID,
  reviewNotes: 'Looks good!',
  reviewedAt: new Date('2024-01-16'),
};

const mockRejectedRequest: ApprovalRequest = {
  ...mockApprovalRequest,
  id: 'approval-request-003',
  status: 'rejected',
  reviewerId: TEST_REVIEWER_ID,
  reviewNotes: 'Needs more detail',
  reviewedAt: new Date('2024-01-16'),
};

const mockCanceledRequest: ApprovalRequest = {
  ...mockApprovalRequest,
  id: 'approval-request-004',
  status: 'canceled',
};

function createTestActor(overrides?: Partial<ActorContext>): ActorContext {
  return {
    type: 'user',
    userId: TEST_USER_ID,
    requestId: TEST_REQUEST_ID,
    permissions: [],
    ...overrides,
  };
}

function createReviewerActor(overrides?: Partial<ActorContext>): ActorContext {
  return {
    type: 'admin',
    userId: TEST_REVIEWER_ID,
    requestId: TEST_REQUEST_ID,
    permissions: ['knowledge:review', 'prompt:review'],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────
// MOCK SETUP
// ─────────────────────────────────────────────────────────────

function createMockDb(): ApprovalServiceDb {
  return {
    createRequest: vi.fn(),
    getRequest: vi.fn(),
    listPendingRequests: vi.fn(),
    updateRequestStatus: vi.fn(),
  };
}

function createMockAuditService(): ApprovalServiceAudit {
  return {
    log: vi.fn().mockResolvedValue({ success: true, data: undefined }),
  };
}

// ─────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────

describe('ApprovalService', () => {
  let approvalService: ApprovalService;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockAuditService: ReturnType<typeof createMockAuditService>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockAuditService = createMockAuditService();
    approvalService = createApprovalService({
      db: mockDb,
      auditService: mockAuditService,
    });
  });

  // ─────────────────────────────────────────────────────────────
  // CREATE REQUEST
  // ─────────────────────────────────────────────────────────────

  describe('createRequest', () => {
    it('should create an approval request', async () => {
      const actor = createTestActor();
      mockDb.createRequest.mockResolvedValue(mockApprovalRequest);

      const result = await approvalService.createRequest(actor, {
        resourceType: 'knowledge_item',
        resourceId: TEST_RESOURCE_ID,
        action: 'publish',
        notes: 'Please review this knowledge item',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(TEST_APPROVAL_ID);
        expect(result.data.resourceType).toBe('knowledge_item');
        expect(result.data.action).toBe('publish');
        expect(result.data.status).toBe('pending');
        expect(result.data.requesterId).toBe(TEST_USER_ID);
      }
      expect(mockAuditService.log).toHaveBeenCalled();
    });

    it('should create request for system_prompt resource type', async () => {
      const actor = createTestActor();
      const promptRequest: ApprovalRequest = {
        ...mockApprovalRequest,
        resourceType: 'system_prompt',
        action: 'activate',
      };
      mockDb.createRequest.mockResolvedValue(promptRequest);

      const result = await approvalService.createRequest(actor, {
        resourceType: 'system_prompt',
        resourceId: TEST_RESOURCE_ID,
        action: 'activate',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.resourceType).toBe('system_prompt');
        expect(result.data.action).toBe('activate');
      }
    });

    it('should create request with deprecate action', async () => {
      const actor = createTestActor();
      const deprecateRequest: ApprovalRequest = {
        ...mockApprovalRequest,
        action: 'deprecate',
      };
      mockDb.createRequest.mockResolvedValue(deprecateRequest);

      const result = await approvalService.createRequest(actor, {
        resourceType: 'knowledge_item',
        resourceId: TEST_RESOURCE_ID,
        action: 'deprecate',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.action).toBe('deprecate');
      }
    });

    it('should create request without notes', async () => {
      const actor = createTestActor();
      const requestWithoutNotes: ApprovalRequest = {
        ...mockApprovalRequest,
        requestNotes: null,
      };
      mockDb.createRequest.mockResolvedValue(requestWithoutNotes);

      const result = await approvalService.createRequest(actor, {
        resourceType: 'knowledge_item',
        resourceId: TEST_RESOURCE_ID,
        action: 'publish',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.requestNotes).toBeNull();
      }
    });

    it('should allow SYSTEM_ACTOR to create requests', async () => {
      mockDb.createRequest.mockResolvedValue(mockApprovalRequest);

      const result = await approvalService.createRequest(SYSTEM_ACTOR, {
        resourceType: 'knowledge_item',
        resourceId: TEST_RESOURCE_ID,
        action: 'publish',
      });

      expect(result.success).toBe(true);
    });

    it('should deny AI_ACTOR from creating requests', async () => {
      const result = await approvalService.createRequest(AI_ACTOR, {
        resourceType: 'knowledge_item',
        resourceId: TEST_RESOURCE_ID,
        action: 'publish',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // GET REQUEST
  // ─────────────────────────────────────────────────────────────

  describe('getRequest', () => {
    it('should get approval request by ID', async () => {
      const actor = createTestActor();
      mockDb.getRequest.mockResolvedValue(mockApprovalRequest);

      const result = await approvalService.getRequest(actor, TEST_APPROVAL_ID);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(TEST_APPROVAL_ID);
        expect(result.data.status).toBe('pending');
      }
    });

    it('should return NOT_FOUND for non-existent request', async () => {
      const actor = createTestActor();
      mockDb.getRequest.mockResolvedValue(null);

      const result = await approvalService.getRequest(actor, 'non-existent-id');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should allow requester to get their own request', async () => {
      const actor = createTestActor({ userId: TEST_USER_ID });
      mockDb.getRequest.mockResolvedValue(mockApprovalRequest);

      const result = await approvalService.getRequest(actor, TEST_APPROVAL_ID);

      expect(result.success).toBe(true);
    });

    it('should allow reviewer to get any request', async () => {
      const actor = createReviewerActor();
      mockDb.getRequest.mockResolvedValue(mockApprovalRequest);

      const result = await approvalService.getRequest(actor, TEST_APPROVAL_ID);

      expect(result.success).toBe(true);
    });

    it('should allow SYSTEM_ACTOR to get any request', async () => {
      mockDb.getRequest.mockResolvedValue(mockApprovalRequest);

      const result = await approvalService.getRequest(
        SYSTEM_ACTOR,
        TEST_APPROVAL_ID
      );

      expect(result.success).toBe(true);
    });

    it('should deny unrelated user from getting request', async () => {
      const actor = createTestActor({ userId: TEST_OTHER_USER_ID });
      mockDb.getRequest.mockResolvedValue(mockApprovalRequest);

      const result = await approvalService.getRequest(actor, TEST_APPROVAL_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // LIST PENDING REQUESTS
  // ─────────────────────────────────────────────────────────────

  describe('listPendingRequests', () => {
    it('should list pending requests for reviewer', async () => {
      const actor = createReviewerActor();
      mockDb.listPendingRequests.mockResolvedValue({
        items: [mockApprovalRequest],
        hasMore: false,
      });

      const result = await approvalService.listPendingRequests(actor, {
        limit: 20,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.items).toHaveLength(1);
        expect(result.data.items[0].status).toBe('pending');
      }
    });

    it('should filter by resource type', async () => {
      const actor = createReviewerActor();
      mockDb.listPendingRequests.mockResolvedValue({
        items: [mockApprovalRequest],
        hasMore: false,
      });

      const result = await approvalService.listPendingRequests(actor, {
        limit: 20,
        resourceType: 'knowledge_item',
      });

      expect(result.success).toBe(true);
      expect(mockDb.listPendingRequests).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceType: 'knowledge_item',
        })
      );
    });

    it('should support pagination with cursor', async () => {
      const actor = createReviewerActor();
      mockDb.listPendingRequests.mockResolvedValue({
        items: [mockApprovalRequest],
        nextCursor: 'next-cursor-123',
        hasMore: true,
      });

      const result = await approvalService.listPendingRequests(actor, {
        limit: 10,
        cursor: 'cursor-123',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.hasMore).toBe(true);
        expect(result.data.nextCursor).toBe('next-cursor-123');
      }
    });

    it('should deny non-reviewer from listing pending requests', async () => {
      const actor = createTestActor(); // No review permissions

      const result = await approvalService.listPendingRequests(actor, {
        limit: 20,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow user with knowledge:review to list', async () => {
      const actor = createTestActor({
        permissions: ['knowledge:review'],
      });
      mockDb.listPendingRequests.mockResolvedValue({
        items: [],
        hasMore: false,
      });

      const result = await approvalService.listPendingRequests(actor, {
        limit: 20,
      });

      expect(result.success).toBe(true);
    });

    it('should allow user with prompt:review to list', async () => {
      const actor = createTestActor({
        permissions: ['prompt:review'],
      });
      mockDb.listPendingRequests.mockResolvedValue({
        items: [],
        hasMore: false,
      });

      const result = await approvalService.listPendingRequests(actor, {
        limit: 20,
      });

      expect(result.success).toBe(true);
    });

    it('should allow SYSTEM_ACTOR to list pending requests', async () => {
      mockDb.listPendingRequests.mockResolvedValue({
        items: [],
        hasMore: false,
      });

      const result = await approvalService.listPendingRequests(SYSTEM_ACTOR, {
        limit: 20,
      });

      expect(result.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // APPROVE
  // ─────────────────────────────────────────────────────────────

  describe('approve', () => {
    it('should approve a pending request', async () => {
      const actor = createReviewerActor();
      mockDb.getRequest.mockResolvedValue(mockApprovalRequest);
      mockDb.updateRequestStatus.mockResolvedValue({
        ...mockApprovalRequest,
        status: 'approved',
        reviewerId: TEST_REVIEWER_ID,
        reviewNotes: 'Approved!',
        reviewedAt: new Date(),
      });

      const result = await approvalService.approve(
        actor,
        TEST_APPROVAL_ID,
        'Approved!'
      );

      expect(result.success).toBe(true);
      expect(mockDb.updateRequestStatus).toHaveBeenCalledWith(
        TEST_APPROVAL_ID,
        'approved',
        TEST_REVIEWER_ID,
        'Approved!'
      );
      expect(mockAuditService.log).toHaveBeenCalled();
    });

    it('should approve without notes', async () => {
      const actor = createReviewerActor();
      mockDb.getRequest.mockResolvedValue(mockApprovalRequest);
      mockDb.updateRequestStatus.mockResolvedValue({
        ...mockApprovalRequest,
        status: 'approved',
        reviewerId: TEST_REVIEWER_ID,
        reviewedAt: new Date(),
      });

      const result = await approvalService.approve(actor, TEST_APPROVAL_ID);

      expect(result.success).toBe(true);
    });

    it('should return NOT_FOUND for non-existent request', async () => {
      const actor = createReviewerActor();
      mockDb.getRequest.mockResolvedValue(null);

      const result = await approvalService.approve(actor, 'non-existent-id');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should return INVALID_STATE for already approved request', async () => {
      const actor = createReviewerActor();
      mockDb.getRequest.mockResolvedValue(mockApprovedRequest);

      const result = await approvalService.approve(actor, TEST_APPROVAL_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_STATE');
      }
    });

    it('should return INVALID_STATE for rejected request', async () => {
      const actor = createReviewerActor();
      mockDb.getRequest.mockResolvedValue(mockRejectedRequest);

      const result = await approvalService.approve(actor, TEST_APPROVAL_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_STATE');
      }
    });

    it('should return INVALID_STATE for canceled request', async () => {
      const actor = createReviewerActor();
      mockDb.getRequest.mockResolvedValue(mockCanceledRequest);

      const result = await approvalService.approve(actor, TEST_APPROVAL_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_STATE');
      }
    });

    it('should deny non-reviewer from approving', async () => {
      const actor = createTestActor(); // No review permissions
      mockDb.getRequest.mockResolvedValue(mockApprovalRequest);

      const result = await approvalService.approve(actor, TEST_APPROVAL_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should deny AI_ACTOR from approving', async () => {
      mockDb.getRequest.mockResolvedValue(mockApprovalRequest);

      const result = await approvalService.approve(AI_ACTOR, TEST_APPROVAL_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow SYSTEM_ACTOR to approve', async () => {
      mockDb.getRequest.mockResolvedValue(mockApprovalRequest);
      mockDb.updateRequestStatus.mockResolvedValue({
        ...mockApprovalRequest,
        status: 'approved',
      });

      const result = await approvalService.approve(
        SYSTEM_ACTOR,
        TEST_APPROVAL_ID
      );

      expect(result.success).toBe(true);
    });

    it('should prevent self-approval (requester cannot approve own request)', async () => {
      const actor = createReviewerActor({ userId: TEST_USER_ID }); // Same as requester
      mockDb.getRequest.mockResolvedValue(mockApprovalRequest);

      const result = await approvalService.approve(actor, TEST_APPROVAL_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
        expect(result.error.message).toContain('own request');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // REJECT
  // ─────────────────────────────────────────────────────────────

  describe('reject', () => {
    it('should reject a pending request with reason', async () => {
      const actor = createReviewerActor();
      mockDb.getRequest.mockResolvedValue(mockApprovalRequest);
      mockDb.updateRequestStatus.mockResolvedValue({
        ...mockApprovalRequest,
        status: 'rejected',
        reviewerId: TEST_REVIEWER_ID,
        reviewNotes: 'Needs more detail',
        reviewedAt: new Date(),
      });

      const result = await approvalService.reject(
        actor,
        TEST_APPROVAL_ID,
        'Needs more detail'
      );

      expect(result.success).toBe(true);
      expect(mockDb.updateRequestStatus).toHaveBeenCalledWith(
        TEST_APPROVAL_ID,
        'rejected',
        TEST_REVIEWER_ID,
        'Needs more detail'
      );
      expect(mockAuditService.log).toHaveBeenCalled();
    });

    it('should return NOT_FOUND for non-existent request', async () => {
      const actor = createReviewerActor();
      mockDb.getRequest.mockResolvedValue(null);

      const result = await approvalService.reject(
        actor,
        'non-existent-id',
        'Not found'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should return INVALID_STATE for already approved request', async () => {
      const actor = createReviewerActor();
      mockDb.getRequest.mockResolvedValue(mockApprovedRequest);

      const result = await approvalService.reject(
        actor,
        TEST_APPROVAL_ID,
        'Too late'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_STATE');
      }
    });

    it('should deny non-reviewer from rejecting', async () => {
      const actor = createTestActor(); // No review permissions
      mockDb.getRequest.mockResolvedValue(mockApprovalRequest);

      const result = await approvalService.reject(
        actor,
        TEST_APPROVAL_ID,
        'Reason'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should deny AI_ACTOR from rejecting', async () => {
      mockDb.getRequest.mockResolvedValue(mockApprovalRequest);

      const result = await approvalService.reject(
        AI_ACTOR,
        TEST_APPROVAL_ID,
        'AI says no'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow SYSTEM_ACTOR to reject', async () => {
      mockDb.getRequest.mockResolvedValue(mockApprovalRequest);
      mockDb.updateRequestStatus.mockResolvedValue({
        ...mockApprovalRequest,
        status: 'rejected',
      });

      const result = await approvalService.reject(
        SYSTEM_ACTOR,
        TEST_APPROVAL_ID,
        'System rejection'
      );

      expect(result.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // CANCEL
  // ─────────────────────────────────────────────────────────────

  describe('cancel', () => {
    it('should cancel a pending request by requester', async () => {
      const actor = createTestActor({ userId: TEST_USER_ID });
      mockDb.getRequest.mockResolvedValue(mockApprovalRequest);
      mockDb.updateRequestStatus.mockResolvedValue({
        ...mockApprovalRequest,
        status: 'canceled',
      });

      const result = await approvalService.cancel(actor, TEST_APPROVAL_ID);

      expect(result.success).toBe(true);
      expect(mockDb.updateRequestStatus).toHaveBeenCalledWith(
        TEST_APPROVAL_ID,
        'canceled',
        TEST_USER_ID
      );
      expect(mockAuditService.log).toHaveBeenCalled();
    });

    it('should return NOT_FOUND for non-existent request', async () => {
      const actor = createTestActor();
      mockDb.getRequest.mockResolvedValue(null);

      const result = await approvalService.cancel(actor, 'non-existent-id');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should return INVALID_STATE for already approved request', async () => {
      const actor = createTestActor({ userId: TEST_USER_ID });
      mockDb.getRequest.mockResolvedValue(mockApprovedRequest);

      const result = await approvalService.cancel(actor, TEST_APPROVAL_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_STATE');
      }
    });

    it('should return INVALID_STATE for already rejected request', async () => {
      const actor = createTestActor({ userId: TEST_USER_ID });
      mockDb.getRequest.mockResolvedValue(mockRejectedRequest);

      const result = await approvalService.cancel(actor, TEST_APPROVAL_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_STATE');
      }
    });

    it('should return INVALID_STATE for already canceled request', async () => {
      const actor = createTestActor({ userId: TEST_USER_ID });
      mockDb.getRequest.mockResolvedValue(mockCanceledRequest);

      const result = await approvalService.cancel(actor, TEST_APPROVAL_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_STATE');
      }
    });

    it('should deny non-requester from canceling', async () => {
      const actor = createTestActor({ userId: TEST_OTHER_USER_ID });
      mockDb.getRequest.mockResolvedValue(mockApprovalRequest);

      const result = await approvalService.cancel(actor, TEST_APPROVAL_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow SYSTEM_ACTOR to cancel any request', async () => {
      mockDb.getRequest.mockResolvedValue(mockApprovalRequest);
      mockDb.updateRequestStatus.mockResolvedValue({
        ...mockApprovalRequest,
        status: 'canceled',
      });

      const result = await approvalService.cancel(
        SYSTEM_ACTOR,
        TEST_APPROVAL_ID
      );

      expect(result.success).toBe(true);
    });

    it('should deny AI_ACTOR from canceling', async () => {
      mockDb.getRequest.mockResolvedValue(mockApprovalRequest);

      const result = await approvalService.cancel(AI_ACTOR, TEST_APPROVAL_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });
});
