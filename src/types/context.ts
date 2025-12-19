/**
 * Service Context Definition
 * From Stage 2: Service Layer Design
 *
 * Every service method receives a context object containing:
 * - User information (for permission checks)
 * - Request metadata (for audit logging)
 */

import type { ToolDefinition } from './tool.js';

export interface ServiceContext {
  /** Authenticated user ID (from Supabase Auth) */
  userId: string;

  /** User's organization ID */
  organizationId: string;

  /** User's role within the organization */
  role: 'owner' | 'admin' | 'member';

  /** Request ID for tracing */
  requestId: string;

  /** Source of the request */
  source: 'api' | 'orchestrator' | 'worker' | 'system';

  /** Optional: IP address for audit */
  ipAddress?: string;

  /** Optional: User agent for audit */
  userAgent?: string;
}

/**
 * System context for background jobs and internal operations
 */
export interface SystemContext extends Omit<ServiceContext, 'role'> {
  source: 'system' | 'worker';
  role: 'system';
}

/**
 * Create a system context for background operations
 */
export function createSystemContext(
  organizationId: string,
  requestId: string
): SystemContext {
  return {
    userId: 'system',
    organizationId,
    role: 'system',
    requestId,
    source: 'system',
  };
}

// ─────────────────────────────────────────────────────────────
// AI CONTEXT TYPES (ContextService)
// Reference: docs/stage-2-service-layer.md Section 3.12
// ─────────────────────────────────────────────────────────────

/**
 * Memory context for AI
 */
export interface MemoryContext {
  content: string;
  category: string | null;
  importance: number;
  similarity: number;
}

/**
 * Knowledge context for RAG
 */
export interface KnowledgeContext {
  title: string;
  chunk: string;
  similarity: number;
}

/**
 * Message context for conversation history
 */
export interface MessageContext {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  createdAt: Date;
}

/**
 * User preferences for AI behavior
 */
export interface UserPreferencesContext {
  responseLength: string;
  formality: string;
  customInstructions: string | null;
}

/**
 * Complete AI context assembled by ContextService
 */
export interface AIContext {
  /** Version for future compatibility */
  version: 'v1';

  /** Layer 1: Immutable core (hardcoded safety rules) */
  coreInstructions: string;

  /** Layer 2: System prompt (governed, from PromptService) */
  systemPrompt: string;

  /** Layer 3: User preferences (from UserService) */
  userPreferences: UserPreferencesContext;

  /** Layer 4: Retrieved memories */
  memories: MemoryContext[];

  /** Layer 4: Retrieved knowledge (RAG) */
  knowledge: KnowledgeContext[];

  /** Layer 5: Conversation history */
  messages: MessageContext[];

  /** Available tools for this user */
  tools: ToolDefinition[];

  /** User ID */
  userId: string;

  /** Chat ID */
  chatId: string;
}

/**
 * Tool call result from AI execution
 */
export interface ToolCallResult {
  toolName: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  status: 'success' | 'failure';
}

/**
 * AI response to persist
 */
export interface AIResponse {
  content: string;
  model: string;
  tokenCount: number;
  toolCalls?: ToolCallResult[];
  /** AI-suggested memories to create */
  memoriesToCreate?: string[];
}

/**
 * Parameters for building context
 */
export interface BuildContextParams {
  chatId: string;
  userMessage: string;
}

/**
 * Parameters for persisting response
 */
export interface PersistResponseParams {
  chatId: string;
  response: AIResponse;
}
