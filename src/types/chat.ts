/**
 * ChatService Types
 * From Stage 2: Service Layer Design - Section 3.3
 *
 * SCOPE: Conversation management (persistence-only)
 * NOT IN SCOPE: AI orchestration, prompt construction, tool execution
 *
 * CRITICAL POLICY: Messages are IMMUTABLE (append-only)
 * - No updateMessage method
 * - No deleteMessage method
 * - Redaction = soft delete (metadata.redacted = true)
 */

/**
 * Chat entity - conversation container
 */
export interface Chat {
  id: string;
  userId: string;
  title: string | null;
  status: ChatStatus;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Chat status
 */
export type ChatStatus = 'active' | 'archived' | 'deleted';

/**
 * Chat summary for listing (lighter than full Chat)
 */
export interface ChatSummary {
  id: string;
  title: string | null;
  status: 'active' | 'archived';
  lastMessageAt: Date | null;
  messageCount: number;
  createdAt: Date;
}

/**
 * Chat update parameters
 */
export interface ChatUpdate {
  title?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Parameters for creating a chat
 */
export interface CreateChatParams {
  title?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Parameters for listing chats
 */
export interface ListChatsParams {
  status?: 'active' | 'archived';
  limit: number;
  cursor?: string;
}

/**
 * Message entity - individual turn in a chat
 * IMMUTABLE: Messages cannot be updated or deleted
 */
export interface Message {
  id: string;
  chatId: string;
  role: MessageRole;
  content: string;
  metadata: MessageMetadata;
  createdAt: Date;
}

/**
 * Message role
 */
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

/**
 * Message metadata
 */
export interface MessageMetadata {
  model?: string;
  tokenCount?: number;
  toolCalls?: ToolCall[];
  redacted?: boolean;
  redactedAt?: Date;
  redactedReason?: string;
  replacesId?: string;
}

/**
 * Tool call record within message metadata
 */
export interface ToolCall {
  toolId: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  status: 'success' | 'failure';
}

/**
 * Parameters for adding a message
 */
export interface AddMessageParams {
  chatId: string;
  role: MessageRole;
  content: string;
  metadata?: Partial<MessageMetadata>;
}

/**
 * Parameters for getting messages
 */
export interface GetMessagesParams {
  limit: number;
  cursor?: string;
}
