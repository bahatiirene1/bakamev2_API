/**
 * KnowledgeService Integration Tests
 * Phase 2: Tests with real Supabase database
 *
 * These tests require:
 * - SUPABASE_URL environment variable
 * - SUPABASE_SERVICE_KEY environment variable
 * - Database with knowledge_items and knowledge_versions tables
 *
 * Tests are skipped if credentials are not available.
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

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import {
  createKnowledgeService,
  createKnowledgeServiceDb,
  createAuditService,
  createAuditServiceDb,
  createUserService,
  createUserServiceDb,
  createApprovalService,
  createApprovalServiceDb,
} from '@/services/index.js';
import type {
  KnowledgeService,
  AuditService,
  UserService,
  ApprovalService,
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
const TEST_PREFIX = `knowledge_test_${nanoid(6)}`;

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
    permissions: ['knowledge:read'],
    ...overrides,
  };
}

// Helper to create author actor with write permission
function createAuthorActor(
  userId: string,
  overrides?: Partial<ActorContext>
): ActorContext {
  return {
    type: 'user',
    userId,
    requestId: testId('req'),
    permissions: ['knowledge:read', 'knowledge:write'],
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
    permissions: [
      'knowledge:read',
      'knowledge:write',
      'knowledge:review',
      'knowledge:publish',
    ],
    ...overrides,
  };
}

describe.skipIf(!HAS_CREDENTIALS)('KnowledgeService Integration', () => {
  let supabase: SupabaseClient;
  let knowledgeService: KnowledgeService;
  let auditService: AuditService;
  let userService: UserService;
  let approvalService: ApprovalService;

  // Track created resources for cleanup
  const createdUserIds: string[] = [];
  const createdItemIds: string[] = [];

  beforeAll(async () => {
    // Create Supabase client with service key (bypasses RLS)
    supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);

    // Create database adapters and services
    const auditDb = createAuditServiceDb(supabase);
    auditService = createAuditService({ db: auditDb });

    const userDb = createUserServiceDb(supabase);
    userService = createUserService({ db: userDb, auditService });

    const approvalDb = createApprovalServiceDb(supabase);
    approvalService = createApprovalService({ db: approvalDb, auditService });

    const knowledgeDb = createKnowledgeServiceDb(supabase);
    knowledgeService = createKnowledgeService({
      db: knowledgeDb,
      auditService,
      approvalService,
    });
  });

  afterAll(async () => {
    // Cleanup in reverse order

    // Delete knowledge items (versions will cascade)
    if (createdItemIds.length > 0) {
      await supabase.from('knowledge_items').delete().in('id', createdItemIds);
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
  // CREATE KNOWLEDGE ITEM
  // ─────────────────────────────────────────────────────────────

  describe('createKnowledgeItem', () => {
    it('should create a knowledge item in database', async () => {
      const userId = await createTestUser();
      const actor = createAuthorActor(userId);
      const title = testId('article');

      const result = await knowledgeService.createKnowledgeItem(actor, {
        title,
        content: 'This is test content for the knowledge base.',
        category: 'general',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        createdItemIds.push(result.data.id);
        expect(result.data.title).toBe(title);
        expect(result.data.status).toBe('draft');
        expect(result.data.authorId).toBe(userId);
        expect(result.data.version).toBe(1);
      }
    });

    it('should deny user without knowledge:write permission', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId); // Only has knowledge:read

      const result = await knowledgeService.createKnowledgeItem(actor, {
        title: testId('denied'),
        content: 'Should fail',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should deny AI_ACTOR from creating items', async () => {
      const result = await knowledgeService.createKnowledgeItem(AI_ACTOR, {
        title: testId('ai_item'),
        content: 'AI content',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // GET KNOWLEDGE ITEM
  // ─────────────────────────────────────────────────────────────

  describe('getKnowledgeItem', () => {
    it('should get knowledge item by ID', async () => {
      const userId = await createTestUser();
      const actor = createAuthorActor(userId);
      const title = testId('getitem');

      // Create item
      const createResult = await knowledgeService.createKnowledgeItem(actor, {
        title,
        content: 'Test content',
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdItemIds.push(createResult.data.id);

      // Get item (author can view their draft)
      const getResult = await knowledgeService.getKnowledgeItem(
        actor,
        createResult.data.id
      );

      expect(getResult.success).toBe(true);
      if (getResult.success) {
        expect(getResult.data.id).toBe(createResult.data.id);
        expect(getResult.data.title).toBe(title);
      }
    });

    it('should return NOT_FOUND for non-existent item', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);
      const nonExistentId = crypto.randomUUID();

      const result = await knowledgeService.getKnowledgeItem(
        actor,
        nonExistentId
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should deny non-author from viewing draft item', async () => {
      const authorId = await createTestUser();
      const otherId = await createTestUser();
      const authorActor = createAuthorActor(authorId);
      const otherActor = createTestActor(otherId);

      // Author creates item
      const createResult = await knowledgeService.createKnowledgeItem(
        authorActor,
        {
          title: testId('private'),
          content: 'Private content',
        }
      );

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdItemIds.push(createResult.data.id);

      // Other user tries to view
      const getResult = await knowledgeService.getKnowledgeItem(
        otherActor,
        createResult.data.id
      );

      expect(getResult.success).toBe(false);
      if (!getResult.success) {
        expect(getResult.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // UPDATE KNOWLEDGE ITEM
  // ─────────────────────────────────────────────────────────────

  describe('updateKnowledgeItem', () => {
    it('should allow author to update their draft item', async () => {
      const userId = await createTestUser();
      const actor = createAuthorActor(userId);

      // Create item
      const createResult = await knowledgeService.createKnowledgeItem(actor, {
        title: testId('toupdate'),
        content: 'Original content',
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdItemIds.push(createResult.data.id);

      // Update item
      const updateResult = await knowledgeService.updateKnowledgeItem(
        actor,
        createResult.data.id,
        { title: 'Updated Title' }
      );

      expect(updateResult.success).toBe(true);
      if (updateResult.success) {
        expect(updateResult.data.title).toBe('Updated Title');
      }
    });

    it('should deny non-author from updating item', async () => {
      const authorId = await createTestUser();
      const otherId = await createTestUser();
      const authorActor = createAuthorActor(authorId);
      const otherActor = createAuthorActor(otherId);

      // Author creates item
      const createResult = await knowledgeService.createKnowledgeItem(
        authorActor,
        {
          title: testId('notupdatable'),
          content: 'Content',
        }
      );

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdItemIds.push(createResult.data.id);

      // Other user tries to update
      const updateResult = await knowledgeService.updateKnowledgeItem(
        otherActor,
        createResult.data.id,
        { title: 'Hacked' }
      );

      expect(updateResult.success).toBe(false);
      if (!updateResult.success) {
        expect(updateResult.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // GOVERNANCE WORKFLOW
  // ─────────────────────────────────────────────────────────────

  describe('governance workflow', () => {
    it('should complete full governance workflow: draft → review → approve → publish', async () => {
      const authorId = await createTestUser();
      const reviewerId = await createTestUser();
      const authorActor = createAuthorActor(authorId);
      const reviewerActor = createReviewerActor(reviewerId);

      // 1. Author creates draft
      const createResult = await knowledgeService.createKnowledgeItem(
        authorActor,
        {
          title: testId('workflow'),
          content: 'Workflow test content',
          category: 'test',
        }
      );

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdItemIds.push(createResult.data.id);
      const itemId = createResult.data.id;

      // Verify status is draft
      expect(createResult.data.status).toBe('draft');

      // 2. Author submits for review
      const submitResult = await knowledgeService.submitForReview(
        authorActor,
        itemId,
        'Ready for review'
      );

      expect(submitResult.success).toBe(true);

      // Verify status changed to pending_review
      const afterSubmit = await knowledgeService.getKnowledgeItem(
        authorActor,
        itemId
      );
      expect(afterSubmit.success).toBe(true);
      if (afterSubmit.success) {
        expect(afterSubmit.data.status).toBe('pending_review');
      }

      // 3. Reviewer approves
      const approveResult = await knowledgeService.approveItem(
        reviewerActor,
        itemId,
        'Looks good'
      );

      expect(approveResult.success).toBe(true);

      // Verify status changed to approved
      const afterApprove = await knowledgeService.getKnowledgeItem(
        reviewerActor,
        itemId
      );
      expect(afterApprove.success).toBe(true);
      if (afterApprove.success) {
        expect(afterApprove.data.status).toBe('approved');
        expect(afterApprove.data.reviewerId).toBe(reviewerId);
      }

      // 4. Reviewer publishes
      const publishResult = await knowledgeService.publishItem(
        reviewerActor,
        itemId
      );

      expect(publishResult.success).toBe(true);

      // Verify status changed to published
      const afterPublish = await knowledgeService.getKnowledgeItem(
        reviewerActor,
        itemId
      );
      expect(afterPublish.success).toBe(true);
      if (afterPublish.success) {
        expect(afterPublish.data.status).toBe('published');
        expect(afterPublish.data.publishedAt).not.toBeNull();
      }
    });

    it('should deny self-approval', async () => {
      const userId = await createTestUser();
      const actor = createReviewerActor(userId); // Has review permission

      // Create and submit
      const createResult = await knowledgeService.createKnowledgeItem(actor, {
        title: testId('selfapprove'),
        content: 'Content',
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdItemIds.push(createResult.data.id);

      await knowledgeService.submitForReview(actor, createResult.data.id);

      // Try to approve own item
      const approveResult = await knowledgeService.approveItem(
        actor,
        createResult.data.id
      );

      expect(approveResult.success).toBe(false);
      if (!approveResult.success) {
        expect(approveResult.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should deny AI_ACTOR from approving', async () => {
      const userId = await createTestUser();
      const authorActor = createAuthorActor(userId);

      // Create and submit
      const createResult = await knowledgeService.createKnowledgeItem(
        authorActor,
        {
          title: testId('aiapprove'),
          content: 'Content',
        }
      );

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdItemIds.push(createResult.data.id);

      await knowledgeService.submitForReview(authorActor, createResult.data.id);

      // AI tries to approve
      const approveResult = await knowledgeService.approveItem(
        AI_ACTOR,
        createResult.data.id
      );

      expect(approveResult.success).toBe(false);
      if (!approveResult.success) {
        expect(approveResult.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow rejection and return to draft', async () => {
      const authorId = await createTestUser();
      const reviewerId = await createTestUser();
      const authorActor = createAuthorActor(authorId);
      const reviewerActor = createReviewerActor(reviewerId);

      // Create and submit
      const createResult = await knowledgeService.createKnowledgeItem(
        authorActor,
        {
          title: testId('toreject'),
          content: 'Needs work',
        }
      );

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdItemIds.push(createResult.data.id);
      const itemId = createResult.data.id;

      await knowledgeService.submitForReview(authorActor, itemId);

      // Reviewer rejects
      const rejectResult = await knowledgeService.rejectItem(
        reviewerActor,
        itemId,
        'Needs more detail'
      );

      expect(rejectResult.success).toBe(true);

      // Verify back to draft
      const afterReject = await knowledgeService.getKnowledgeItem(
        authorActor,
        itemId
      );
      expect(afterReject.success).toBe(true);
      if (afterReject.success) {
        expect(afterReject.data.status).toBe('draft');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // ARCHIVE
  // ─────────────────────────────────────────────────────────────

  describe('archiveItem', () => {
    it('should allow author to archive their item', async () => {
      const userId = await createTestUser();
      const actor = createAuthorActor(userId);

      // Create item
      const createResult = await knowledgeService.createKnowledgeItem(actor, {
        title: testId('toarchive'),
        content: 'To be archived',
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdItemIds.push(createResult.data.id);

      // Archive
      const archiveResult = await knowledgeService.archiveItem(
        actor,
        createResult.data.id,
        'Outdated'
      );

      expect(archiveResult.success).toBe(true);

      // Verify archived
      const afterArchive = await knowledgeService.getKnowledgeItem(
        actor,
        createResult.data.id
      );
      expect(afterArchive.success).toBe(true);
      if (afterArchive.success) {
        expect(afterArchive.data.status).toBe('archived');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // SEARCH
  // ─────────────────────────────────────────────────────────────

  describe('searchKnowledge', () => {
    it('should search published items', async () => {
      const authorId = await createTestUser();
      const reviewerId = await createTestUser();
      const authorActor = createAuthorActor(authorId);
      const reviewerActor = createReviewerActor(reviewerId);
      const searchTerm = testId('searchable');

      // Create and publish an item
      const createResult = await knowledgeService.createKnowledgeItem(
        authorActor,
        {
          title: `${searchTerm} Article`,
          content: `This is ${searchTerm} content for testing search.`,
          category: 'search-test',
        }
      );

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdItemIds.push(createResult.data.id);

      // Publish the item through workflow
      await knowledgeService.submitForReview(authorActor, createResult.data.id);
      await knowledgeService.approveItem(reviewerActor, createResult.data.id);
      await knowledgeService.publishItem(reviewerActor, createResult.data.id);

      // Search
      const searchResult = await knowledgeService.searchKnowledge(authorActor, {
        query: searchTerm,
        limit: 10,
      });

      expect(searchResult.success).toBe(true);
      if (searchResult.success) {
        expect(searchResult.data.length).toBeGreaterThan(0);
        const found = searchResult.data.find(
          (r) => r.item.id === createResult.data.id
        );
        expect(found).toBeDefined();
      }
    });

    it('should allow AI_ACTOR to search for RAG', async () => {
      const searchResult = await knowledgeService.searchKnowledge(AI_ACTOR, {
        query: 'test',
        limit: 5,
      });

      expect(searchResult.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // VERSION HISTORY
  // ─────────────────────────────────────────────────────────────

  describe('getVersionHistory', () => {
    it('should return version history after content updates', async () => {
      const userId = await createTestUser();
      const actor = createAuthorActor(userId);

      // Create item
      const createResult = await knowledgeService.createKnowledgeItem(actor, {
        title: testId('versioned'),
        content: 'Version 1 content',
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdItemIds.push(createResult.data.id);
      const itemId = createResult.data.id;

      // Update content (creates new version)
      await knowledgeService.updateKnowledgeItem(actor, itemId, {
        content: 'Version 2 content',
      });

      // Get version history
      const historyResult = await knowledgeService.getVersionHistory(
        actor,
        itemId
      );

      expect(historyResult.success).toBe(true);
      if (historyResult.success) {
        expect(historyResult.data.length).toBeGreaterThanOrEqual(1);
      }
    });
  });
});
