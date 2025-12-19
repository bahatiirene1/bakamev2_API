/**
 * ChatService Unit Tests
 * Phase 2: TDD - RED phase
 *
 * Reference: docs/stage-2-service-layer.md Section 3.3
 *
 * SCOPE: Conversation management (persistence-only)
 * NOT IN SCOPE: AI orchestration, prompt construction, tool execution
 *
 * CRITICAL POLICY: Messages are IMMUTABLE (append-only)
 * - No updateMessage method
 * - No deleteMessage method
 * - Redaction = soft delete (metadata.redacted = true)
 *
 * GUARDRAILS:
 * - Users can only access their own chats
 * - AI_ACTOR CAN read chats/messages (for context assembly)
 * - AI_ACTOR CAN add messages (for assistant responses)
 * - AI_ACTOR CANNOT create/update/archive chats
 * - AI_ACTOR CANNOT redact messages
 * - All mutations (archive, redact) emit audit events
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import type {
  ChatService,
  ChatServiceDb,
  ChatServiceAudit,
} from '@/services/chat.service.js';
import { createChatService } from '@/services/chat.service.js';
import type {
  ActorContext,
  Chat,
  ChatSummary,
  Message,
  PaginatedResult,
} from '@/types/index.js';
import { AI_ACTOR, SYSTEM_ACTOR } from '@/types/index.js';

// ─────────────────────────────────────────────────────────────
// TEST FIXTURES
// ─────────────────────────────────────────────────────────────

const TEST_USER_ID = 'test-user-123';
const TEST_OTHER_USER_ID = 'test-other-user-456';
const TEST_CHAT_ID = 'test-chat-789';
const TEST_MESSAGE_ID = 'test-message-abc';
const TEST_REQUEST_ID = 'test-request-xyz';

const mockChat: Chat = {
  id: TEST_CHAT_ID,
  userId: TEST_USER_ID,
  title: 'Test Chat',
  status: 'active',
  metadata: {},
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const mockChatSummary: ChatSummary = {
  id: TEST_CHAT_ID,
  title: 'Test Chat',
  status: 'active',
  lastMessageAt: new Date('2024-01-01'),
  messageCount: 5,
  createdAt: new Date('2024-01-01'),
};

const mockMessage: Message = {
  id: TEST_MESSAGE_ID,
  chatId: TEST_CHAT_ID,
  role: 'user',
  content: 'Hello, world!',
  metadata: {},
  createdAt: new Date('2024-01-01'),
};

function createTestActor(overrides?: Partial<ActorContext>): ActorContext {
  return {
    type: 'user',
    userId: TEST_USER_ID,
    requestId: TEST_REQUEST_ID,
    permissions: ['chat:read', 'chat:write'],
    ...overrides,
  };
}

function createAdminActor(overrides?: Partial<ActorContext>): ActorContext {
  return {
    type: 'admin',
    userId: 'admin-user-id',
    requestId: TEST_REQUEST_ID,
    permissions: ['chat:read', 'chat:write', 'chat:manage'],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────
// MOCK SETUP
// ─────────────────────────────────────────────────────────────

function createMockDb(): ChatServiceDb {
  return {
    createChat: vi.fn(),
    getChat: vi.fn(),
    updateChat: vi.fn(),
    listChats: vi.fn(),
    createMessage: vi.fn(),
    getMessage: vi.fn(),
    getMessages: vi.fn(),
    updateMessageMetadata: vi.fn(),
  };
}

function createMockAuditService(): ChatServiceAudit {
  return {
    log: vi.fn().mockResolvedValue({ success: true, data: undefined }),
  };
}

// ─────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────

describe('ChatService', () => {
  let chatService: ChatService;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockAuditService: ReturnType<typeof createMockAuditService>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockAuditService = createMockAuditService();
    chatService = createChatService({
      db: mockDb,
      auditService: mockAuditService,
    });
  });

  // ─────────────────────────────────────────────────────────────
  // createChat
  // ─────────────────────────────────────────────────────────────

  describe('createChat', () => {
    it('should create a new chat for the actor', async () => {
      const actor = createTestActor();
      mockDb.createChat.mockResolvedValue(mockChat);

      const result = await chatService.createChat(actor, {
        title: 'Test Chat',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.userId).toBe(TEST_USER_ID);
        expect(result.data.title).toBe('Test Chat');
      }
      expect(mockDb.createChat).toHaveBeenCalledWith({
        userId: TEST_USER_ID,
        title: 'Test Chat',
        metadata: undefined,
      });
    });

    it('should create chat with default title (null)', async () => {
      const actor = createTestActor();
      const chatWithNoTitle = { ...mockChat, title: null };
      mockDb.createChat.mockResolvedValue(chatWithNoTitle);

      const result = await chatService.createChat(actor, {});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.title).toBeNull();
      }
    });

    it('should create chat with metadata', async () => {
      const actor = createTestActor();
      const metadata = { source: 'web', version: 1 };
      const chatWithMetadata = { ...mockChat, metadata };
      mockDb.createChat.mockResolvedValue(chatWithMetadata);

      const result = await chatService.createChat(actor, { metadata });

      expect(result.success).toBe(true);
      expect(mockDb.createChat).toHaveBeenCalledWith({
        userId: TEST_USER_ID,
        title: undefined,
        metadata,
      });
    });

    it('should emit audit event on chat creation', async () => {
      const actor = createTestActor();
      mockDb.createChat.mockResolvedValue(mockChat);

      await chatService.createChat(actor, { title: 'Test' });

      expect(mockAuditService.log).toHaveBeenCalledWith(actor, {
        action: 'chat:created',
        resourceType: 'chat',
        resourceId: TEST_CHAT_ID,
        details: { title: 'Test' },
      });
    });

    it('should reject AI_ACTOR from creating chats', async () => {
      const result = await chatService.createChat(AI_ACTOR, { title: 'Test' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
        expect(result.error.message).toContain('AI cannot create chats');
      }
      expect(mockDb.createChat).not.toHaveBeenCalled();
    });

    it('should allow SYSTEM_ACTOR to create chats', async () => {
      mockDb.createChat.mockResolvedValue(mockChat);

      const result = await chatService.createChat(SYSTEM_ACTOR, {
        title: 'System Chat',
      });

      expect(result.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // getChat
  // ─────────────────────────────────────────────────────────────

  describe('getChat', () => {
    it('should return chat for owner', async () => {
      const actor = createTestActor();
      mockDb.getChat.mockResolvedValue(mockChat);

      const result = await chatService.getChat(actor, TEST_CHAT_ID);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(TEST_CHAT_ID);
        expect(result.data.userId).toBe(TEST_USER_ID);
      }
    });

    it('should deny access to other users chats without permission', async () => {
      const actor = createTestActor({
        userId: TEST_OTHER_USER_ID,
        permissions: [],
      });
      mockDb.getChat.mockResolvedValue(mockChat);

      const result = await chatService.getChat(actor, TEST_CHAT_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow admin with chat:read to access any chat', async () => {
      const actor = createAdminActor();
      mockDb.getChat.mockResolvedValue(mockChat);

      const result = await chatService.getChat(actor, TEST_CHAT_ID);

      expect(result.success).toBe(true);
    });

    it('should return NOT_FOUND for non-existent chat', async () => {
      const actor = createTestActor();
      mockDb.getChat.mockResolvedValue(null);

      const result = await chatService.getChat(actor, 'non-existent-id');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should allow AI_ACTOR to read chats (for context assembly)', async () => {
      mockDb.getChat.mockResolvedValue(mockChat);

      const result = await chatService.getChat(AI_ACTOR, TEST_CHAT_ID);

      expect(result.success).toBe(true);
    });

    it('should validate chatId is not empty', async () => {
      const actor = createTestActor();

      const result = await chatService.getChat(actor, '');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // listChats
  // ─────────────────────────────────────────────────────────────

  describe('listChats', () => {
    it('should list chats for the actor', async () => {
      const actor = createTestActor();
      const paginatedResult: PaginatedResult<ChatSummary> = {
        items: [mockChatSummary],
        hasMore: false,
      };
      mockDb.listChats.mockResolvedValue(paginatedResult);

      const result = await chatService.listChats(actor, { limit: 20 });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.items).toHaveLength(1);
        expect(result.data.items[0].id).toBe(TEST_CHAT_ID);
      }
    });

    it('should support pagination with cursor', async () => {
      const actor = createTestActor();
      const paginatedResult: PaginatedResult<ChatSummary> = {
        items: [mockChatSummary],
        hasMore: true,
        nextCursor: 'next-cursor',
      };
      mockDb.listChats.mockResolvedValue(paginatedResult);

      const result = await chatService.listChats(actor, {
        limit: 10,
        cursor: 'prev-cursor',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.hasMore).toBe(true);
        expect(result.data.nextCursor).toBe('next-cursor');
      }
    });

    it('should filter by status', async () => {
      const actor = createTestActor();
      mockDb.listChats.mockResolvedValue({ items: [], hasMore: false });

      await chatService.listChats(actor, { limit: 20, status: 'archived' });

      expect(mockDb.listChats).toHaveBeenCalledWith(
        TEST_USER_ID,
        expect.objectContaining({ status: 'archived' })
      );
    });

    it('should only list own chats by default', async () => {
      const actor = createTestActor();
      mockDb.listChats.mockResolvedValue({ items: [], hasMore: false });

      await chatService.listChats(actor, { limit: 20 });

      expect(mockDb.listChats).toHaveBeenCalledWith(
        TEST_USER_ID,
        expect.any(Object)
      );
    });
  });

  // ─────────────────────────────────────────────────────────────
  // updateChat
  // ─────────────────────────────────────────────────────────────

  describe('updateChat', () => {
    it('should update chat title', async () => {
      const actor = createTestActor();
      const updatedChat = { ...mockChat, title: 'Updated Title' };
      mockDb.getChat.mockResolvedValue(mockChat);
      mockDb.updateChat.mockResolvedValue(updatedChat);

      const result = await chatService.updateChat(actor, TEST_CHAT_ID, {
        title: 'Updated Title',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.title).toBe('Updated Title');
      }
    });

    it('should update chat metadata', async () => {
      const actor = createTestActor();
      const newMetadata = { favorite: true };
      const updatedChat = { ...mockChat, metadata: newMetadata };
      mockDb.getChat.mockResolvedValue(mockChat);
      mockDb.updateChat.mockResolvedValue(updatedChat);

      const result = await chatService.updateChat(actor, TEST_CHAT_ID, {
        metadata: newMetadata,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.metadata).toEqual(newMetadata);
      }
    });

    it('should deny update to other users chats', async () => {
      const actor = createTestActor({
        userId: TEST_OTHER_USER_ID,
        permissions: [],
      });
      mockDb.getChat.mockResolvedValue(mockChat);

      const result = await chatService.updateChat(actor, TEST_CHAT_ID, {
        title: 'Hacked',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow admin with chat:manage to update any chat', async () => {
      const actor = createAdminActor();
      const updatedChat = { ...mockChat, title: 'Admin Update' };
      mockDb.getChat.mockResolvedValue(mockChat);
      mockDb.updateChat.mockResolvedValue(updatedChat);

      const result = await chatService.updateChat(actor, TEST_CHAT_ID, {
        title: 'Admin Update',
      });

      expect(result.success).toBe(true);
    });

    it('should reject AI_ACTOR from updating chats', async () => {
      mockDb.getChat.mockResolvedValue(mockChat);

      const result = await chatService.updateChat(AI_ACTOR, TEST_CHAT_ID, {
        title: 'AI Update',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
        expect(result.error.message).toContain('AI cannot update chats');
      }
    });

    it('should return NOT_FOUND for non-existent chat', async () => {
      const actor = createTestActor();
      mockDb.getChat.mockResolvedValue(null);

      const result = await chatService.updateChat(actor, 'non-existent', {
        title: 'Test',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // archiveChat
  // ─────────────────────────────────────────────────────────────

  describe('archiveChat', () => {
    it('should archive own chat', async () => {
      const actor = createTestActor();
      mockDb.getChat.mockResolvedValue(mockChat);
      mockDb.updateChat.mockResolvedValue({ ...mockChat, status: 'archived' });

      const result = await chatService.archiveChat(actor, TEST_CHAT_ID);

      expect(result.success).toBe(true);
      expect(mockDb.updateChat).toHaveBeenCalledWith(TEST_CHAT_ID, {
        status: 'archived',
      });
    });

    it('should emit audit event on archive', async () => {
      const actor = createTestActor();
      mockDb.getChat.mockResolvedValue(mockChat);
      mockDb.updateChat.mockResolvedValue({ ...mockChat, status: 'archived' });

      await chatService.archiveChat(actor, TEST_CHAT_ID);

      expect(mockAuditService.log).toHaveBeenCalledWith(actor, {
        action: 'chat:archived',
        resourceType: 'chat',
        resourceId: TEST_CHAT_ID,
      });
    });

    it('should deny archiving other users chats', async () => {
      const actor = createTestActor({
        userId: TEST_OTHER_USER_ID,
        permissions: [],
      });
      mockDb.getChat.mockResolvedValue(mockChat);

      const result = await chatService.archiveChat(actor, TEST_CHAT_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow admin with chat:manage to archive any chat', async () => {
      const actor = createAdminActor();
      mockDb.getChat.mockResolvedValue(mockChat);
      mockDb.updateChat.mockResolvedValue({ ...mockChat, status: 'archived' });

      const result = await chatService.archiveChat(actor, TEST_CHAT_ID);

      expect(result.success).toBe(true);
    });

    it('should reject AI_ACTOR from archiving chats', async () => {
      mockDb.getChat.mockResolvedValue(mockChat);

      const result = await chatService.archiveChat(AI_ACTOR, TEST_CHAT_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
        expect(result.error.message).toContain('AI cannot archive chats');
      }
    });

    it('should not archive already archived chat', async () => {
      const actor = createTestActor();
      const archivedChat = { ...mockChat, status: 'archived' as const };
      mockDb.getChat.mockResolvedValue(archivedChat);

      const result = await chatService.archiveChat(actor, TEST_CHAT_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toContain('already archived');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // addMessage
  // ─────────────────────────────────────────────────────────────

  describe('addMessage', () => {
    it('should add message to chat', async () => {
      const actor = createTestActor();
      mockDb.getChat.mockResolvedValue(mockChat);
      mockDb.createMessage.mockResolvedValue(mockMessage);

      const result = await chatService.addMessage(actor, {
        chatId: TEST_CHAT_ID,
        role: 'user',
        content: 'Hello, world!',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.chatId).toBe(TEST_CHAT_ID);
        expect(result.data.content).toBe('Hello, world!');
        expect(result.data.role).toBe('user');
      }
    });

    it('should add message with metadata', async () => {
      const actor = createTestActor();
      const messageWithMeta = {
        ...mockMessage,
        role: 'assistant' as const,
        metadata: { model: 'gpt-4', tokenCount: 100 },
      };
      mockDb.getChat.mockResolvedValue(mockChat);
      mockDb.createMessage.mockResolvedValue(messageWithMeta);

      const result = await chatService.addMessage(actor, {
        chatId: TEST_CHAT_ID,
        role: 'assistant',
        content: 'Hello!',
        metadata: { model: 'gpt-4', tokenCount: 100 },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.metadata.model).toBe('gpt-4');
      }
    });

    it('should return NOT_FOUND if chat does not exist', async () => {
      const actor = createTestActor();
      mockDb.getChat.mockResolvedValue(null);

      const result = await chatService.addMessage(actor, {
        chatId: 'non-existent',
        role: 'user',
        content: 'Hello',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should deny adding to other users chats without permission', async () => {
      const actor = createTestActor({
        userId: TEST_OTHER_USER_ID,
        permissions: [],
      });
      mockDb.getChat.mockResolvedValue(mockChat);

      const result = await chatService.addMessage(actor, {
        chatId: TEST_CHAT_ID,
        role: 'user',
        content: 'Hello',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow AI_ACTOR to add messages (for assistant responses)', async () => {
      mockDb.getChat.mockResolvedValue(mockChat);
      const assistantMessage = { ...mockMessage, role: 'assistant' as const };
      mockDb.createMessage.mockResolvedValue(assistantMessage);

      const result = await chatService.addMessage(AI_ACTOR, {
        chatId: TEST_CHAT_ID,
        role: 'assistant',
        content: 'AI response',
      });

      expect(result.success).toBe(true);
    });

    it('should allow SYSTEM_ACTOR to add messages', async () => {
      mockDb.getChat.mockResolvedValue(mockChat);
      const systemMessage = { ...mockMessage, role: 'system' as const };
      mockDb.createMessage.mockResolvedValue(systemMessage);

      const result = await chatService.addMessage(SYSTEM_ACTOR, {
        chatId: TEST_CHAT_ID,
        role: 'system',
        content: 'System message',
      });

      expect(result.success).toBe(true);
    });

    it('should validate content is not empty', async () => {
      const actor = createTestActor();
      mockDb.getChat.mockResolvedValue(mockChat);

      const result = await chatService.addMessage(actor, {
        chatId: TEST_CHAT_ID,
        role: 'user',
        content: '',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toContain('content');
      }
    });

    it('should not add message to archived chat', async () => {
      const actor = createTestActor();
      const archivedChat = { ...mockChat, status: 'archived' as const };
      mockDb.getChat.mockResolvedValue(archivedChat);

      const result = await chatService.addMessage(actor, {
        chatId: TEST_CHAT_ID,
        role: 'user',
        content: 'Hello',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toContain('archived');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // getMessages
  // ─────────────────────────────────────────────────────────────

  describe('getMessages', () => {
    it('should return messages in chronological order', async () => {
      const actor = createTestActor();
      mockDb.getChat.mockResolvedValue(mockChat);
      mockDb.getMessages.mockResolvedValue({
        items: [mockMessage],
        hasMore: false,
      });

      const result = await chatService.getMessages(actor, TEST_CHAT_ID, {
        limit: 50,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.items).toHaveLength(1);
        expect(result.data.items[0].content).toBe('Hello, world!');
      }
    });

    it('should support pagination', async () => {
      const actor = createTestActor();
      mockDb.getChat.mockResolvedValue(mockChat);
      mockDb.getMessages.mockResolvedValue({
        items: [mockMessage],
        hasMore: true,
        nextCursor: 'next-cursor',
      });

      const result = await chatService.getMessages(actor, TEST_CHAT_ID, {
        limit: 10,
        cursor: 'prev-cursor',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.hasMore).toBe(true);
        expect(result.data.nextCursor).toBe('next-cursor');
      }
    });

    it('should deny access to other users chat messages', async () => {
      const actor = createTestActor({
        userId: TEST_OTHER_USER_ID,
        permissions: [],
      });
      mockDb.getChat.mockResolvedValue(mockChat);

      const result = await chatService.getMessages(actor, TEST_CHAT_ID, {
        limit: 50,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow AI_ACTOR to read messages (for context assembly)', async () => {
      mockDb.getChat.mockResolvedValue(mockChat);
      mockDb.getMessages.mockResolvedValue({
        items: [mockMessage],
        hasMore: false,
      });

      const result = await chatService.getMessages(AI_ACTOR, TEST_CHAT_ID, {
        limit: 50,
      });

      expect(result.success).toBe(true);
    });

    it('should return NOT_FOUND for non-existent chat', async () => {
      const actor = createTestActor();
      mockDb.getChat.mockResolvedValue(null);

      const result = await chatService.getMessages(actor, 'non-existent', {
        limit: 50,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // redactMessage
  // ─────────────────────────────────────────────────────────────

  describe('redactMessage', () => {
    it('should redact message by setting metadata flag', async () => {
      const actor = createTestActor();
      mockDb.getMessage.mockResolvedValue(mockMessage);
      mockDb.getChat.mockResolvedValue(mockChat);
      mockDb.updateMessageMetadata.mockResolvedValue({
        ...mockMessage,
        metadata: { redacted: true, redactedReason: 'User request' },
      });

      const result = await chatService.redactMessage(
        actor,
        TEST_MESSAGE_ID,
        'User request'
      );

      expect(result.success).toBe(true);
      expect(mockDb.updateMessageMetadata).toHaveBeenCalledWith(
        TEST_MESSAGE_ID,
        expect.objectContaining({
          redacted: true,
          redactedReason: 'User request',
        })
      );
    });

    it('should emit audit event on redaction', async () => {
      const actor = createTestActor();
      mockDb.getMessage.mockResolvedValue(mockMessage);
      mockDb.getChat.mockResolvedValue(mockChat);
      mockDb.updateMessageMetadata.mockResolvedValue({
        ...mockMessage,
        metadata: { redacted: true },
      });

      await chatService.redactMessage(actor, TEST_MESSAGE_ID, 'Inappropriate');

      expect(mockAuditService.log).toHaveBeenCalledWith(actor, {
        action: 'message:redacted',
        resourceType: 'message',
        resourceId: TEST_MESSAGE_ID,
        details: { reason: 'Inappropriate', chatId: TEST_CHAT_ID },
      });
    });

    it('should deny redacting other users messages', async () => {
      const actor = createTestActor({
        userId: TEST_OTHER_USER_ID,
        permissions: [],
      });
      mockDb.getMessage.mockResolvedValue(mockMessage);
      mockDb.getChat.mockResolvedValue(mockChat);

      const result = await chatService.redactMessage(
        actor,
        TEST_MESSAGE_ID,
        'Reason'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow admin with chat:manage to redact any message', async () => {
      const actor = createAdminActor();
      mockDb.getMessage.mockResolvedValue(mockMessage);
      mockDb.getChat.mockResolvedValue(mockChat);
      mockDb.updateMessageMetadata.mockResolvedValue({
        ...mockMessage,
        metadata: { redacted: true },
      });

      const result = await chatService.redactMessage(
        actor,
        TEST_MESSAGE_ID,
        'Admin action'
      );

      expect(result.success).toBe(true);
    });

    it('should reject AI_ACTOR from redacting messages', async () => {
      mockDb.getMessage.mockResolvedValue(mockMessage);
      mockDb.getChat.mockResolvedValue(mockChat);

      const result = await chatService.redactMessage(
        AI_ACTOR,
        TEST_MESSAGE_ID,
        'AI decision'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
        expect(result.error.message).toContain('AI cannot redact messages');
      }
    });

    it('should return NOT_FOUND for non-existent message', async () => {
      const actor = createTestActor();
      mockDb.getMessage.mockResolvedValue(null);

      const result = await chatService.redactMessage(
        actor,
        'non-existent',
        'Reason'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should not redact already redacted message', async () => {
      const actor = createTestActor();
      const redactedMessage = {
        ...mockMessage,
        metadata: { redacted: true, redactedReason: 'Previous reason' },
      };
      mockDb.getMessage.mockResolvedValue(redactedMessage);
      mockDb.getChat.mockResolvedValue(mockChat);

      const result = await chatService.redactMessage(
        actor,
        TEST_MESSAGE_ID,
        'New reason'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toContain('already redacted');
      }
    });

    it('should require a reason for redaction', async () => {
      const actor = createTestActor();
      mockDb.getMessage.mockResolvedValue(mockMessage);
      mockDb.getChat.mockResolvedValue(mockChat);

      const result = await chatService.redactMessage(
        actor,
        TEST_MESSAGE_ID,
        ''
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toContain('reason');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Message Immutability Invariant
  // ─────────────────────────────────────────────────────────────

  describe('Message Immutability', () => {
    it('should NOT have an updateMessage method', () => {
      expect(chatService).not.toHaveProperty('updateMessage');
    });

    it('should NOT have a deleteMessage method', () => {
      expect(chatService).not.toHaveProperty('deleteMessage');
    });
  });
});
