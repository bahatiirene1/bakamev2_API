/**
 * API Layer Types
 * Types specific to the HTTP/API layer
 */

import type { ActorContext } from '@/types/index.js';

/**
 * Extended Hono context with actor
 */
declare module 'hono' {
  interface ContextVariableMap {
    actor: ActorContext;
    requestId: string;
  }
}

/**
 * Standard success response format
 */
export interface SuccessResponse<T> {
  data: T;
  meta?: {
    pagination?: PaginationMeta;
    requestId: string;
  };
}

/**
 * Standard error response format
 */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId: string;
  };
}

/**
 * Pagination metadata
 */
export interface PaginationMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * Error code to HTTP status mapping
 */
export const ERROR_STATUS_MAP: Record<string, number> = {
  UNAUTHORIZED: 401,
  PERMISSION_DENIED: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  ALREADY_EXISTS: 409,
  CONFLICT: 409,
  INVALID_STATE: 400,
  RATE_LIMITED: 429,
  QUOTA_EXCEEDED: 402,
  INTERNAL_ERROR: 500,
};

/**
 * Get HTTP status code from error code
 */
export function getErrorStatus(code: string): number {
  return ERROR_STATUS_MAP[code] ?? 500;
}

/**
 * Service context for dependency injection
 */
export interface ApiServices {
  authService: {
    resolvePermissions: (userId: string) => Promise<{
      success: boolean;
      data?: string[];
      error?: { code: string; message: string };
    }>;
  };
  userService: {
    getUser: (actor: ActorContext, userId: string) => Promise<unknown>;
    getProfile: (actor: ActorContext, userId: string) => Promise<unknown>;
    updateProfile: (
      actor: ActorContext,
      userId: string,
      data: unknown
    ) => Promise<unknown>;
    getAIPreferences: (actor: ActorContext, userId: string) => Promise<unknown>;
    updateAIPreferences: (
      actor: ActorContext,
      userId: string,
      data: unknown
    ) => Promise<unknown>;
  };
  chatService: {
    createChat: (actor: ActorContext, params: unknown) => Promise<unknown>;
    getChat: (actor: ActorContext, chatId: string) => Promise<unknown>;
    listChats: (actor: ActorContext, params: unknown) => Promise<unknown>;
    updateChat: (
      actor: ActorContext,
      chatId: string,
      data: unknown
    ) => Promise<unknown>;
    archiveChat: (actor: ActorContext, chatId: string) => Promise<unknown>;
    addMessage: (actor: ActorContext, params: unknown) => Promise<unknown>;
    getMessages: (
      actor: ActorContext,
      chatId: string,
      params: unknown
    ) => Promise<unknown>;
  };
  memoryService: {
    createMemory: (actor: ActorContext, params: unknown) => Promise<unknown>;
    getMemory: (actor: ActorContext, memoryId: string) => Promise<unknown>;
    listMemories: (
      actor: ActorContext,
      userId: string,
      params: unknown
    ) => Promise<unknown>;
    updateMemory: (
      actor: ActorContext,
      memoryId: string,
      data: unknown
    ) => Promise<unknown>;
    deleteMemory: (actor: ActorContext, memoryId: string) => Promise<unknown>;
    searchMemories: (
      actor: ActorContext,
      userId: string,
      params: unknown
    ) => Promise<unknown>;
  };
  subscriptionService: {
    getSubscription: (actor: ActorContext, userId: string) => Promise<unknown>;
    getUsageSummary: (actor: ActorContext, params: unknown) => Promise<unknown>;
    hasEntitlement: (
      actor: ActorContext,
      userId: string,
      feature: string
    ) => Promise<unknown>;
  };
  toolService: {
    listAvailableTools: (actor: ActorContext) => Promise<unknown>;
    getTool: (actor: ActorContext, toolId: string) => Promise<unknown>;
  };
  knowledgeService: {
    createKnowledgeItem: (
      actor: ActorContext,
      params: unknown
    ) => Promise<unknown>;
    getKnowledgeItem: (actor: ActorContext, itemId: string) => Promise<unknown>;
    listKnowledgeItems: (
      actor: ActorContext,
      params: unknown
    ) => Promise<unknown>;
    updateKnowledgeItem: (
      actor: ActorContext,
      itemId: string,
      data: unknown
    ) => Promise<unknown>;
    searchKnowledge: (actor: ActorContext, params: unknown) => Promise<unknown>;
  };
  auditService: {
    queryLogs: (actor: ActorContext, params: unknown) => Promise<unknown>;
  };
  promptService: {
    createPrompt: (actor: ActorContext, params: unknown) => Promise<unknown>;
    getPrompt: (actor: ActorContext, promptId: string) => Promise<unknown>;
    listPrompts: (actor: ActorContext, params: unknown) => Promise<unknown>;
    updatePrompt: (
      actor: ActorContext,
      promptId: string,
      data: unknown
    ) => Promise<unknown>;
    activatePrompt: (actor: ActorContext, promptId: string) => Promise<unknown>;
  };
  approvalService: {
    getRequest: (actor: ActorContext, requestId: string) => Promise<unknown>;
    listPendingRequests: (
      actor: ActorContext,
      params: unknown
    ) => Promise<unknown>;
    approve: (
      actor: ActorContext,
      requestId: string,
      comment?: string
    ) => Promise<unknown>;
    reject: (
      actor: ActorContext,
      requestId: string,
      reason: string
    ) => Promise<unknown>;
  };
}
