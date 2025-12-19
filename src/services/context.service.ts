/**
 * ContextService
 * Assembles context for AI orchestrator - bridge between services and AI
 *
 * Reference: docs/stage-2-service-layer.md Section 3.12
 *
 * SCOPE: Context assembly for AI orchestrator
 *
 * Owns: No tables (reads from other services)
 *
 * Dependencies:
 * - UserService (preferences)
 * - ChatService (messages)
 * - MemoryService (memories)
 * - KnowledgeService (RAG)
 * - PromptService (system prompt)
 * - ToolService (available tools)
 *
 * ACTOR PATTERN (CRITICAL):
 * - ContextService internally uses SYSTEM_ACTOR for writes
 * - Message metadata.actorType = 'ai' records AI origin
 * - This avoids giving AI_ACTOR write permissions
 */

import type {
  ActorContext,
  Result,
  AIContext,
  BuildContextParams,
  PersistResponseParams,
  ToolDefinition,
  MemoryContext,
  KnowledgeContext,
  MessageContext,
  RAGConfig,
} from '@/types/index.js';
import {
  success,
  failure,
  SYSTEM_ACTOR,
  DEFAULT_RAG_CONFIG,
} from '@/types/index.js';

/**
 * Core instructions (Layer 1) - immutable safety rules
 */
const CORE_INSTRUCTIONS = `You are a helpful AI assistant. Follow these core principles:
1. Be helpful, harmless, and honest.
2. Respect user privacy and do not share personal information.
3. If you don't know something, say so.
4. Follow the user's instructions unless they conflict with safety.`;

/**
 * Default system prompt when none is active
 */
const DEFAULT_SYSTEM_PROMPT = 'You are a helpful AI assistant.';

/**
 * UserService dependency interface
 */
export interface ContextServiceUserDep {
  getAIPreferences: (
    actor: ActorContext,
    userId: string
  ) => Promise<
    Result<{
      responseLength: string;
      formality: string;
      customInstructions: string | null;
    }>
  >;
}

/**
 * ChatService dependency interface
 */
export interface ContextServiceChatDep {
  getChat: (
    actor: ActorContext,
    chatId: string
  ) => Promise<Result<{ userId: string }>>;
  getMessages: (
    actor: ActorContext,
    chatId: string,
    params: { limit?: number }
  ) => Promise<
    Result<{
      items: Array<{
        role: 'user' | 'assistant' | 'system' | 'tool';
        content: string;
        createdAt: Date;
      }>;
    }>
  >;
  addMessage: (
    actor: ActorContext,
    chatId: string,
    params: {
      role: 'user' | 'assistant' | 'system' | 'tool';
      content: string;
      metadata?: Record<string, unknown>;
    }
  ) => Promise<Result<{ id: string }>>;
}

/**
 * MemoryService dependency interface
 */
export interface ContextServiceMemoryDep {
  searchMemories: (
    actor: ActorContext,
    params: { userId: string; query: string; limit?: number }
  ) => Promise<
    Result<
      Array<{
        content: string;
        category: string | null;
        importance: number;
        similarity: number;
      }>
    >
  >;
}

/**
 * KnowledgeService dependency interface
 */
export interface ContextServiceKnowledgeDep {
  searchKnowledge: (
    actor: ActorContext,
    params: { query: string; limit?: number }
  ) => Promise<
    Result<
      Array<{
        title: string;
        content: string;
        similarity: number;
      }>
    >
  >;
}

/**
 * PromptService dependency interface
 */
export interface ContextServicePromptDep {
  getActivePrompt: (
    actor: ActorContext
  ) => Promise<Result<{ content: string }>>;
}

/**
 * ToolService dependency interface
 */
export interface ContextServiceToolDep {
  listAvailableTools: (
    actor: ActorContext
  ) => Promise<Result<{ items: ToolDefinition[] }>>;
}

/**
 * RAGConfigService dependency interface
 */
export interface ContextServiceRAGConfigDep {
  getActiveConfig: (actor: ActorContext) => Promise<Result<RAGConfig>>;
}

/**
 * ContextService interface
 */
export interface ContextService {
  buildContext: (
    actor: ActorContext,
    params: BuildContextParams
  ) => Promise<Result<AIContext>>;

  getAvailableTools: (actor: ActorContext) => Promise<Result<ToolDefinition[]>>;

  persistResponse: (
    actor: ActorContext,
    params: PersistResponseParams
  ) => Promise<Result<void>>;
}

/**
 * Create ContextService instance
 */
export function createContextService(deps: {
  userService: ContextServiceUserDep;
  chatService: ContextServiceChatDep;
  memoryService: ContextServiceMemoryDep;
  knowledgeService: ContextServiceKnowledgeDep;
  promptService: ContextServicePromptDep;
  toolService: ContextServiceToolDep;
  ragConfigService: ContextServiceRAGConfigDep;
}): ContextService {
  const {
    userService,
    chatService,
    memoryService,
    knowledgeService,
    promptService,
    toolService,
    ragConfigService,
  } = deps;

  return {
    async buildContext(
      actor: ActorContext,
      params: BuildContextParams
    ): Promise<Result<AIContext>> {
      const { chatId, userMessage } = params;

      // 1. Validate chat access and get userId
      const chatResult = await chatService.getChat(actor, chatId);
      if (!chatResult.success) {
        return failure(chatResult.error.code, chatResult.error.message);
      }
      const userId = chatResult.data.userId;

      // 2. Get active RAG config (determines retrieval limits)
      // Gracefully fall back to defaults if no active config
      let ragConfig = DEFAULT_RAG_CONFIG;
      const ragConfigResult = await ragConfigService.getActiveConfig(actor);
      if (ragConfigResult.success) {
        ragConfig = ragConfigResult.data;
      }

      // 3. Get system prompt (Layer 2)
      let systemPrompt = DEFAULT_SYSTEM_PROMPT;
      const promptResult = await promptService.getActivePrompt(actor);
      if (promptResult.success) {
        systemPrompt = promptResult.data.content;
      }
      // If no active prompt, use default (graceful degradation)

      // 4. Get user preferences (Layer 3)
      let userPreferences = {
        responseLength: 'balanced',
        formality: 'neutral',
        customInstructions: null as string | null,
      };
      const prefsResult = await userService.getAIPreferences(actor, userId);
      if (prefsResult.success) {
        userPreferences = prefsResult.data;
      }

      // 5. Get memories (Layer 4) - use RAG config limits
      const memories: MemoryContext[] = [];
      const memoriesResult = await memoryService.searchMemories(actor, {
        userId,
        query: userMessage,
        limit: ragConfig.memoryLimit,
      });
      if (memoriesResult.success) {
        for (const mem of memoriesResult.data) {
          memories.push({
            content: mem.content,
            category: mem.category,
            importance: mem.importance,
            similarity: mem.similarity,
          });
        }
      }

      // 6. Get knowledge (Layer 4 - RAG) - use RAG config limits
      const knowledge: KnowledgeContext[] = [];
      const knowledgeResult = await knowledgeService.searchKnowledge(actor, {
        query: userMessage,
        limit: ragConfig.knowledgeLimit,
      });
      if (knowledgeResult.success) {
        for (const item of knowledgeResult.data) {
          knowledge.push({
            title: item.title,
            chunk: item.content,
            similarity: item.similarity,
          });
        }
      }

      // 7. Get messages (Layer 5) - use RAG config conversation budget
      // Estimate ~100 tokens per message on average for limit calculation
      const messageLimit = Math.max(
        10,
        Math.floor(ragConfig.conversationTokenBudget / 100)
      );
      const messages: MessageContext[] = [];
      const messagesResult = await chatService.getMessages(actor, chatId, {
        limit: messageLimit,
      });
      if (messagesResult.success) {
        for (const msg of messagesResult.data.items) {
          messages.push({
            role: msg.role,
            content: msg.content,
            createdAt: msg.createdAt,
          });
        }
      }

      // 8. Get available tools
      const tools: ToolDefinition[] = [];
      const toolsResult = await toolService.listAvailableTools(actor);
      if (toolsResult.success) {
        tools.push(...toolsResult.data.items);
      }

      // Assemble complete context
      const context: AIContext = {
        version: 'v1',
        coreInstructions: CORE_INSTRUCTIONS,
        systemPrompt,
        userPreferences,
        memories,
        knowledge,
        messages,
        tools,
        userId,
        chatId,
      };

      return success(context);
    },

    async getAvailableTools(
      actor: ActorContext
    ): Promise<Result<ToolDefinition[]>> {
      const result = await toolService.listAvailableTools(actor);
      if (!result.success) {
        return failure(result.error.code, result.error.message);
      }
      return success(result.data.items);
    },

    async persistResponse(
      _actor: ActorContext,
      params: PersistResponseParams
    ): Promise<Result<void>> {
      const { chatId, response } = params;

      // CRITICAL: Use SYSTEM_ACTOR for writes
      // This avoids giving AI_ACTOR write permissions
      // The metadata.actorType = 'ai' records the logical origin

      const metadata: Record<string, unknown> = {
        actorType: 'ai',
        model: response.model,
        tokenCount: response.tokenCount,
      };

      if (response.toolCalls !== undefined && response.toolCalls.length > 0) {
        metadata.toolCalls = response.toolCalls;
      }

      // Add AI response message using SYSTEM_ACTOR
      const addResult = await chatService.addMessage(SYSTEM_ACTOR, chatId, {
        role: 'assistant',
        content: response.content,
        metadata,
      });

      if (!addResult.success) {
        return failure(addResult.error.code, addResult.error.message);
      }

      // DEFERRED actions (enqueued for background processing):
      // - MemoryService.createMemory() for memoriesToCreate
      // - SubscriptionService.recordUsage() for token usage
      // These are NOT implemented synchronously to avoid timeouts

      return success(undefined);
    },
  };
}
