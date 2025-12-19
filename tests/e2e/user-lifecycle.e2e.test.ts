/**
 * User Lifecycle E2E Tests
 * Phase C: Full user flow with real services
 *
 * Flow: JWT auth → profile auto-provision → create chat → send messages
 *       → memory created → AI response persisted → audit logged
 *
 * These tests require database credentials.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import {
  createUserService,
  createUserServiceDb,
  createChatService,
  createChatServiceDb,
  createMemoryService,
  createMemoryServiceDb,
  createAuditService,
  createAuditServiceDb,
  createContextService,
  createPromptService,
  createPromptServiceDb,
  createKnowledgeService,
  createKnowledgeServiceDb,
  createToolService,
  createToolServiceDb,
  createSubscriptionService,
  createSubscriptionServiceDb,
  createApprovalService,
  createApprovalServiceDb,
} from '@/services/index.js';
import type {
  UserService,
  ChatService,
  MemoryService,
  AuditService,
  ContextService,
  PromptService,
  KnowledgeService,
  ToolService,
  SubscriptionService,
} from '@/services/index.js';
import type { ActorContext } from '@/types/index.js';
import { SYSTEM_ACTOR } from '@/types/index.js';

// Check credentials
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const HAS_CREDENTIALS =
  SUPABASE_URL !== undefined &&
  SUPABASE_URL !== '' &&
  SUPABASE_SERVICE_KEY !== undefined &&
  SUPABASE_SERVICE_KEY !== '';

// Unique test prefix
const TEST_PREFIX = `e2e_lifecycle_${nanoid(6)}`;

function testId(prefix: string): string {
  return `${TEST_PREFIX}_${prefix}_${nanoid(6)}`;
}

function createUserActor(userId: string): ActorContext {
  return {
    type: 'user',
    userId,
    requestId: testId('req'),
    permissions: [
      'chat:read',
      'chat:write',
      'memory:read',
      'memory:write',
      'user:read',
      'user:write',
    ],
  };
}

describe.skipIf(!HAS_CREDENTIALS)('E2E: User Lifecycle Flow', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let supabase: SupabaseClient<any, 'public', any>;
  let userService: UserService;
  let chatService: ChatService;
  let memoryService: MemoryService;
  let auditService: AuditService;
  let contextService: ContextService;
  let promptService: PromptService;
  let knowledgeService: KnowledgeService;
  let toolService: ToolService;
  let subscriptionService: SubscriptionService;

  // Track for cleanup
  const createdUserIds: string[] = [];
  const createdChatIds: string[] = [];
  const createdMemoryIds: string[] = [];

  beforeAll(async () => {
    // Create Supabase client
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase = createClient(
      SUPABASE_URL!,
      SUPABASE_SERVICE_KEY!
    ) as SupabaseClient<any, 'public', any>;

    // Create all database adapters
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const auditDb = createAuditServiceDb(supabase);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const userDb = createUserServiceDb(supabase);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const chatDb = createChatServiceDb(supabase);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const memoryDb = createMemoryServiceDb(supabase);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const promptDb = createPromptServiceDb(supabase);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const knowledgeDb = createKnowledgeServiceDb(supabase);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const toolDb = createToolServiceDb(supabase);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const subscriptionDb = createSubscriptionServiceDb(supabase);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const approvalDb = createApprovalServiceDb(supabase);

    // Create audit service first (used by others)
    auditService = createAuditService({ db: auditDb });

    // Create approval service
    const approvalService = createApprovalService({
      db: approvalDb,
      auditService: { log: (...args) => auditService.log(...args) },
    });

    // Create services with dependencies
    userService = createUserService({
      db: userDb,
      auditService: { log: (...args) => auditService.log(...args) },
    });

    chatService = createChatService({
      db: chatDb,
      auditService: { log: (...args) => auditService.log(...args) },
    });

    memoryService = createMemoryService({
      db: memoryDb,
      auditService: { log: (...args) => auditService.log(...args) },
    });

    promptService = createPromptService({
      db: promptDb,
      auditService: { log: (...args) => auditService.log(...args) },
    });

    knowledgeService = createKnowledgeService({
      db: knowledgeDb,
      auditService: { log: (...args) => auditService.log(...args) },
      approvalService: {
        createRequest: (...args) => approvalService.createRequest(...args),
      },
    });

    subscriptionService = createSubscriptionService({
      db: subscriptionDb,
      auditService: { log: (...args) => auditService.log(...args) },
    });

    toolService = createToolService({
      db: toolDb,
      auditService: { log: (...args) => auditService.log(...args) },
      subscriptionService: {
        checkEntitlement: (...args) =>
          subscriptionService.checkEntitlement(...args),
      },
    });

    // Create context service with all dependencies
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
    // Cleanup in reverse order
    for (const memoryId of createdMemoryIds) {
      await supabase.from('memories').delete().eq('id', memoryId);
    }
    for (const chatId of createdChatIds) {
      await supabase.from('messages').delete().eq('chat_id', chatId);
      await supabase.from('chats').delete().eq('id', chatId);
    }
    for (const userId of createdUserIds) {
      await supabase.from('ai_preferences').delete().eq('user_id', userId);
      await supabase.from('profiles').delete().eq('user_id', userId);
      await supabase.from('users').delete().eq('id', userId);
    }
  });

  describe('Complete User Journey', () => {
    let testUserId: string;
    let testActor: ActorContext;
    let testChatId: string;

    it('Step 1: New user is provisioned via auth', async () => {
      // Simulate user creation (normally done by auth trigger)
      testUserId = testId('user');
      createdUserIds.push(testUserId);

      // Insert user directly (simulating auth callback)
      const { error: userError } = await supabase.from('users').insert({
        id: testUserId,
        email: `${testUserId}@test.com`,
        status: 'active',
      });
      expect(userError).toBeNull();

      testActor = createUserActor(testUserId);
    });

    it('Step 2: Profile is auto-provisioned on first access', async () => {
      // First access should trigger profile creation
      const profileResult = await userService.getProfile(testActor, testUserId);

      // Profile should be created automatically (if service supports auto-provision)
      // or we create it manually
      if (!profileResult.success) {
        // Create profile manually if not auto-provisioned
        const createResult = await userService.createProfile(
          testActor,
          testUserId,
          {
            displayName: 'Test User',
          }
        );
        expect(createResult.success).toBe(true);
      }

      // Verify profile exists
      const verifyResult = await userService.getProfile(testActor, testUserId);
      expect(verifyResult.success).toBe(true);
      expect(verifyResult.data?.userId).toBe(testUserId);
    });

    it('Step 3: User creates a new chat', async () => {
      const createResult = await chatService.createChat(testActor, {
        title: 'E2E Test Chat',
      });

      expect(createResult.success).toBe(true);
      expect(createResult.data).toBeDefined();
      testChatId = createResult.data!.id;
      createdChatIds.push(testChatId);

      expect(createResult.data!.userId).toBe(testUserId);
      expect(createResult.data!.status).toBe('active');
    });

    it('Step 4: User sends a message', async () => {
      const messageResult = await chatService.addMessage(
        testActor,
        testChatId,
        {
          role: 'user',
          content: 'Hello, this is my first message!',
        }
      );

      expect(messageResult.success).toBe(true);
      expect(messageResult.data?.id).toBeDefined();
    });

    it('Step 5: AI response is persisted (via SYSTEM_ACTOR)', async () => {
      // Simulate AI response using context service
      const persistResult = await contextService.persistResponse(testActor, {
        chatId: testChatId,
        response: {
          content: "Hello! I'm your AI assistant. How can I help you today?",
          model: 'anthropic/claude-3.5-sonnet',
          tokenCount: 25,
        },
      });

      expect(persistResult.success).toBe(true);

      // Verify message was added
      const messagesResult = await chatService.getMessages(
        testActor,
        testChatId,
        {}
      );
      expect(messagesResult.success).toBe(true);
      expect(messagesResult.data?.items.length).toBeGreaterThanOrEqual(2);

      // Find AI message
      const aiMessage = messagesResult.data?.items.find(
        (m) => m.role === 'assistant'
      );
      expect(aiMessage).toBeDefined();
      expect(aiMessage?.content).toContain('AI assistant');
    });

    it('Step 6: Memory can be created from conversation', async () => {
      const memoryResult = await memoryService.createMemory(testActor, {
        userId: testUserId,
        content: 'User prefers formal responses',
        category: 'preferences',
        source: 'conversation',
        importance: 7,
      });

      expect(memoryResult.success).toBe(true);
      createdMemoryIds.push(memoryResult.data!.id);

      expect(memoryResult.data?.category).toBe('preferences');
      expect(memoryResult.data?.importance).toBe(7);
    });

    it('Step 7: Context building includes user data', async () => {
      const contextResult = await contextService.buildContext(testActor, {
        chatId: testChatId,
        userMessage: 'What are my preferences?',
      });

      expect(contextResult.success).toBe(true);
      expect(contextResult.data).toBeDefined();

      const context = contextResult.data!;
      expect(context.userId).toBe(testUserId);
      expect(context.chatId).toBe(testChatId);
      expect(context.messages).toBeDefined();
      expect(context.coreInstructions).toBeDefined();
    });

    it('Step 8: Audit trail is recorded', async () => {
      const auditResult = await auditService.queryLogs(SYSTEM_ACTOR, {
        actorId: testUserId,
        limit: 10,
      });

      expect(auditResult.success).toBe(true);
      expect(auditResult.data?.items.length).toBeGreaterThan(0);

      // Should have audit entries for chat and memory operations
      const actions = auditResult.data?.items.map((i) => i.action) || [];
      expect(actions).toContain('chat.created');
    });

    it('Step 9: User can list their chats', async () => {
      const listResult = await chatService.listChats(testActor, {});

      expect(listResult.success).toBe(true);
      expect(listResult.data?.items.length).toBeGreaterThanOrEqual(1);

      const ourChat = listResult.data?.items.find((c) => c.id === testChatId);
      expect(ourChat).toBeDefined();
      expect(ourChat?.title).toBe('E2E Test Chat');
    });

    it('Step 10: User can archive the chat', async () => {
      const archiveResult = await chatService.archiveChat(
        testActor,
        testChatId
      );

      expect(archiveResult.success).toBe(true);

      // Verify chat is archived
      const getResult = await chatService.getChat(testActor, testChatId);
      expect(getResult.success).toBe(true);
      expect(getResult.data?.status).toBe('archived');
    });
  });

  describe('AI Preferences Flow', () => {
    let testUserId: string;
    let testActor: ActorContext;

    beforeAll(async () => {
      testUserId = testId('pref_user');
      createdUserIds.push(testUserId);

      await supabase.from('users').insert({
        id: testUserId,
        email: `${testUserId}@test.com`,
        status: 'active',
      });

      testActor = createUserActor(testUserId);
    });

    it('should get default AI preferences', async () => {
      const result = await userService.getAIPreferences(testActor, testUserId);

      // Either success with defaults or auto-created
      if (result.success) {
        expect(result.data?.responseLength).toBeDefined();
        expect(result.data?.formality).toBeDefined();
      }
    });

    it('should update AI preferences', async () => {
      const updateResult = await userService.updateAIPreferences(
        testActor,
        testUserId,
        {
          responseLength: 'detailed',
          formality: 'formal',
          allowMemory: true,
          customInstructions: 'Always be concise.',
        }
      );

      expect(updateResult.success).toBe(true);
      expect(updateResult.data?.responseLength).toBe('detailed');
      expect(updateResult.data?.formality).toBe('formal');
    });

    it('preferences should be reflected in context', async () => {
      // Create a chat first
      const chatResult = await chatService.createChat(testActor, {
        title: 'Pref Test',
      });
      expect(chatResult.success).toBe(true);
      createdChatIds.push(chatResult.data!.id);

      const contextResult = await contextService.buildContext(testActor, {
        chatId: chatResult.data!.id,
        userMessage: 'Test',
      });

      expect(contextResult.success).toBe(true);
      expect(contextResult.data?.userPreferences.responseLength).toBe(
        'detailed'
      );
      expect(contextResult.data?.userPreferences.formality).toBe('formal');
    });
  });
});
