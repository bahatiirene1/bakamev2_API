/**
 * ChatService Database Adapter
 * Implements ChatServiceDb interface using Supabase
 *
 * Reference: docs/stage-2-service-layer.md Section 3.3
 *
 * SCOPE: Conversation management (persistence-only)
 * NOT IN SCOPE: AI orchestration
 *
 * CRITICAL: Messages are IMMUTABLE (append-only)
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  Chat,
  ChatStatus,
  ChatSummary,
  ChatUpdate,
  Message,
  MessageRole,
  MessageMetadata,
  ListChatsParams,
  GetMessagesParams,
  PaginatedResult,
} from '@/types/index.js';

import type { ChatServiceDb } from './chat.service.js';

/**
 * Database row types
 */
interface ChatRow {
  id: string;
  user_id: string;
  title: string | null;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface MessageRow {
  id: string;
  chat_id: string;
  role: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface ChatSummaryRow {
  id: string;
  title: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message_at: string | null;
}

/**
 * Map database row to Chat entity
 */
function mapRowToChat(row: ChatRow): Chat {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    status: row.status as ChatStatus,
    metadata: row.metadata,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Map database row to Message entity
 */
function mapRowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    chatId: row.chat_id,
    role: row.role as MessageRole,
    content: row.content,
    metadata: row.metadata as MessageMetadata,
    createdAt: new Date(row.created_at),
  };
}

/**
 * Map database row to ChatSummary entity
 */
function mapRowToChatSummary(row: ChatSummaryRow): ChatSummary {
  return {
    id: row.id,
    title: row.title,
    status: row.status as 'active' | 'archived',
    lastMessageAt:
      row.last_message_at !== null ? new Date(row.last_message_at) : null,
    messageCount: row.message_count,
    createdAt: new Date(row.created_at),
  };
}

/**
 * Create ChatServiceDb implementation using Supabase
 */
export function createChatServiceDb(supabase: SupabaseClient): ChatServiceDb {
  return {
    /**
     * Create a new chat
     */
    async createChat(params: {
      userId: string;
      title?: string;
      metadata?: Record<string, unknown>;
    }): Promise<Chat> {
      const { data, error } = await supabase
        .from('chats')
        .insert({
          user_id: params.userId,
          title: params.title ?? null,
          status: 'active',
          metadata: params.metadata ?? {},
        })
        .select('*')
        .single();

      if (error !== null) {
        throw new Error(`Failed to create chat: ${error.message}`);
      }

      return mapRowToChat(data as ChatRow);
    },

    /**
     * Get chat by ID
     */
    async getChat(chatId: string): Promise<Chat | null> {
      const { data, error } = await supabase
        .from('chats')
        .select('*')
        .eq('id', chatId)
        .single();

      if (error !== null) {
        if (error.code === 'PGRST116') {
          return null;
        }
        throw new Error(`Failed to get chat: ${error.message}`);
      }

      return mapRowToChat(data as ChatRow);
    },

    /**
     * Update chat
     */
    async updateChat(
      chatId: string,
      updates: ChatUpdate | { status: string }
    ): Promise<Chat> {
      const updateData: Record<string, unknown> = {};

      if ('title' in updates && updates.title !== undefined) {
        updateData.title = updates.title;
      }
      if ('metadata' in updates && updates.metadata !== undefined) {
        updateData.metadata = updates.metadata;
      }
      if ('status' in updates) {
        updateData.status = updates.status;
      }

      const { data, error } = await supabase
        .from('chats')
        .update(updateData)
        .eq('id', chatId)
        .select('*')
        .single();

      if (error !== null) {
        throw new Error(`Failed to update chat: ${error.message}`);
      }

      return mapRowToChat(data as ChatRow);
    },

    /**
     * List chats for a user with pagination
     */
    async listChats(
      userId: string,
      params: ListChatsParams
    ): Promise<PaginatedResult<ChatSummary>> {
      // Build query for chat summaries with message count
      let query = supabase
        .from('chats')
        .select(
          `
          id,
          title,
          status,
          created_at,
          updated_at,
          messages!left(created_at)
        `
        )
        .eq('user_id', userId)
        .neq('status', 'deleted')
        .order('updated_at', { ascending: false });

      // Filter by status if provided
      if (params.status !== undefined) {
        query = query.eq('status', params.status);
      }

      // Apply cursor-based pagination
      if (params.cursor !== undefined) {
        query = query.lt('updated_at', params.cursor);
      }

      // Fetch one more than limit to determine hasMore
      const limit = params.limit;
      query = query.limit(limit + 1);

      const { data, error } = await query;

      if (error !== null) {
        throw new Error(`Failed to list chats: ${error.message}`);
      }

      // Process results - calculate message count and last message time
      const rawRows = (data ?? []) as Array<{
        id: string;
        title: string | null;
        status: string;
        created_at: string;
        updated_at: string;
        messages: Array<{ created_at: string }> | null;
      }>;

      const summaryRows: ChatSummaryRow[] = rawRows.map((row) => {
        const messages = row.messages ?? [];
        const messageCount = messages.length;
        const firstMessage = messages[0];
        const lastMessageAt =
          messages.length > 0 && firstMessage !== undefined
            ? messages.reduce(
                (latest, m) => (m.created_at > latest ? m.created_at : latest),
                firstMessage.created_at
              )
            : null;

        return {
          id: row.id,
          title: row.title,
          status: row.status,
          created_at: row.created_at,
          updated_at: row.updated_at,
          message_count: messageCount,
          last_message_at: lastMessageAt,
        };
      });

      const hasMore = summaryRows.length > limit;
      const items = summaryRows.slice(0, limit).map(mapRowToChatSummary);

      const result: PaginatedResult<ChatSummary> = { items, hasMore };
      const lastItem = items[items.length - 1];
      if (hasMore && lastItem !== undefined) {
        result.nextCursor = lastItem.createdAt.toISOString();
      }

      return result;
    },

    /**
     * Create a new message
     */
    async createMessage(params: {
      chatId: string;
      role: string;
      content: string;
      metadata?: Partial<MessageMetadata>;
    }): Promise<Message> {
      const { data, error } = await supabase
        .from('messages')
        .insert({
          chat_id: params.chatId,
          role: params.role,
          content: params.content,
          metadata: params.metadata ?? {},
        })
        .select('*')
        .single();

      if (error !== null) {
        throw new Error(`Failed to create message: ${error.message}`);
      }

      // Update chat's updated_at timestamp
      await supabase
        .from('chats')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', params.chatId);

      return mapRowToMessage(data as MessageRow);
    },

    /**
     * Get message by ID
     */
    async getMessage(messageId: string): Promise<Message | null> {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('id', messageId)
        .single();

      if (error !== null) {
        if (error.code === 'PGRST116') {
          return null;
        }
        throw new Error(`Failed to get message: ${error.message}`);
      }

      return mapRowToMessage(data as MessageRow);
    },

    /**
     * Get messages for a chat with pagination
     */
    async getMessages(
      chatId: string,
      params: GetMessagesParams
    ): Promise<PaginatedResult<Message>> {
      let query = supabase
        .from('messages')
        .select('*')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true });

      // Apply cursor-based pagination
      if (params.cursor !== undefined) {
        query = query.gt('created_at', params.cursor);
      }

      // Fetch one more than limit to determine hasMore
      const limit = params.limit;
      query = query.limit(limit + 1);

      const { data, error } = await query;

      if (error !== null) {
        throw new Error(`Failed to get messages: ${error.message}`);
      }

      const rows = (data ?? []) as MessageRow[];
      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit).map(mapRowToMessage);

      const result: PaginatedResult<Message> = { items, hasMore };
      const lastItem = items[items.length - 1];
      if (hasMore && lastItem !== undefined) {
        result.nextCursor = lastItem.createdAt.toISOString();
      }

      return result;
    },

    /**
     * Update message metadata (for redaction)
     * NOTE: Content is immutable, only metadata can change
     */
    async updateMessageMetadata(
      messageId: string,
      metadata: Partial<MessageMetadata>
    ): Promise<Message> {
      // First get existing metadata
      const { data: existing, error: getError } = await supabase
        .from('messages')
        .select('metadata')
        .eq('id', messageId)
        .single();

      if (getError !== null) {
        throw new Error(`Failed to get message metadata: ${getError.message}`);
      }

      // Merge with existing metadata
      const existingMetadata = (existing?.metadata ?? {}) as Record<
        string,
        unknown
      >;
      const updatedMetadata = { ...existingMetadata, ...metadata };

      // Update the metadata
      const { data, error } = await supabase
        .from('messages')
        .update({ metadata: updatedMetadata })
        .eq('id', messageId)
        .select('*')
        .single();

      if (error !== null) {
        throw new Error(`Failed to update message metadata: ${error.message}`);
      }

      return mapRowToMessage(data as MessageRow);
    },
  };
}
