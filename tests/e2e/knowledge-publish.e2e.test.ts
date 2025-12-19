/**
 * Knowledge Publish Workflow E2E Tests
 * Phase C: Full knowledge item lifecycle with approval
 *
 * Flow: Create draft → Submit for review → Admin approval → Activate
 *       → Retrievable in AI context
 *
 * These tests require database credentials.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import {
  createKnowledgeService,
  createKnowledgeServiceDb,
  createApprovalService,
  createApprovalServiceDb,
  createAuditService,
  createAuditServiceDb,
  createChatService,
  createChatServiceDb,
  createContextService,
  createUserService,
  createUserServiceDb,
  createMemoryService,
  createMemoryServiceDb,
  createPromptService,
  createPromptServiceDb,
  createToolService,
  createToolServiceDb,
  createSubscriptionService,
  createSubscriptionServiceDb,
} from '@/services/index.js';
import type {
  KnowledgeService,
  ApprovalService,
  AuditService,
  ContextService,
} from '@/services/index.js';
import type { ActorContext } from '@/types/index.js';

// Check credentials
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const HAS_CREDENTIALS =
  SUPABASE_URL !== undefined &&
  SUPABASE_URL !== '' &&
  SUPABASE_SERVICE_KEY !== undefined &&
  SUPABASE_SERVICE_KEY !== '';

// Unique test prefix
const TEST_PREFIX = `e2e_knowledge_${nanoid(6)}`;

function testId(prefix: string): string {
  return `${TEST_PREFIX}_${prefix}_${nanoid(6)}`;
}

function createUserActor(userId: string): ActorContext {
  return {
    type: 'user',
    userId,
    requestId: testId('req'),
    permissions: ['knowledge:read', 'knowledge:write'],
  };
}

function createAdminActor(): ActorContext {
  return {
    type: 'admin',
    userId: testId('admin'),
    requestId: testId('req'),
    permissions: ['admin:*', 'approval:*'],
  };
}

describe.skipIf(!HAS_CREDENTIALS)('E2E: Knowledge Publish Workflow', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let supabase: SupabaseClient<any, 'public', any>;
  let knowledgeService: KnowledgeService;
  let approvalService: ApprovalService;
  let auditService: AuditService;
  let contextService: ContextService;

  // Track for cleanup
  const createdUserIds: string[] = [];
  const createdKnowledgeIds: string[] = [];
  const createdApprovalIds: string[] = [];
  const createdChatIds: string[] = [];

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase = createClient(
      SUPABASE_URL!,
      SUPABASE_SERVICE_KEY!
    ) as SupabaseClient<any, 'public', any>;

    // Create all adapters
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const auditDb = createAuditServiceDb(supabase);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const approvalDb = createApprovalServiceDb(supabase);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const knowledgeDb = createKnowledgeServiceDb(supabase);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const userDb = createUserServiceDb(supabase);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const chatDb = createChatServiceDb(supabase);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const memoryDb = createMemoryServiceDb(supabase);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const promptDb = createPromptServiceDb(supabase);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const toolDb = createToolServiceDb(supabase);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const subscriptionDb = createSubscriptionServiceDb(supabase);

    auditService = createAuditService({ db: auditDb });

    approvalService = createApprovalService({
      db: approvalDb,
      auditService: { log: (...args) => auditService.log(...args) },
    });

    knowledgeService = createKnowledgeService({
      db: knowledgeDb,
      auditService: { log: (...args) => auditService.log(...args) },
      approvalService: {
        createRequest: (...args) => approvalService.createRequest(...args),
      },
    });

    const userService = createUserService({
      db: userDb,
      auditService: { log: (...args) => auditService.log(...args) },
    });

    const chatService = createChatService({
      db: chatDb,
      auditService: { log: (...args) => auditService.log(...args) },
    });

    const memoryService = createMemoryService({
      db: memoryDb,
      auditService: { log: (...args) => auditService.log(...args) },
    });

    const promptService = createPromptService({
      db: promptDb,
      auditService: { log: (...args) => auditService.log(...args) },
    });

    const subscriptionService = createSubscriptionService({
      db: subscriptionDb,
      auditService: { log: (...args) => auditService.log(...args) },
    });

    const toolService = createToolService({
      db: toolDb,
      auditService: { log: (...args) => auditService.log(...args) },
      subscriptionService: {
        checkEntitlement: (...args) =>
          subscriptionService.checkEntitlement(...args),
      },
    });

    contextService = createContextService({
      userService: {
        getAIPreferences: (...args) => userService.getAIPreferences(...args),
      },
      chatService: {
        getChat: (...args) => chatService.getChat(...args),
        getMessages: (...args) => chatService.getMessages(...args),
        addMessage: (...args) => chatService.addMessage(...args),
      },
      memoryService: {
        searchMemories: (...args) => memoryService.searchMemories(...args),
      },
      knowledgeService: {
        searchKnowledge: (...args) => knowledgeService.searchKnowledge(...args),
      },
      promptService: {
        getActivePrompt: (...args) => promptService.getActivePrompt(...args),
      },
      toolService: {
        listAvailableTools: (...args) =>
          toolService.listAvailableTools(...args),
      },
    });
  });

  afterAll(async () => {
    // Cleanup
    for (const id of createdApprovalIds) {
      await supabase.from('approval_requests').delete().eq('id', id);
    }
    for (const id of createdKnowledgeIds) {
      await supabase.from('knowledge_items').delete().eq('id', id);
    }
    for (const id of createdChatIds) {
      await supabase.from('messages').delete().eq('chat_id', id);
      await supabase.from('chats').delete().eq('id', id);
    }
    for (const id of createdUserIds) {
      await supabase.from('ai_preferences').delete().eq('user_id', id);
      await supabase.from('profiles').delete().eq('user_id', id);
      await supabase.from('users').delete().eq('id', id);
    }
  });

  describe('Full Knowledge Lifecycle', () => {
    let testUserId: string;
    let testActor: ActorContext;
    let adminActor: ActorContext;
    let knowledgeItemId: string;
    let approvalRequestId: string;

    beforeAll(async () => {
      testUserId = testId('author');
      createdUserIds.push(testUserId);

      await supabase.from('users').insert({
        id: testUserId,
        email: `${testUserId}@test.com`,
        status: 'active',
      });

      testActor = createUserActor(testUserId);
      adminActor = createAdminActor();
    });

    it('Step 1: Create knowledge item (draft)', async () => {
      const result = await knowledgeService.createKnowledgeItem(testActor, {
        title: 'Company Holiday Policy',
        content:
          'All employees get 20 days paid leave per year. Unused leave can be carried over up to 5 days.',
        tags: ['hr', 'policy', 'benefits'],
      });

      expect(result.success).toBe(true);
      knowledgeItemId = result.data!.id;
      createdKnowledgeIds.push(knowledgeItemId);

      expect(result.data?.status).toBe('draft');
      expect(result.data?.title).toBe('Company Holiday Policy');
    });

    it('Step 2: Submit for review', async () => {
      const result = await knowledgeService.submitForReview(
        testActor,
        knowledgeItemId
      );

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('pending_review');

      // Should have created an approval request
      if (result.data?.approvalRequestId) {
        approvalRequestId = result.data.approvalRequestId;
        createdApprovalIds.push(approvalRequestId);
      }
    });

    it('Step 3: Admin can see pending approvals', async () => {
      const result = await approvalService.listPendingRequests(adminActor, {});

      expect(result.success).toBe(true);
      expect(result.data?.items.length).toBeGreaterThanOrEqual(1);

      // Find our request
      const ourRequest = result.data?.items.find(
        (r) => r.resourceId === knowledgeItemId
      );
      expect(ourRequest).toBeDefined();
      expect(ourRequest?.requestType).toBe('knowledge_publish');
    });

    it('Step 4: Admin approves the request', async () => {
      const result = await approvalService.approve(
        adminActor,
        approvalRequestId,
        {
          comment: 'Looks good, approved.',
        }
      );

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('approved');
    });

    it('Step 5: Knowledge item is now published', async () => {
      const result = await knowledgeService.getKnowledgeItem(
        testActor,
        knowledgeItemId
      );

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('published');
    });

    it('Step 6: Published knowledge appears in search', async () => {
      const searchResult = await knowledgeService.searchKnowledge(testActor, {
        query: 'holiday policy leave',
        limit: 10,
      });

      expect(searchResult.success).toBe(true);

      // Should find our published item
      const found = searchResult.data?.find((k) => k.id === knowledgeItemId);
      expect(found).toBeDefined();
    });

    it('Step 7: Knowledge is included in AI context', async () => {
      // Create a chat for the user
      const chatDb = createChatServiceDb(supabase);
      const chatService = createChatService({
        db: chatDb,
        auditService: { log: auditService.log },
      });

      const chatResult = await chatService.createChat(testActor, {
        title: 'Knowledge Test Chat',
      });
      expect(chatResult.success).toBe(true);
      createdChatIds.push(chatResult.data!.id);

      // Build context with query about holidays
      const contextResult = await contextService.buildContext(testActor, {
        chatId: chatResult.data!.id,
        userMessage: 'How many holiday days do I get?',
      });

      expect(contextResult.success).toBe(true);

      // Knowledge should be included in context
      const context = contextResult.data!;
      expect(context.knowledge).toBeDefined();
      // Note: Whether the specific item appears depends on vector similarity
    });
  });

  describe('Rejection Flow', () => {
    let testUserId: string;
    let testActor: ActorContext;
    let adminActor: ActorContext;
    let knowledgeItemId: string;
    let approvalRequestId: string;

    beforeAll(async () => {
      testUserId = testId('reject_author');
      createdUserIds.push(testUserId);

      await supabase.from('users').insert({
        id: testUserId,
        email: `${testUserId}@test.com`,
        status: 'active',
      });

      testActor = createUserActor(testUserId);
      adminActor = createAdminActor();
    });

    it('should handle rejection workflow', async () => {
      // Create and submit
      const createResult = await knowledgeService.createKnowledgeItem(
        testActor,
        {
          title: 'Incomplete Article',
          content: 'TODO: fill in details',
          tags: ['draft'],
        }
      );
      expect(createResult.success).toBe(true);
      knowledgeItemId = createResult.data!.id;
      createdKnowledgeIds.push(knowledgeItemId);

      // Submit for review
      const submitResult = await knowledgeService.submitForReview(
        testActor,
        knowledgeItemId
      );
      expect(submitResult.success).toBe(true);
      if (submitResult.data?.approvalRequestId) {
        approvalRequestId = submitResult.data.approvalRequestId;
        createdApprovalIds.push(approvalRequestId);
      }

      // Admin rejects
      const rejectResult = await approvalService.reject(
        adminActor,
        approvalRequestId,
        {
          comment: 'Content is incomplete. Please add more details.',
        }
      );
      expect(rejectResult.success).toBe(true);
      expect(rejectResult.data?.status).toBe('rejected');

      // Knowledge item should be back to draft
      const getResult = await knowledgeService.getKnowledgeItem(
        testActor,
        knowledgeItemId
      );
      expect(getResult.success).toBe(true);
      expect(getResult.data?.status).toBe('draft');
    });
  });

  describe('Access Control', () => {
    let authorId: string;
    let otherId: string;
    let authorActor: ActorContext;
    let otherActor: ActorContext;
    let knowledgeItemId: string;

    beforeAll(async () => {
      authorId = testId('kb_author');
      otherId = testId('kb_other');
      createdUserIds.push(authorId, otherId);

      await supabase.from('users').insert([
        { id: authorId, email: `${authorId}@test.com`, status: 'active' },
        { id: otherId, email: `${otherId}@test.com`, status: 'active' },
      ]);

      authorActor = createUserActor(authorId);
      otherActor = createUserActor(otherId);
    });

    it('draft items are only visible to author', async () => {
      // Create draft
      const createResult = await knowledgeService.createKnowledgeItem(
        authorActor,
        {
          title: 'Private Draft',
          content: 'Secret content',
          tags: [],
        }
      );
      expect(createResult.success).toBe(true);
      knowledgeItemId = createResult.data!.id;
      createdKnowledgeIds.push(knowledgeItemId);

      // Author can see it
      const authorGet = await knowledgeService.getKnowledgeItem(
        authorActor,
        knowledgeItemId
      );
      expect(authorGet.success).toBe(true);

      // Other user cannot see it
      const otherGet = await knowledgeService.getKnowledgeItem(
        otherActor,
        knowledgeItemId
      );
      expect(otherGet.success).toBe(false);
      expect(otherGet.error?.code).toBe('NOT_FOUND');
    });
  });
});
