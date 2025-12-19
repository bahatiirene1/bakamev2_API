/**
 * ApprovalService Integration Tests
 * Phase 2: Tests with real Supabase database
 *
 * These tests require:
 * - SUPABASE_URL environment variable
 * - SUPABASE_SERVICE_KEY environment variable
 * - Database with approval_requests table
 *
 * Tests are skipped if credentials are not available.
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

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import {
  createApprovalService,
  createApprovalServiceDb,
  createAuditService,
  createAuditServiceDb,
  createUserService,
  createUserServiceDb,
} from '@/services/index.js';
import type {
  ApprovalService,
  AuditService,
  UserService,
} from '@/services/index.js';
import type { ActorContext } from '@/types/index.js';
import { AI_ACTOR, SYSTEM_ACTOR } from '@/types/index.js';

// Check if we have database credentials
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const HAS_CREDENTIALS =
  SUPABASE_URL !== undefined &&
  SUPABASE_URL !== '' &&
  SUPABASE_SERVICE_KEY !== undefined &&
  SUPABASE_SERVICE_KEY !== '';

// Test fixtures - use nanoid for unique test identifiers
const TEST_PREFIX = `appr_test_${nanoid(6)}`;

// Helper to create unique test IDs
function testId(prefix: string): string {
  return `${TEST_PREFIX}_${prefix}_${nanoid(6)}`;
}

// Helper to create a valid UUID for resource IDs
function testUuid(): string {
  return crypto.randomUUID();
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
    permissions: [],
    ...overrides,
  };
}

// Helper to create reviewer actor
function createReviewerActor(
  userId: string,
  overrides?: Partial<ActorContext>
): ActorContext {
  return {
    type: 'admin',
    userId,
    requestId: testId('req'),
    permissions: ['knowledge:review', 'prompt:review'],
    ...overrides,
  };
}

describe.skipIf(!HAS_CREDENTIALS)('ApprovalService Integration', () => {
  let supabase: SupabaseClient;
  let approvalService: ApprovalService;
  let auditService: AuditService;
  let userService: UserService;

  // Track created resources for cleanup
  const createdUserIds: string[] = [];
  const createdApprovalIds: string[] = [];

  beforeAll(async () => {
    // Create Supabase client with service key (bypasses RLS)
    supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);

    // Create database adapters and services
    const auditDb = createAuditServiceDb(supabase);
    auditService = createAuditService({ db: auditDb });

    const userDb = createUserServiceDb(supabase);
    userService = createUserService({ db: userDb, auditService });

    const approvalDb = createApprovalServiceDb(supabase);
    approvalService = createApprovalService({
      db: approvalDb,
      auditService,
    });
  });

  afterAll(async () => {
    // Cleanup in reverse order

    // Delete approval requests
    if (createdApprovalIds.length > 0) {
      await supabase
        .from('approval_requests')
        .delete()
        .in('id', createdApprovalIds);
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
  // CREATE REQUEST
  // ─────────────────────────────────────────────────────────────

  describe('createRequest', () => {
    it('should create an approval request in database', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);
      const resourceId = testUuid();

      const result = await approvalService.createRequest(actor, {
        resourceType: 'knowledge_item',
        resourceId,
        action: 'publish',
        notes: 'Please review this knowledge item',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        createdApprovalIds.push(result.data.id);
        expect(result.data.resourceType).toBe('knowledge_item');
        expect(result.data.resourceId).toBe(resourceId);
        expect(result.data.action).toBe('publish');
        expect(result.data.status).toBe('pending');
        expect(result.data.requesterId).toBe(userId);
        expect(result.data.requestNotes).toBe(
          'Please review this knowledge item'
        );
      }
    });

    it('should create request for system_prompt resource type', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);
      const resourceId = testUuid();

      const result = await approvalService.createRequest(actor, {
        resourceType: 'system_prompt',
        resourceId,
        action: 'activate',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        createdApprovalIds.push(result.data.id);
        expect(result.data.resourceType).toBe('system_prompt');
        expect(result.data.action).toBe('activate');
      }
    });

    it('should deny AI_ACTOR from creating requests', async () => {
      const result = await approvalService.createRequest(AI_ACTOR, {
        resourceType: 'knowledge_item',
        resourceId: testUuid(),
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
      const userId = await createTestUser();
      const actor = createTestActor(userId);
      const resourceId = testUuid();

      // Create request first
      const createResult = await approvalService.createRequest(actor, {
        resourceType: 'knowledge_item',
        resourceId,
        action: 'publish',
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdApprovalIds.push(createResult.data.id);

      // Get the request
      const getResult = await approvalService.getRequest(
        actor,
        createResult.data.id
      );

      expect(getResult.success).toBe(true);
      if (getResult.success) {
        expect(getResult.data.id).toBe(createResult.data.id);
        expect(getResult.data.resourceId).toBe(resourceId);
      }
    });

    it('should return NOT_FOUND for non-existent request', async () => {
      const userId = await createTestUser();
      const actor = createReviewerActor(userId);
      const nonExistentId = testUuid();

      const result = await approvalService.getRequest(actor, nonExistentId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should deny unrelated user from getting request', async () => {
      const requesterId = await createTestUser();
      const otherUserId = await createTestUser();
      const requesterActor = createTestActor(requesterId);
      const otherActor = createTestActor(otherUserId); // No review permissions
      const resourceId = testUuid();

      // Create request as requester
      const createResult = await approvalService.createRequest(requesterActor, {
        resourceType: 'knowledge_item',
        resourceId,
        action: 'publish',
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdApprovalIds.push(createResult.data.id);

      // Try to get as other user
      const getResult = await approvalService.getRequest(
        otherActor,
        createResult.data.id
      );

      expect(getResult.success).toBe(false);
      if (!getResult.success) {
        expect(getResult.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow reviewer to get any request', async () => {
      const requesterId = await createTestUser();
      const reviewerId = await createTestUser();
      const requesterActor = createTestActor(requesterId);
      const reviewerActor = createReviewerActor(reviewerId);
      const resourceId = testUuid();

      // Create request as requester
      const createResult = await approvalService.createRequest(requesterActor, {
        resourceType: 'knowledge_item',
        resourceId,
        action: 'publish',
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdApprovalIds.push(createResult.data.id);

      // Get as reviewer
      const getResult = await approvalService.getRequest(
        reviewerActor,
        createResult.data.id
      );

      expect(getResult.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // LIST PENDING REQUESTS
  // ─────────────────────────────────────────────────────────────

  describe('listPendingRequests', () => {
    it('should list pending requests for reviewer', async () => {
      const requesterId = await createTestUser();
      const reviewerId = await createTestUser();
      const requesterActor = createTestActor(requesterId);
      const reviewerActor = createReviewerActor(reviewerId);

      // Create a pending request
      const createResult = await approvalService.createRequest(requesterActor, {
        resourceType: 'knowledge_item',
        resourceId: testUuid(),
        action: 'publish',
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdApprovalIds.push(createResult.data.id);

      // List pending as reviewer
      const listResult = await approvalService.listPendingRequests(
        reviewerActor,
        { limit: 20 }
      );

      expect(listResult.success).toBe(true);
      if (listResult.success) {
        expect(listResult.data.items.length).toBeGreaterThan(0);
        // All items should be pending
        for (const item of listResult.data.items) {
          expect(item.status).toBe('pending');
        }
      }
    });

    it('should deny non-reviewer from listing pending requests', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId); // No review permissions

      const result = await approvalService.listPendingRequests(actor, {
        limit: 20,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // APPROVE
  // ─────────────────────────────────────────────────────────────

  describe('approve', () => {
    it('should approve a pending request', async () => {
      const requesterId = await createTestUser();
      const reviewerId = await createTestUser();
      const requesterActor = createTestActor(requesterId);
      const reviewerActor = createReviewerActor(reviewerId);

      // Create a pending request
      const createResult = await approvalService.createRequest(requesterActor, {
        resourceType: 'knowledge_item',
        resourceId: testUuid(),
        action: 'publish',
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdApprovalIds.push(createResult.data.id);

      // Approve it
      const approveResult = await approvalService.approve(
        reviewerActor,
        createResult.data.id,
        'Looks good!'
      );

      expect(approveResult.success).toBe(true);

      // Verify it's approved
      const getResult = await approvalService.getRequest(
        reviewerActor,
        createResult.data.id
      );

      expect(getResult.success).toBe(true);
      if (getResult.success) {
        expect(getResult.data.status).toBe('approved');
        expect(getResult.data.reviewerId).toBe(reviewerId);
        expect(getResult.data.reviewNotes).toBe('Looks good!');
        expect(getResult.data.reviewedAt).not.toBeNull();
      }
    });

    it('should deny self-approval', async () => {
      const userId = await createTestUser();
      const actor = createReviewerActor(userId);

      // Create a pending request
      const createResult = await approvalService.createRequest(actor, {
        resourceType: 'knowledge_item',
        resourceId: testUuid(),
        action: 'publish',
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdApprovalIds.push(createResult.data.id);

      // Try to self-approve
      const approveResult = await approvalService.approve(
        actor,
        createResult.data.id
      );

      expect(approveResult.success).toBe(false);
      if (!approveResult.success) {
        expect(approveResult.error.code).toBe('PERMISSION_DENIED');
        expect(approveResult.error.message).toContain('own request');
      }
    });

    it('should deny AI_ACTOR from approving', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      // Create a pending request
      const createResult = await approvalService.createRequest(actor, {
        resourceType: 'knowledge_item',
        resourceId: testUuid(),
        action: 'publish',
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdApprovalIds.push(createResult.data.id);

      // Try to approve as AI
      const approveResult = await approvalService.approve(
        AI_ACTOR,
        createResult.data.id
      );

      expect(approveResult.success).toBe(false);
      if (!approveResult.success) {
        expect(approveResult.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // REJECT
  // ─────────────────────────────────────────────────────────────

  describe('reject', () => {
    it('should reject a pending request with reason', async () => {
      const requesterId = await createTestUser();
      const reviewerId = await createTestUser();
      const requesterActor = createTestActor(requesterId);
      const reviewerActor = createReviewerActor(reviewerId);

      // Create a pending request
      const createResult = await approvalService.createRequest(requesterActor, {
        resourceType: 'knowledge_item',
        resourceId: testUuid(),
        action: 'publish',
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdApprovalIds.push(createResult.data.id);

      // Reject it
      const rejectResult = await approvalService.reject(
        reviewerActor,
        createResult.data.id,
        'Needs more detail in the content'
      );

      expect(rejectResult.success).toBe(true);

      // Verify it's rejected
      const getResult = await approvalService.getRequest(
        reviewerActor,
        createResult.data.id
      );

      expect(getResult.success).toBe(true);
      if (getResult.success) {
        expect(getResult.data.status).toBe('rejected');
        expect(getResult.data.reviewerId).toBe(reviewerId);
        expect(getResult.data.reviewNotes).toBe(
          'Needs more detail in the content'
        );
      }
    });

    it('should return INVALID_STATE for already approved request', async () => {
      const requesterId = await createTestUser();
      const reviewerId = await createTestUser();
      const reviewerId2 = await createTestUser();
      const requesterActor = createTestActor(requesterId);
      const reviewerActor = createReviewerActor(reviewerId);
      const reviewerActor2 = createReviewerActor(reviewerId2);

      // Create and approve a request
      const createResult = await approvalService.createRequest(requesterActor, {
        resourceType: 'knowledge_item',
        resourceId: testUuid(),
        action: 'publish',
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdApprovalIds.push(createResult.data.id);

      await approvalService.approve(reviewerActor, createResult.data.id);

      // Try to reject the already approved request
      const rejectResult = await approvalService.reject(
        reviewerActor2,
        createResult.data.id,
        'Too late'
      );

      expect(rejectResult.success).toBe(false);
      if (!rejectResult.success) {
        expect(rejectResult.error.code).toBe('INVALID_STATE');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // CANCEL
  // ─────────────────────────────────────────────────────────────

  describe('cancel', () => {
    it('should cancel a pending request by requester', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      // Create a pending request
      const createResult = await approvalService.createRequest(actor, {
        resourceType: 'knowledge_item',
        resourceId: testUuid(),
        action: 'publish',
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdApprovalIds.push(createResult.data.id);

      // Cancel it
      const cancelResult = await approvalService.cancel(
        actor,
        createResult.data.id
      );

      expect(cancelResult.success).toBe(true);

      // Verify it's canceled (reviewer can still see it)
      const getResult = await approvalService.getRequest(
        SYSTEM_ACTOR,
        createResult.data.id
      );

      expect(getResult.success).toBe(true);
      if (getResult.success) {
        expect(getResult.data.status).toBe('canceled');
      }
    });

    it('should deny non-requester from canceling', async () => {
      const requesterId = await createTestUser();
      const otherUserId = await createTestUser();
      const requesterActor = createTestActor(requesterId);
      const otherActor = createTestActor(otherUserId);

      // Create a pending request
      const createResult = await approvalService.createRequest(requesterActor, {
        resourceType: 'knowledge_item',
        resourceId: testUuid(),
        action: 'publish',
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdApprovalIds.push(createResult.data.id);

      // Try to cancel as other user
      const cancelResult = await approvalService.cancel(
        otherActor,
        createResult.data.id
      );

      expect(cancelResult.success).toBe(false);
      if (!cancelResult.success) {
        expect(cancelResult.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow SYSTEM_ACTOR to cancel any request', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      // Create a pending request
      const createResult = await approvalService.createRequest(actor, {
        resourceType: 'knowledge_item',
        resourceId: testUuid(),
        action: 'publish',
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdApprovalIds.push(createResult.data.id);

      // Cancel as SYSTEM_ACTOR
      const cancelResult = await approvalService.cancel(
        SYSTEM_ACTOR,
        createResult.data.id
      );

      expect(cancelResult.success).toBe(true);
    });
  });
});
