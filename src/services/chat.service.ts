/**
 * ChatService Implementation
 * Phase 2: TDD - GREEN phase
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
 * Dependencies: AuditService (for logging)
 *
 * GUARDRAILS:
 * - Users can only access their own chats
 * - AI_ACTOR CAN read chats/messages (for context assembly)
 * - AI_ACTOR CAN add messages (for assistant responses)
 * - AI_ACTOR CANNOT create/update/archive chats
 * - AI_ACTOR CANNOT redact messages
 * - All mutations (archive, redact) emit audit events
 */

import type {
  ActorContext,
  Chat,
  ChatSummary,
  ChatUpdate,
  CreateChatParams,
  ListChatsParams,
  Message,
  MessageMetadata,
  AddMessageParams,
  GetMessagesParams,
  PaginatedResult,
  Result,
  AuditEvent,
} from '@/types/index.js';
import { success, failure } from '@/types/index.js';

/**
 * Database abstraction interface for ChatService
 */
export interface ChatServiceDb {
  createChat: (params: {
    userId: string;
    title?: string;
    metadata?: Record<string, unknown>;
  }) => Promise<Chat>;
  getChat: (chatId: string) => Promise<Chat | null>;
  updateChat: (
    chatId: string,
    updates: ChatUpdate | { status: string }
  ) => Promise<Chat>;
  listChats: (
    userId: string,
    params: ListChatsParams
  ) => Promise<PaginatedResult<ChatSummary>>;
  createMessage: (params: {
    chatId: string;
    role: string;
    content: string;
    metadata?: Partial<MessageMetadata>;
  }) => Promise<Message>;
  getMessage: (messageId: string) => Promise<Message | null>;
  getMessages: (
    chatId: string,
    params: GetMessagesParams
  ) => Promise<PaginatedResult<Message>>;
  updateMessageMetadata: (
    messageId: string,
    metadata: Partial<MessageMetadata>
  ) => Promise<Message>;
}

/**
 * Minimal AuditService interface (subset needed by ChatService)
 */
export interface ChatServiceAudit {
  log: (actor: ActorContext, event: AuditEvent) => Promise<Result<void>>;
}

/**
 * ChatService interface
 */
export interface ChatService {
  createChat(
    actor: ActorContext,
    params: CreateChatParams
  ): Promise<Result<Chat>>;
  getChat(actor: ActorContext, chatId: string): Promise<Result<Chat>>;
  listChats(
    actor: ActorContext,
    params: ListChatsParams
  ): Promise<Result<PaginatedResult<ChatSummary>>>;
  updateChat(
    actor: ActorContext,
    chatId: string,
    updates: ChatUpdate
  ): Promise<Result<Chat>>;
  archiveChat(actor: ActorContext, chatId: string): Promise<Result<void>>;
  addMessage(
    actor: ActorContext,
    params: AddMessageParams
  ): Promise<Result<Message>>;
  getMessages(
    actor: ActorContext,
    chatId: string,
    params: GetMessagesParams
  ): Promise<Result<PaginatedResult<Message>>>;
  redactMessage(
    actor: ActorContext,
    messageId: string,
    reason: string
  ): Promise<Result<void>>;
}

// ─────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────

/**
 * Check if actor is AI_ACTOR
 */
function isAIActor(actor: ActorContext): boolean {
  return actor.type === 'ai';
}

/**
 * Check if actor has wildcard permission
 */
function hasWildcardPermission(actor: ActorContext): boolean {
  return actor.permissions.includes('*');
}

/**
 * Check if actor can access a chat (read)
 * - Owner can always access
 * - AI_ACTOR can read (for context assembly)
 * - Actors with chat:read permission can access any chat
 */
function canAccessChat(
  actor: ActorContext,
  chat: Chat,
  requiredPermission: string
): boolean {
  // AI_ACTOR can read any chat (for context assembly)
  if (isAIActor(actor) && requiredPermission === 'chat:read') {
    return true;
  }
  // Owner can always access
  if (actor.userId === chat.userId) {
    return true;
  }
  // Wildcard permission
  if (hasWildcardPermission(actor)) {
    return true;
  }
  // Check specific permission
  return actor.permissions.includes(requiredPermission);
}

/**
 * Check if actor can mutate (create/update/archive/redact)
 * AI_ACTOR cannot mutate chats (except addMessage)
 */
function canMutateChatLifecycle(actor: ActorContext): boolean {
  return !isAIActor(actor);
}

// ─────────────────────────────────────────────────────────────
// SERVICE IMPLEMENTATION
// ─────────────────────────────────────────────────────────────

/**
 * Create ChatService instance
 */
export function createChatService(deps: {
  db: ChatServiceDb;
  auditService: ChatServiceAudit;
}): ChatService {
  const { db, auditService } = deps;

  return {
    /**
     * Create a new chat
     * AI_ACTOR cannot create chats (user action)
     */
    async createChat(
      actor: ActorContext,
      params: CreateChatParams
    ): Promise<Result<Chat>> {
      // AI_ACTOR cannot create chats
      if (isAIActor(actor)) {
        return failure('PERMISSION_DENIED', 'AI cannot create chats');
      }

      try {
        const createParams: {
          userId: string;
          title?: string;
          metadata?: Record<string, unknown>;
        } = {
          userId: actor.userId ?? '',
        };
        if (params.title !== undefined) {
          createParams.title = params.title;
        }
        if (params.metadata !== undefined) {
          createParams.metadata = params.metadata;
        }

        const chat = await db.createChat(createParams);

        // Emit audit event
        await auditService.log(actor, {
          action: 'chat:created',
          resourceType: 'chat',
          resourceId: chat.id,
          details: { title: params.title },
        });

        return success(chat);
      } catch {
        return failure('INTERNAL_ERROR', 'Failed to create chat');
      }
    },

    /**
     * Get a chat by ID
     * AI_ACTOR can read (for context assembly)
     */
    async getChat(actor: ActorContext, chatId: string): Promise<Result<Chat>> {
      // Validate chatId
      if (!chatId || chatId.trim() === '') {
        return failure('VALIDATION_ERROR', 'Chat ID is required');
      }

      const chat = await db.getChat(chatId);
      if (chat === null) {
        return failure('NOT_FOUND', 'Chat not found');
      }

      // Check permission
      if (!canAccessChat(actor, chat, 'chat:read')) {
        return failure(
          'PERMISSION_DENIED',
          'Cannot access chat without permission'
        );
      }

      return success(chat);
    },

    /**
     * List chats for the actor
     * Users can only list their own chats
     */
    async listChats(
      actor: ActorContext,
      params: ListChatsParams
    ): Promise<Result<PaginatedResult<ChatSummary>>> {
      // Users can only list their own chats
      const result = await db.listChats(actor.userId ?? '', params);
      return success(result);
    },

    /**
     * Update chat metadata
     * AI_ACTOR cannot update chats
     */
    async updateChat(
      actor: ActorContext,
      chatId: string,
      updates: ChatUpdate
    ): Promise<Result<Chat>> {
      // AI_ACTOR cannot update chats
      if (!canMutateChatLifecycle(actor)) {
        return failure('PERMISSION_DENIED', 'AI cannot update chats');
      }

      const chat = await db.getChat(chatId);
      if (chat === null) {
        return failure('NOT_FOUND', 'Chat not found');
      }

      // Check permission (need chat:manage for others' chats)
      if (!canAccessChat(actor, chat, 'chat:manage')) {
        return failure(
          'PERMISSION_DENIED',
          'Cannot update chat without permission'
        );
      }

      const updatedChat = await db.updateChat(chatId, updates);
      return success(updatedChat);
    },

    /**
     * Archive a chat (soft delete)
     * AI_ACTOR cannot archive chats
     * Emits audit event
     */
    async archiveChat(
      actor: ActorContext,
      chatId: string
    ): Promise<Result<void>> {
      // AI_ACTOR cannot archive chats
      if (!canMutateChatLifecycle(actor)) {
        return failure('PERMISSION_DENIED', 'AI cannot archive chats');
      }

      const chat = await db.getChat(chatId);
      if (chat === null) {
        return failure('NOT_FOUND', 'Chat not found');
      }

      // Check permission
      if (!canAccessChat(actor, chat, 'chat:manage')) {
        return failure(
          'PERMISSION_DENIED',
          'Cannot archive chat without permission'
        );
      }

      // Cannot archive already archived chat
      if (chat.status === 'archived') {
        return failure('VALIDATION_ERROR', 'Chat is already archived');
      }

      await db.updateChat(chatId, { status: 'archived' });

      // Emit audit event
      await auditService.log(actor, {
        action: 'chat:archived',
        resourceType: 'chat',
        resourceId: chatId,
      });

      return success(undefined);
    },

    /**
     * Add a message to a chat
     * This is APPEND-ONLY (no update/delete)
     * AI_ACTOR CAN add messages (for assistant responses)
     */
    async addMessage(
      actor: ActorContext,
      params: AddMessageParams
    ): Promise<Result<Message>> {
      // Validate content
      if (!params.content || params.content.trim() === '') {
        return failure('VALIDATION_ERROR', 'Message content is required');
      }

      const chat = await db.getChat(params.chatId);
      if (chat === null) {
        return failure('NOT_FOUND', 'Chat not found');
      }

      // AI_ACTOR can add messages (for assistant responses)
      // But regular users can only add to their own chats
      if (!isAIActor(actor) && actor.type !== 'system') {
        if (!canAccessChat(actor, chat, 'chat:write')) {
          return failure(
            'PERMISSION_DENIED',
            'Cannot add message to this chat'
          );
        }
      }

      // Cannot add message to archived chat
      if (chat.status === 'archived') {
        return failure(
          'VALIDATION_ERROR',
          'Cannot add message to archived chat'
        );
      }

      const messageParams: {
        chatId: string;
        role: string;
        content: string;
        metadata?: Partial<MessageMetadata>;
      } = {
        chatId: params.chatId,
        role: params.role,
        content: params.content,
      };
      if (params.metadata !== undefined) {
        messageParams.metadata = params.metadata;
      }

      const message = await db.createMessage(messageParams);

      return success(message);
    },

    /**
     * Get messages in a chat
     * AI_ACTOR can read (for context assembly)
     */
    async getMessages(
      actor: ActorContext,
      chatId: string,
      params: GetMessagesParams
    ): Promise<Result<PaginatedResult<Message>>> {
      const chat = await db.getChat(chatId);
      if (chat === null) {
        return failure('NOT_FOUND', 'Chat not found');
      }

      // Check permission
      if (!canAccessChat(actor, chat, 'chat:read')) {
        return failure(
          'PERMISSION_DENIED',
          'Cannot access messages without permission'
        );
      }

      const result = await db.getMessages(chatId, params);
      return success(result);
    },

    /**
     * Redact a message (soft delete)
     * Sets metadata.redacted = true
     * Content is preserved for audit but hidden from UI
     * AI_ACTOR cannot redact messages
     * Emits audit event
     */
    async redactMessage(
      actor: ActorContext,
      messageId: string,
      reason: string
    ): Promise<Result<void>> {
      // AI_ACTOR cannot redact messages
      if (isAIActor(actor)) {
        return failure('PERMISSION_DENIED', 'AI cannot redact messages');
      }

      // Validate reason
      if (!reason || reason.trim() === '') {
        return failure('VALIDATION_ERROR', 'Redaction reason is required');
      }

      const message = await db.getMessage(messageId);
      if (message === null) {
        return failure('NOT_FOUND', 'Message not found');
      }

      // Check if already redacted
      if (message.metadata.redacted === true) {
        return failure('VALIDATION_ERROR', 'Message is already redacted');
      }

      // Get the chat to check ownership
      const chat = await db.getChat(message.chatId);
      if (chat === null) {
        return failure('NOT_FOUND', 'Chat not found');
      }

      // Check permission
      if (!canAccessChat(actor, chat, 'chat:manage')) {
        return failure(
          'PERMISSION_DENIED',
          'Cannot redact message without permission'
        );
      }

      // Update message metadata
      await db.updateMessageMetadata(messageId, {
        redacted: true,
        redactedAt: new Date(),
        redactedReason: reason,
      });

      // Emit audit event
      await auditService.log(actor, {
        action: 'message:redacted',
        resourceType: 'message',
        resourceId: messageId,
        details: { reason, chatId: message.chatId },
      });

      return success(undefined);
    },
  };
}
