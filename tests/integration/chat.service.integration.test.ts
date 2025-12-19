/**
 * ChatService Integration Tests
 * Phase 2: Tests with real Supabase database
 *
 * These tests require:
 * - SUPABASE_URL environment variable
 * - SUPABASE_SERVICE_KEY environment variable
 * - Database with chats, messages tables
 *
 * Tests are skipped if credentials are not available.
 *
 * SCOPE: Conversation management (persistence-only)
 * NOT IN SCOPE: AI orchestration
 *
 * CRITICAL: Messages are IMMUTABLE (append-only)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import {
  createChatService,
  createChatServiceDb,
  createAuditService,
  createAuditServiceDb,
  createUserService,
  createUserServiceDb,
} from '@/services/index.js';
import type {
  ChatService,
  AuditService,
  UserService,
} from '@/services/index.js';
import type { ActorContext } from '@/types/index.js';
import { SYSTEM_ACTOR, AI_ACTOR } from '@/types/index.js';

// Check if we have database credentials
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const HAS_CREDENTIALS =
  SUPABASE_URL !== undefined &&
  SUPABASE_URL !== '' &&
  SUPABASE_SERVICE_KEY !== undefined &&
  SUPABASE_SERVICE_KEY !== '';

// Test fixtures - use nanoid for unique test identifiers
const TEST_PREFIX = `chat_test_${nanoid(6)}`;

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
    permissions: ['chat:read', 'chat:write'],
    ...overrides,
  };
}

// Helper to create admin actor
function createAdminActor(overrides?: Partial<ActorContext>): ActorContext {
  return {
    type: 'admin',
    userId: testId('admin'),
    requestId: testId('req'),
    permissions: ['chat:read', 'chat:write', 'chat:manage'],
    ...overrides,
  };
}

describe.skipIf(!HAS_CREDENTIALS)('ChatService Integration', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let supabase: SupabaseClient<any, 'public', any>;
  let chatService: ChatService;
  let auditService: AuditService;
  let userService: UserService;

  // Track created resources for cleanup
  const createdUserIds: string[] = [];
  const createdChatIds: string[] = [];

  beforeAll(async () => {
    // Create Supabase client with service key (bypasses RLS)
    supabase = createClient(
      SUPABASE_URL!,
      SUPABASE_SERVICE_KEY!
    ) as SupabaseClient<any, 'public', any>;

    // Create database adapters and services
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const auditDb = createAuditServiceDb(supabase);
    auditService = createAuditService({ db: auditDb });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const userDb = createUserServiceDb(supabase);
    userService = createUserService({ db: userDb, auditService });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const chatDb = createChatServiceDb(supabase);
    chatService = createChatService({ db: chatDb, auditService });
  });

  afterAll(async () => {
    // Cleanup test data
    try {
      // Delete chats first (cascades to messages)
      for (const chatId of createdChatIds) {
        await supabase.from('messages').delete().eq('chat_id', chatId);
        await supabase.from('chats').delete().eq('id', chatId);
      }
      // Delete users (cascades to profiles and ai_preferences)
      for (const userId of createdUserIds) {
        await supabase.from('ai_preferences').delete().eq('user_id', userId);
        await supabase.from('profiles').delete().eq('user_id', userId);
        await supabase.from('users').delete().eq('id', userId);
      }
      // Clean up audit logs
      await supabase
        .from('audit_logs')
        .delete()
        .like('request_id', `${TEST_PREFIX}%`);
    } catch {
      // Cleanup failure is acceptable - tests use unique prefixes
    }
  });

  // Helper to create a test user
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

  // ─────────────────────────────────────────────────────────────
  // CREATE CHAT
  // ─────────────────────────────────────────────────────────────

  describe('createChat', () => {
    it('should create a new chat in database', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      const result = await chatService.createChat(actor, {
        title: 'Test Chat',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        createdChatIds.push(result.data.id);
        expect(result.data.userId).toBe(userId);
        expect(result.data.title).toBe('Test Chat');
        expect(result.data.status).toBe('active');

        // Verify in database
        const { data: chat } = await supabase
          .from('chats')
          .select('*')
          .eq('id', result.data.id)
          .single();
        expect(chat).not.toBeNull();
        expect(chat?.title).toBe('Test Chat');
      }
    });

    it('should create chat with metadata', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      const result = await chatService.createChat(actor, {
        metadata: { source: 'web', version: 1 },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        createdChatIds.push(result.data.id);
        expect(result.data.metadata).toEqual({ source: 'web', version: 1 });
      }
    });

    it('should emit audit event on creation', async () => {
      const userId = await createTestUser();
      const requestId = testId('req');
      const actor = createTestActor(userId, { requestId });

      const result = await chatService.createChat(actor, {
        title: 'Audit Test',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        createdChatIds.push(result.data.id);

        // Verify audit log
        const { data: logs } = await supabase
          .from('audit_logs')
          .select('*')
          .eq('action', 'chat:created')
          .eq('resource_id', result.data.id);
        expect(logs?.length).toBeGreaterThan(0);
      }
    });

    it('should reject AI_ACTOR from creating chats', async () => {
      const result = await chatService.createChat(AI_ACTOR, {
        title: 'AI Chat',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // GET CHAT
  // ─────────────────────────────────────────────────────────────

  describe('getChat', () => {
    it('should return chat for owner', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      const createResult = await chatService.createChat(actor, {
        title: 'Get Test',
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdChatIds.push(createResult.data.id);

      const result = await chatService.getChat(actor, createResult.data.id);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(createResult.data.id);
        expect(result.data.title).toBe('Get Test');
      }
    });

    it('should allow AI_ACTOR to read chats', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      const createResult = await chatService.createChat(actor, {
        title: 'AI Read Test',
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdChatIds.push(createResult.data.id);

      const result = await chatService.getChat(AI_ACTOR, createResult.data.id);

      expect(result.success).toBe(true);
    });

    it('should deny access to other user chats without permission', async () => {
      const userId1 = await createTestUser();
      const userId2 = await createTestUser();
      const actor1 = createTestActor(userId1);
      const actor2 = createTestActor(userId2, { permissions: [] });

      const createResult = await chatService.createChat(actor1, {
        title: 'Private Chat',
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdChatIds.push(createResult.data.id);

      const result = await chatService.getChat(actor2, createResult.data.id);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // LIST CHATS
  // ─────────────────────────────────────────────────────────────

  describe('listChats', () => {
    it('should list user chats with pagination', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      // Create multiple chats
      for (let i = 0; i < 3; i++) {
        const result = await chatService.createChat(actor, {
          title: `Chat ${i}`,
        });
        if (result.success) {
          createdChatIds.push(result.data.id);
        }
      }

      const result = await chatService.listChats(actor, { limit: 2 });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.items.length).toBeLessThanOrEqual(2);
      }
    });

    it('should filter by status', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      // Create and archive a chat
      const createResult = await chatService.createChat(actor, {
        title: 'Archive Test',
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdChatIds.push(createResult.data.id);

      await chatService.archiveChat(actor, createResult.data.id);

      // List archived chats
      const result = await chatService.listChats(actor, {
        limit: 10,
        status: 'archived',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        const found = result.data.items.find(
          (c) => c.id === createResult.data.id
        );
        expect(found).toBeDefined();
        expect(found?.status).toBe('archived');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // UPDATE CHAT
  // ─────────────────────────────────────────────────────────────

  describe('updateChat', () => {
    it('should update chat title', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      const createResult = await chatService.createChat(actor, {
        title: 'Original',
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdChatIds.push(createResult.data.id);

      const result = await chatService.updateChat(actor, createResult.data.id, {
        title: 'Updated',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.title).toBe('Updated');
      }

      // Verify in database
      const { data: chat } = await supabase
        .from('chats')
        .select('title')
        .eq('id', createResult.data.id)
        .single();
      expect(chat?.title).toBe('Updated');
    });

    it('should reject AI_ACTOR from updating', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      const createResult = await chatService.createChat(actor, {
        title: 'Test',
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdChatIds.push(createResult.data.id);

      const result = await chatService.updateChat(
        AI_ACTOR,
        createResult.data.id,
        {
          title: 'AI Update',
        }
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // ARCHIVE CHAT
  // ─────────────────────────────────────────────────────────────

  describe('archiveChat', () => {
    it('should archive chat and update status', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      const createResult = await chatService.createChat(actor, {
        title: 'Archive Test',
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdChatIds.push(createResult.data.id);

      const result = await chatService.archiveChat(actor, createResult.data.id);

      expect(result.success).toBe(true);

      // Verify in database
      const { data: chat } = await supabase
        .from('chats')
        .select('status')
        .eq('id', createResult.data.id)
        .single();
      expect(chat?.status).toBe('archived');
    });

    it('should emit audit event on archive', async () => {
      const userId = await createTestUser();
      const requestId = testId('req');
      const actor = createTestActor(userId, { requestId });

      const createResult = await chatService.createChat(actor, {
        title: 'Audit Archive',
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdChatIds.push(createResult.data.id);

      await chatService.archiveChat(actor, createResult.data.id);

      // Verify audit log
      const { data: logs } = await supabase
        .from('audit_logs')
        .select('*')
        .eq('action', 'chat:archived')
        .eq('resource_id', createResult.data.id);
      expect(logs?.length).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // ADD MESSAGE
  // ─────────────────────────────────────────────────────────────

  describe('addMessage', () => {
    it('should add message to chat', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      const createResult = await chatService.createChat(actor, {
        title: 'Message Test',
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdChatIds.push(createResult.data.id);

      const result = await chatService.addMessage(actor, {
        chatId: createResult.data.id,
        role: 'user',
        content: 'Hello, world!',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.chatId).toBe(createResult.data.id);
        expect(result.data.content).toBe('Hello, world!');
        expect(result.data.role).toBe('user');
      }

      // Verify in database
      const { data: messages } = await supabase
        .from('messages')
        .select('*')
        .eq('chat_id', createResult.data.id);
      expect(messages?.length).toBe(1);
    });

    it('should allow AI_ACTOR to add messages', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      const createResult = await chatService.createChat(actor, {
        title: 'AI Message Test',
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdChatIds.push(createResult.data.id);

      const result = await chatService.addMessage(AI_ACTOR, {
        chatId: createResult.data.id,
        role: 'assistant',
        content: 'AI response',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.role).toBe('assistant');
      }
    });

    it('should add message with metadata', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      const createResult = await chatService.createChat(actor, {
        title: 'Metadata Test',
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdChatIds.push(createResult.data.id);

      const result = await chatService.addMessage(actor, {
        chatId: createResult.data.id,
        role: 'assistant',
        content: 'Response with metadata',
        metadata: { model: 'gpt-4', tokenCount: 100 },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.metadata.model).toBe('gpt-4');
        expect(result.data.metadata.tokenCount).toBe(100);
      }
    });

    it('should not add message to archived chat', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      const createResult = await chatService.createChat(actor, {
        title: 'Archived Chat',
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdChatIds.push(createResult.data.id);

      await chatService.archiveChat(actor, createResult.data.id);

      const result = await chatService.addMessage(actor, {
        chatId: createResult.data.id,
        role: 'user',
        content: 'Should fail',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // GET MESSAGES
  // ─────────────────────────────────────────────────────────────

  describe('getMessages', () => {
    it('should return messages in chronological order', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      const createResult = await chatService.createChat(actor, {
        title: 'Order Test',
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdChatIds.push(createResult.data.id);

      // Add multiple messages
      await chatService.addMessage(actor, {
        chatId: createResult.data.id,
        role: 'user',
        content: 'First',
      });
      await chatService.addMessage(actor, {
        chatId: createResult.data.id,
        role: 'assistant',
        content: 'Second',
      });
      await chatService.addMessage(actor, {
        chatId: createResult.data.id,
        role: 'user',
        content: 'Third',
      });

      const result = await chatService.getMessages(
        actor,
        createResult.data.id,
        {
          limit: 10,
        }
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.items.length).toBe(3);
        expect(result.data.items[0].content).toBe('First');
        expect(result.data.items[1].content).toBe('Second');
        expect(result.data.items[2].content).toBe('Third');
      }
    });

    it('should allow AI_ACTOR to read messages', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      const createResult = await chatService.createChat(actor, {
        title: 'AI Read Messages',
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdChatIds.push(createResult.data.id);

      await chatService.addMessage(actor, {
        chatId: createResult.data.id,
        role: 'user',
        content: 'Test message',
      });

      const result = await chatService.getMessages(
        AI_ACTOR,
        createResult.data.id,
        {
          limit: 10,
        }
      );

      expect(result.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // REDACT MESSAGE
  // ─────────────────────────────────────────────────────────────

  describe('redactMessage', () => {
    it('should redact message by setting metadata flag', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      const createResult = await chatService.createChat(actor, {
        title: 'Redact Test',
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdChatIds.push(createResult.data.id);

      const msgResult = await chatService.addMessage(actor, {
        chatId: createResult.data.id,
        role: 'user',
        content: 'Content to redact',
      });
      expect(msgResult.success).toBe(true);
      if (!msgResult.success) {
        return;
      }

      const result = await chatService.redactMessage(
        actor,
        msgResult.data.id,
        'Inappropriate content'
      );

      expect(result.success).toBe(true);

      // Verify in database - content preserved but marked redacted
      const { data: message } = await supabase
        .from('messages')
        .select('content, metadata')
        .eq('id', msgResult.data.id)
        .single();

      expect(message?.content).toBe('Content to redact'); // Content preserved
      expect((message?.metadata as Record<string, unknown>)?.redacted).toBe(
        true
      );
      expect(
        (message?.metadata as Record<string, unknown>)?.redactedReason
      ).toBe('Inappropriate content');
    });

    it('should emit audit event on redaction', async () => {
      const userId = await createTestUser();
      const requestId = testId('req');
      const actor = createTestActor(userId, { requestId });

      const createResult = await chatService.createChat(actor, {
        title: 'Audit Redact',
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdChatIds.push(createResult.data.id);

      const msgResult = await chatService.addMessage(actor, {
        chatId: createResult.data.id,
        role: 'user',
        content: 'To redact',
      });
      expect(msgResult.success).toBe(true);
      if (!msgResult.success) {
        return;
      }

      await chatService.redactMessage(actor, msgResult.data.id, 'Test reason');

      // Verify audit log
      const { data: logs } = await supabase
        .from('audit_logs')
        .select('*')
        .eq('action', 'message:redacted')
        .eq('resource_id', msgResult.data.id);
      expect(logs?.length).toBeGreaterThan(0);
    });

    it('should reject AI_ACTOR from redacting', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);

      const createResult = await chatService.createChat(actor, {
        title: 'AI Redact Test',
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdChatIds.push(createResult.data.id);

      const msgResult = await chatService.addMessage(actor, {
        chatId: createResult.data.id,
        role: 'user',
        content: 'Test',
      });
      expect(msgResult.success).toBe(true);
      if (!msgResult.success) {
        return;
      }

      const result = await chatService.redactMessage(
        AI_ACTOR,
        msgResult.data.id,
        'AI reason'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });
});
