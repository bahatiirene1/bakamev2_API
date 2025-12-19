/**
 * ContextService Integration Tests
 * Phase 2: Tests with real Supabase database
 *
 * These tests require:
 * - SUPABASE_URL environment variable
 * - SUPABASE_SERVICE_KEY environment variable
 * - All dependent services' tables to exist
 *
 * Tests are skipped if credentials are not available.
 *
 * SCOPE: Context assembly for AI orchestrator
 *
 * ContextService owns NO tables - it orchestrates other services:
 * - UserService (preferences)
 * - ChatService (messages)
 * - MemoryService (memories)
 * - KnowledgeService (RAG)
 * - PromptService (system prompt)
 * - ToolService (available tools)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import {
  createContextService,
  createUserService,
  createUserServiceDb,
  createChatService,
  createChatServiceDb,
  createMemoryService,
  createMemoryServiceDb,
  createToolService,
  createToolServiceDb,
  createPromptService,
  createPromptServiceDb,
  createKnowledgeService,
  createKnowledgeServiceDb,
  createAuditService,
  createAuditServiceDb,
  createApprovalService,
  createApprovalServiceDb,
  createSubscriptionService,
  createSubscriptionServiceDb,
} from '@/services/index.js';
import type {
  ContextService,
  UserService,
  ChatService,
  ToolService,
  PromptService,
  AuditService,
} from '@/services/index.js';
import type { ActorContext } from '@/types/index.js';
import { SYSTEM_ACTOR } from '@/types/index.js';

// Check if we have database credentials
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const HAS_CREDENTIALS =
  SUPABASE_URL !== undefined &&
  SUPABASE_URL !== '' &&
  SUPABASE_SERVICE_KEY !== undefined &&
  SUPABASE_SERVICE_KEY !== '';

// Test fixtures
const TEST_PREFIX = `context_test_${nanoid(6)}`;

function testId(prefix: string): string {
  return `${TEST_PREFIX}_${prefix}_${nanoid(6)}`;
}

function createTestActor(
  userId: string,
  overrides?: Partial<ActorContext>
): ActorContext {
  return {
    type: 'user',
    userId,
    requestId: testId('req'),
    permissions: ['chat:read', 'chat:write', 'memory:read', 'tool:read'],
    ...overrides,
  };
}

function createAdminActor(
  userId: string,
  overrides?: Partial<ActorContext>
): ActorContext {
  return {
    type: 'admin',
    userId,
    requestId: testId('req'),
    permissions: [
      'chat:read',
      'chat:write',
      'memory:read',
      'tool:read',
      'tool:manage',
      'prompt:read',
      'prompt:write',
      'prompt:review',
      'prompt:activate',
    ],
    ...overrides,
  };
}

describe.skipIf(!HAS_CREDENTIALS)('ContextService Integration', () => {
  let supabase: SupabaseClient;
  let contextService: ContextService;
  let userService: UserService;
  let chatService: ChatService;
  let toolService: ToolService;
  let promptService: PromptService;
  let auditService: AuditService;

  // Track created resources for cleanup
  const createdUserIds: string[] = [];
  const createdChatIds: string[] = [];
  const createdPromptIds: string[] = [];
  const createdToolIds: string[] = [];

  beforeAll(async () => {
    supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);

    // Create all service dependencies
    const auditDb = createAuditServiceDb(supabase);
    auditService = createAuditService({ db: auditDb });

    const userDb = createUserServiceDb(supabase);
    userService = createUserService({ db: userDb, auditService });

    const chatDb = createChatServiceDb(supabase);
    chatService = createChatService({ db: chatDb, auditService });

    const memoryDb = createMemoryServiceDb(supabase);
    const memoryService = createMemoryService({ db: memoryDb, auditService });

    const subscriptionDb = createSubscriptionServiceDb(supabase);
    const subscriptionService = createSubscriptionService({
      db: subscriptionDb,
      auditService,
    });

    const toolDb = createToolServiceDb(supabase);
    toolService = createToolService({
      db: toolDb,
      auditService,
      subscriptionService,
    });

    const approvalDb = createApprovalServiceDb(supabase);
    const approvalService = createApprovalService({
      db: approvalDb,
      auditService,
    });

    const knowledgeDb = createKnowledgeServiceDb(supabase);
    const knowledgeService = createKnowledgeService({
      db: knowledgeDb,
      auditService,
      approvalService,
    });

    const promptDb = createPromptServiceDb(supabase);
    promptService = createPromptService({ db: promptDb, auditService });

    // Create ContextService with all dependencies
    contextService = createContextService({
      userService: {
        getAIPreferences: async (actor, userId) => {
          const result = await userService.getAIPreferences(actor, userId);
          if (!result.success) {
            return result;
          }
          return {
            success: true,
            data: {
              responseLength: result.data.responseLength,
              formality: result.data.formality,
              customInstructions: result.data.customInstructions,
            },
          };
        },
      },
      chatService: {
        getChat: async (actor, chatId) => {
          const result = await chatService.getChat(actor, chatId);
          if (!result.success) {
            return result;
          }
          return { success: true, data: { userId: result.data.userId } };
        },
        getMessages: async (actor, chatId, params) => {
          const result = await chatService.getMessages(actor, chatId, params);
          if (!result.success) {
            return {
              success: false,
              error: result.error,
            };
          }
          return {
            success: true,
            data: {
              items: result.data.items.map((m) => ({
                role: m.role,
                content: m.content,
                createdAt: m.createdAt,
              })),
            },
          };
        },
        addMessage: async (actor, chatId, params) => {
          // Real ChatService takes (actor, params) where params includes chatId
          const result = await chatService.addMessage(actor, {
            chatId,
            ...params,
          });
          if (!result.success) {
            return result;
          }
          return { success: true, data: { id: result.data.id } };
        },
      },
      memoryService: {
        searchMemories: async (actor, params) => {
          // Real MemoryService takes (actor, userId, searchParams)
          const { userId, ...searchParams } = params;
          const result = await memoryService.searchMemories(
            actor,
            userId,
            searchParams
          );
          if (!result.success) {
            return result;
          }
          return {
            success: true,
            data: result.data.map((m) => ({
              content: m.content,
              category: m.category,
              importance: m.importance,
              similarity: m.similarity,
            })),
          };
        },
      },
      knowledgeService: {
        searchKnowledge: async (actor, params) => {
          const result = await knowledgeService.searchKnowledge(actor, params);
          if (!result.success) {
            return result;
          }
          return {
            success: true,
            data: result.data.map((k) => ({
              title: k.title,
              content: k.content,
              similarity: k.similarity,
            })),
          };
        },
      },
      promptService: {
        getActivePrompt: async (actor) => {
          const result = await promptService.getActivePrompt(actor);
          if (!result.success) {
            return result;
          }
          return { success: true, data: { content: result.data.content } };
        },
      },
      toolService: {
        listAvailableTools: async (actor) => {
          const result = await toolService.listAvailableTools(actor);
          if (!result.success) {
            return {
              success: false,
              error: result.error,
            };
          }
          // Real ToolService returns Tool[] directly
          return { success: true, data: { items: result.data } };
        },
      },
    });
  });

  afterAll(async () => {
    // Cleanup in reverse order
    if (createdPromptIds.length > 0) {
      await supabase.from('system_prompts').delete().in('id', createdPromptIds);
    }
    if (createdToolIds.length > 0) {
      await supabase.from('tools').delete().in('id', createdToolIds);
    }
    if (createdChatIds.length > 0) {
      await supabase.from('chats').delete().in('id', createdChatIds);
    }
    if (createdUserIds.length > 0) {
      await supabase.from('users').delete().in('id', createdUserIds);
    }
  });

  async function createTestUser(): Promise<string> {
    const userId = testId('user');
    const email = `${userId}@test.example.com`;
    await userService.onUserSignup(SYSTEM_ACTOR, {
      authUserId: userId,
      email,
    });
    createdUserIds.push(userId);
    return userId;
  }

  async function createTestChat(userId: string): Promise<string> {
    const actor = createTestActor(userId);
    const result = await chatService.createChat(actor, {
      title: testId('chat'),
    });
    if (result.success) {
      createdChatIds.push(result.data.id);
      return result.data.id;
    }
    throw new Error('Failed to create test chat');
  }

  // ─────────────────────────────────────────────────────────────
  // buildContext
  // ─────────────────────────────────────────────────────────────

  describe('buildContext', () => {
    it('should build context for a valid chat', async () => {
      const userId = await createTestUser();
      const chatId = await createTestChat(userId);
      const actor = createTestActor(userId);

      const result = await contextService.buildContext(actor, {
        chatId,
        userMessage: 'Hello, how are you?',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.version).toBe('v1');
        expect(result.data.chatId).toBe(chatId);
        expect(result.data.userId).toBe(userId);
        expect(result.data.coreInstructions).toBeDefined();
        expect(result.data.systemPrompt).toBeDefined();
        expect(result.data.userPreferences).toBeDefined();
        expect(result.data.memories).toBeDefined();
        expect(result.data.knowledge).toBeDefined();
        expect(result.data.messages).toBeDefined();
        expect(result.data.tools).toBeDefined();
      }
    });

    it('should return NOT_FOUND for non-existent chat', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      const result = await contextService.buildContext(actor, {
        chatId: '00000000-0000-0000-0000-000000000000',
        userMessage: 'Hello',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should include messages from chat history', async () => {
      const userId = await createTestUser();
      const chatId = await createTestChat(userId);
      const actor = createTestActor(userId);

      // Add a message first (real ChatService takes chatId inside params)
      await chatService.addMessage(actor, {
        chatId,
        role: 'user',
        content: 'First message',
      });

      const result = await contextService.buildContext(actor, {
        chatId,
        userMessage: 'Second message',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.messages.length).toBeGreaterThanOrEqual(1);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // getAvailableTools
  // ─────────────────────────────────────────────────────────────

  describe('getAvailableTools', () => {
    it('should return available tools', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      const result = await contextService.getAvailableTools(actor);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(Array.isArray(result.data)).toBe(true);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // persistResponse
  // ─────────────────────────────────────────────────────────────

  describe('persistResponse', () => {
    it('should persist AI response to chat', async () => {
      const userId = await createTestUser();
      const chatId = await createTestChat(userId);
      const actor = createTestActor(userId);

      const result = await contextService.persistResponse(actor, {
        chatId,
        response: {
          content: 'This is the AI response.',
          model: 'claude-3',
          tokenCount: 50,
        },
      });

      expect(result.success).toBe(true);

      // Verify message was added
      const messagesResult = await chatService.getMessages(actor, chatId, {
        limit: 10,
      });
      expect(messagesResult.success).toBe(true);
      if (messagesResult.success) {
        const aiMessages = messagesResult.data.items.filter(
          (m) => m.role === 'assistant'
        );
        expect(aiMessages.length).toBeGreaterThanOrEqual(1);
        expect(aiMessages[0].content).toBe('This is the AI response.');
      }
    });

    it('should include model and token count in metadata', async () => {
      const userId = await createTestUser();
      const chatId = await createTestChat(userId);
      const actor = createTestActor(userId);

      await contextService.persistResponse(actor, {
        chatId,
        response: {
          content: 'Response with metadata.',
          model: 'claude-3-opus',
          tokenCount: 150,
        },
      });

      // Verify message has correct metadata
      const messagesResult = await chatService.getMessages(actor, chatId, {
        limit: 10,
      });
      expect(messagesResult.success).toBe(true);
      if (messagesResult.success) {
        const aiMessage = messagesResult.data.items.find(
          (m) =>
            m.role === 'assistant' && m.content === 'Response with metadata.'
        );
        expect(aiMessage).toBeDefined();
        if (aiMessage?.metadata) {
          expect(aiMessage.metadata.model).toBe('claude-3-opus');
          expect(aiMessage.metadata.tokenCount).toBe(150);
          expect(aiMessage.metadata.actorType).toBe('ai');
        }
      }
    });

    it('should return NOT_FOUND for non-existent chat', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      const result = await contextService.persistResponse(actor, {
        chatId: '00000000-0000-0000-0000-000000000000',
        response: {
          content: 'Response',
          model: 'claude-3',
          tokenCount: 10,
        },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });
});
