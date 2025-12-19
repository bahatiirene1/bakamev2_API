/**
 * PromptService Integration Tests
 * Phase 2: Tests with real Supabase database
 *
 * These tests require:
 * - SUPABASE_URL environment variable
 * - SUPABASE_SERVICE_KEY environment variable
 * - Database with system_prompts and prompt_versions tables
 *
 * Tests are skipped if credentials are not available.
 *
 * SCOPE: System prompt governance
 *
 * GUARDRAILS:
 * - createPrompt requires 'prompt:write' permission
 * - Active prompts visible to anyone with 'prompt:read'
 * - Draft prompts visible only to author or admin
 * - submitForReview requires author ownership
 * - approvePrompt/rejectPrompt require 'prompt:review' permission
 * - activatePrompt/deprecatePrompt require 'prompt:activate' permission
 * - AI_ACTOR can create drafts but cannot approve/reject/activate/deprecate
 * - SYSTEM_ACTOR can perform any operation
 * - Self-approval is prohibited
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import {
  createPromptService,
  createPromptServiceDb,
  createAuditService,
  createAuditServiceDb,
  createUserService,
  createUserServiceDb,
} from '@/services/index.js';
import type {
  PromptService,
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
const TEST_PREFIX = `prompt_test_${nanoid(6)}`;

// Helper to create unique test IDs
function testId(prefix: string): string {
  return `${TEST_PREFIX}_${prefix}_${nanoid(6)}`;
}

// Helper to create test actor with read permission
function createTestActor(
  userId: string,
  overrides?: Partial<ActorContext>
): ActorContext {
  return {
    type: 'user',
    userId,
    requestId: testId('req'),
    permissions: ['prompt:read'],
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
    permissions: ['prompt:read', 'prompt:write'],
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
      'prompt:read',
      'prompt:write',
      'prompt:review',
      'prompt:activate',
    ],
    ...overrides,
  };
}

describe.skipIf(!HAS_CREDENTIALS)('PromptService Integration', () => {
  let supabase: SupabaseClient;
  let promptService: PromptService;
  let auditService: AuditService;
  let userService: UserService;

  // Track created resources for cleanup
  const createdUserIds: string[] = [];
  const createdPromptIds: string[] = [];

  beforeAll(async () => {
    // Create Supabase client with service key (bypasses RLS)
    supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);

    // Create database adapters and services
    const auditDb = createAuditServiceDb(supabase);
    auditService = createAuditService({ db: auditDb });

    const userDb = createUserServiceDb(supabase);
    userService = createUserService({ db: userDb, auditService });

    const promptDb = createPromptServiceDb(supabase);
    promptService = createPromptService({
      db: promptDb,
      auditService,
    });
  });

  afterAll(async () => {
    // Cleanup in reverse order

    // Delete prompts (versions will cascade)
    if (createdPromptIds.length > 0) {
      await supabase.from('system_prompts').delete().in('id', createdPromptIds);
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
  // CREATE PROMPT
  // ─────────────────────────────────────────────────────────────

  describe('createPrompt', () => {
    it('should create a prompt in database', async () => {
      const userId = await createTestUser();
      const actor = createAuthorActor(userId);
      const name = testId('prompt');

      const result = await promptService.createPrompt(actor, {
        name,
        description: 'Test system prompt',
        content: 'You are a helpful assistant.',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        createdPromptIds.push(result.data.id);
        expect(result.data.name).toBe(name);
        expect(result.data.status).toBe('draft');
        expect(result.data.authorId).toBe(userId);
        expect(result.data.version).toBe(1);
      }
    });

    it('should deny user without prompt:write permission', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId); // Only has prompt:read

      const result = await promptService.createPrompt(actor, {
        name: testId('prompt'),
        content: 'Test content',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // GET PROMPT
  // ─────────────────────────────────────────────────────────────

  describe('getPrompt', () => {
    it('should retrieve prompt by ID', async () => {
      const userId = await createTestUser();
      const actor = createAuthorActor(userId);
      const name = testId('get_prompt');

      const createResult = await promptService.createPrompt(actor, {
        name,
        content: 'Content for get test',
      });

      expect(createResult.success).toBe(true);
      if (createResult.success) {
        createdPromptIds.push(createResult.data.id);

        const getResult = await promptService.getPrompt(
          actor,
          createResult.data.id
        );

        expect(getResult.success).toBe(true);
        if (getResult.success) {
          expect(getResult.data.name).toBe(name);
        }
      }
    });

    it('should return NOT_FOUND for non-existent prompt', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      const result = await promptService.getPrompt(
        actor,
        '00000000-0000-0000-0000-000000000000'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // LIST PROMPTS
  // ─────────────────────────────────────────────────────────────

  describe('listPrompts', () => {
    it('should list prompts with pagination', async () => {
      const userId = await createTestUser();
      const actor = createAuthorActor(userId);

      // Create a few prompts
      for (let i = 0; i < 3; i++) {
        const result = await promptService.createPrompt(actor, {
          name: testId(`list_prompt_${i}`),
          content: `Content ${i}`,
        });
        if (result.success) {
          createdPromptIds.push(result.data.id);
        }
      }

      const listResult = await promptService.listPrompts(actor, { limit: 10 });

      expect(listResult.success).toBe(true);
      if (listResult.success) {
        expect(listResult.data.items.length).toBeGreaterThanOrEqual(3);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // UPDATE PROMPT
  // ─────────────────────────────────────────────────────────────

  describe('updatePrompt', () => {
    it('should update draft prompt content', async () => {
      const userId = await createTestUser();
      const actor = createAuthorActor(userId);

      const createResult = await promptService.createPrompt(actor, {
        name: testId('update_prompt'),
        content: 'Original content',
      });

      expect(createResult.success).toBe(true);
      if (createResult.success) {
        createdPromptIds.push(createResult.data.id);

        const updateResult = await promptService.updatePrompt(
          actor,
          createResult.data.id,
          { content: 'Updated content' }
        );

        expect(updateResult.success).toBe(true);
        if (updateResult.success) {
          expect(updateResult.data.content).toBe('Updated content');
          expect(updateResult.data.version).toBe(2);
        }
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // GOVERNANCE WORKFLOW
  // ─────────────────────────────────────────────────────────────

  describe('Governance Workflow', () => {
    it('should complete full workflow: draft → pending_review → approved → active', async () => {
      // Create author and reviewer
      const authorId = await createTestUser();
      const reviewerId = await createTestUser();

      const authorActor = createAuthorActor(authorId);
      const reviewerActor = createReviewerActor(reviewerId);

      // 1. Create draft prompt
      const createResult = await promptService.createPrompt(authorActor, {
        name: testId('workflow_prompt'),
        content: 'Workflow test content',
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdPromptIds.push(createResult.data.id);
      const promptId = createResult.data.id;
      expect(createResult.data.status).toBe('draft');

      // 2. Submit for review
      const submitResult = await promptService.submitForReview(
        authorActor,
        promptId
      );
      expect(submitResult.success).toBe(true);

      // 3. Verify status is pending_review
      const afterSubmit = await promptService.getPrompt(authorActor, promptId);
      expect(afterSubmit.success).toBe(true);
      if (afterSubmit.success) {
        expect(afterSubmit.data.status).toBe('pending_review');
      }

      // 4. Approve
      const approveResult = await promptService.approvePrompt(
        reviewerActor,
        promptId
      );
      expect(approveResult.success).toBe(true);

      // 5. Verify status is approved
      const afterApprove = await promptService.getPrompt(
        reviewerActor,
        promptId
      );
      expect(afterApprove.success).toBe(true);
      if (afterApprove.success) {
        expect(afterApprove.data.status).toBe('approved');
      }

      // 6. Activate
      const activateResult = await promptService.activatePrompt(
        reviewerActor,
        promptId
      );
      expect(activateResult.success).toBe(true);

      // 7. Verify status is active and is default
      const afterActivate = await promptService.getPrompt(
        reviewerActor,
        promptId
      );
      expect(afterActivate.success).toBe(true);
      if (afterActivate.success) {
        expect(afterActivate.data.status).toBe('active');
        expect(afterActivate.data.isDefault).toBe(true);
      }
    });

    it('should reject self-approval', async () => {
      const userId = await createTestUser();
      const actor = createReviewerActor(userId);

      // Create and submit
      const createResult = await promptService.createPrompt(actor, {
        name: testId('self_approve'),
        content: 'Test content',
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdPromptIds.push(createResult.data.id);

      await promptService.submitForReview(actor, createResult.data.id);

      // Try to approve own prompt
      const approveResult = await promptService.approvePrompt(
        actor,
        createResult.data.id
      );

      expect(approveResult.success).toBe(false);
      if (!approveResult.success) {
        expect(approveResult.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should prevent AI_ACTOR from approving prompts', async () => {
      const authorId = await createTestUser();
      const authorActor = createAuthorActor(authorId);

      // Create and submit as human
      const createResult = await promptService.createPrompt(authorActor, {
        name: testId('ai_approve'),
        content: 'Test content',
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdPromptIds.push(createResult.data.id);

      await promptService.submitForReview(authorActor, createResult.data.id);

      // Try to approve as AI
      const approveResult = await promptService.approvePrompt(
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
  // ACTIVE PROMPT
  // ─────────────────────────────────────────────────────────────

  describe('getActivePrompt', () => {
    it('should return active prompt after activation', async () => {
      const authorId = await createTestUser();
      const reviewerId = await createTestUser();

      const authorActor = createAuthorActor(authorId);
      const reviewerActor = createReviewerActor(reviewerId);

      // Create, submit, approve, activate
      const createResult = await promptService.createPrompt(authorActor, {
        name: testId('active_prompt'),
        content: 'Active prompt content',
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdPromptIds.push(createResult.data.id);

      await promptService.submitForReview(authorActor, createResult.data.id);
      await promptService.approvePrompt(reviewerActor, createResult.data.id);
      await promptService.activatePrompt(reviewerActor, createResult.data.id);

      // Get active prompt
      const activeResult = await promptService.getActivePrompt(authorActor);

      expect(activeResult.success).toBe(true);
      if (activeResult.success) {
        expect(activeResult.data.id).toBe(createResult.data.id);
        expect(activeResult.data.isDefault).toBe(true);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // DEPRECATE PROMPT
  // ─────────────────────────────────────────────────────────────

  describe('deprecatePrompt', () => {
    it('should deprecate approved (non-default) prompt', async () => {
      const authorId = await createTestUser();
      const reviewerId = await createTestUser();

      const authorActor = createAuthorActor(authorId);
      const reviewerActor = createReviewerActor(reviewerId);

      // Create and approve (but don't activate)
      const createResult = await promptService.createPrompt(authorActor, {
        name: testId('deprecate_prompt'),
        content: 'Will be deprecated',
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdPromptIds.push(createResult.data.id);

      await promptService.submitForReview(authorActor, createResult.data.id);
      await promptService.approvePrompt(reviewerActor, createResult.data.id);

      // Deprecate
      const deprecateResult = await promptService.deprecatePrompt(
        reviewerActor,
        createResult.data.id,
        'No longer needed'
      );

      expect(deprecateResult.success).toBe(true);

      // Verify status
      const afterDeprecate = await promptService.getPrompt(
        reviewerActor,
        createResult.data.id
      );
      expect(afterDeprecate.success).toBe(true);
      if (afterDeprecate.success) {
        expect(afterDeprecate.data.status).toBe('deprecated');
      }
    });
  });
});
