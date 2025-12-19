/**
 * ContextService Unit Tests
 * RED PHASE: All tests should fail with "Not implemented"
 *
 * Reference: docs/stage-2-service-layer.md Section 3.12
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  createContextService,
  type ContextService,
  type ContextServiceUserDep,
  type ContextServiceChatDep,
  type ContextServiceMemoryDep,
  type ContextServiceKnowledgeDep,
  type ContextServicePromptDep,
  type ContextServiceToolDep,
  type ContextServiceRAGConfigDep,
} from '@/services/context.service.js';
import type { ActorContext, ToolDefinition } from '@/types/index.js';
import { SYSTEM_ACTOR, AI_ACTOR } from '@/types/index.js';

// ─────────────────────────────────────────────────────────────
// TEST FIXTURES
// ─────────────────────────────────────────────────────────────

function createUserActor(
  userId: string,
  permissions: string[] = []
): ActorContext {
  return {
    type: 'user',
    userId,
    permissions,
  };
}

function createMockUserService(): ContextServiceUserDep {
  return {
    getAIPreferences: vi.fn().mockResolvedValue({
      success: true,
      data: {
        responseLength: 'balanced',
        formality: 'neutral',
        customInstructions: null,
      },
    }),
  };
}

function createMockChatService(): ContextServiceChatDep {
  return {
    getChat: vi.fn().mockResolvedValue({
      success: true,
      data: { userId: 'user-1' },
    }),
    getMessages: vi.fn().mockResolvedValue({
      success: true,
      data: {
        items: [
          { role: 'user', content: 'Hello', createdAt: new Date() },
          { role: 'assistant', content: 'Hi there!', createdAt: new Date() },
        ],
      },
    }),
    addMessage: vi.fn().mockResolvedValue({
      success: true,
      data: { id: 'msg-123' },
    }),
  };
}

function createMockMemoryService(): ContextServiceMemoryDep {
  return {
    searchMemories: vi.fn().mockResolvedValue({
      success: true,
      data: [
        {
          content: 'User likes TypeScript',
          category: 'preference',
          importance: 0.8,
          similarity: 0.9,
        },
      ],
    }),
  };
}

function createMockKnowledgeService(): ContextServiceKnowledgeDep {
  return {
    searchKnowledge: vi.fn().mockResolvedValue({
      success: true,
      data: [
        {
          title: 'TypeScript Guide',
          content: 'TypeScript is a typed superset of JavaScript.',
          similarity: 0.85,
        },
      ],
    }),
  };
}

function createMockPromptService(): ContextServicePromptDep {
  return {
    getActivePrompt: vi.fn().mockResolvedValue({
      success: true,
      data: { content: 'You are a helpful assistant.' },
    }),
  };
}

function createMockToolService(): ContextServiceToolDep {
  return {
    listAvailableTools: vi.fn().mockResolvedValue({
      success: true,
      data: {
        items: [
          {
            name: 'web_search',
            description: 'Search the web',
            inputSchema: {},
            outputSchema: {},
          },
        ] as ToolDefinition[],
      },
    }),
  };
}

function createMockRAGConfigService(): ContextServiceRAGConfigDep {
  return {
    getActiveConfig: vi.fn().mockResolvedValue({
      success: true,
      data: {
        id: 'rag-config-1',
        name: 'Default Config',
        description: null,
        memoryTokenBudget: 2000,
        knowledgeTokenBudget: 4000,
        conversationTokenBudget: 4000,
        memoryLimit: 10,
        knowledgeLimit: 5,
        minSimilarity: 0.7,
        importanceWeight: 0.3,
        similarityWeight: 0.5,
        recencyWeight: 0.2,
        embeddingModel: 'text-embedding-3-small',
        embeddingDimensions: 1536,
        extractionEnabled: true,
        extractionPrompt: null,
        memoryCategories: ['preference', 'fact', 'event', 'instruction'],
        consolidationEnabled: true,
        consolidationThreshold: 0.85,
        isActive: true,
        authorId: 'system',
        createdAt: new Date(),
        updatedAt: new Date(),
        activatedAt: new Date(),
      },
    }),
  };
}

// ─────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────

describe('ContextService', () => {
  let service: ContextService;
  let mockUserService: ContextServiceUserDep;
  let mockChatService: ContextServiceChatDep;
  let mockMemoryService: ContextServiceMemoryDep;
  let mockKnowledgeService: ContextServiceKnowledgeDep;
  let mockPromptService: ContextServicePromptDep;
  let mockToolService: ContextServiceToolDep;
  let mockRAGConfigService: ContextServiceRAGConfigDep;

  beforeEach(() => {
    mockUserService = createMockUserService();
    mockChatService = createMockChatService();
    mockMemoryService = createMockMemoryService();
    mockKnowledgeService = createMockKnowledgeService();
    mockPromptService = createMockPromptService();
    mockToolService = createMockToolService();
    mockRAGConfigService = createMockRAGConfigService();

    service = createContextService({
      userService: mockUserService,
      chatService: mockChatService,
      memoryService: mockMemoryService,
      knowledgeService: mockKnowledgeService,
      promptService: mockPromptService,
      toolService: mockToolService,
      ragConfigService: mockRAGConfigService,
    });
  });

  // ─────────────────────────────────────────────────────────────
  // buildContext
  // ─────────────────────────────────────────────────────────────

  describe('buildContext', () => {
    it('should build complete context for user', async () => {
      const actor = createUserActor('user-1', ['chat:read', 'memory:read']);

      const result = await service.buildContext(actor, {
        chatId: 'chat-123',
        userMessage: 'Help me with TypeScript',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.version).toBe('v1');
        expect(result.data.chatId).toBe('chat-123');
        expect(result.data.userId).toBe('user-1');
      }
    });

    it('should include core instructions', async () => {
      const actor = createUserActor('user-1');

      const result = await service.buildContext(actor, {
        chatId: 'chat-123',
        userMessage: 'Hello',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.coreInstructions).toBeDefined();
        expect(result.data.coreInstructions.length).toBeGreaterThan(0);
      }
    });

    it('should include system prompt from PromptService', async () => {
      const actor = createUserActor('user-1');

      const result = await service.buildContext(actor, {
        chatId: 'chat-123',
        userMessage: 'Hello',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.systemPrompt).toBe('You are a helpful assistant.');
      }
      expect(mockPromptService.getActivePrompt).toHaveBeenCalled();
    });

    it('should include user preferences from UserService', async () => {
      const actor = createUserActor('user-1');

      const result = await service.buildContext(actor, {
        chatId: 'chat-123',
        userMessage: 'Hello',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.userPreferences.responseLength).toBe('balanced');
        expect(result.data.userPreferences.formality).toBe('neutral');
      }
      expect(mockUserService.getAIPreferences).toHaveBeenCalled();
    });

    it('should include memories from MemoryService', async () => {
      const actor = createUserActor('user-1');

      const result = await service.buildContext(actor, {
        chatId: 'chat-123',
        userMessage: 'Help me with TypeScript',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.memories.length).toBeGreaterThan(0);
        expect(result.data.memories[0].content).toBe('User likes TypeScript');
      }
      expect(mockMemoryService.searchMemories).toHaveBeenCalled();
    });

    it('should include knowledge from KnowledgeService', async () => {
      const actor = createUserActor('user-1');

      const result = await service.buildContext(actor, {
        chatId: 'chat-123',
        userMessage: 'Help me with TypeScript',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.knowledge.length).toBeGreaterThan(0);
        expect(result.data.knowledge[0].title).toBe('TypeScript Guide');
      }
      expect(mockKnowledgeService.searchKnowledge).toHaveBeenCalled();
    });

    it('should include messages from ChatService', async () => {
      const actor = createUserActor('user-1');

      const result = await service.buildContext(actor, {
        chatId: 'chat-123',
        userMessage: 'Hello',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.messages.length).toBe(2);
        expect(result.data.messages[0].role).toBe('user');
      }
      expect(mockChatService.getMessages).toHaveBeenCalled();
    });

    it('should include available tools from ToolService', async () => {
      const actor = createUserActor('user-1');

      const result = await service.buildContext(actor, {
        chatId: 'chat-123',
        userMessage: 'Hello',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tools.length).toBeGreaterThan(0);
        expect(result.data.tools[0].name).toBe('web_search');
      }
    });

    it('should return NOT_FOUND if chat does not exist', async () => {
      vi.mocked(mockChatService.getChat).mockResolvedValue({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Chat not found' },
      });
      const actor = createUserActor('user-1');

      const result = await service.buildContext(actor, {
        chatId: 'nonexistent',
        userMessage: 'Hello',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should return PERMISSION_DENIED if user cannot access chat', async () => {
      vi.mocked(mockChatService.getChat).mockResolvedValue({
        success: false,
        error: { code: 'PERMISSION_DENIED', message: 'Cannot access chat' },
      });
      const actor = createUserActor('user-2');

      const result = await service.buildContext(actor, {
        chatId: 'chat-123',
        userMessage: 'Hello',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow AI_ACTOR to build context', async () => {
      const result = await service.buildContext(AI_ACTOR, {
        chatId: 'chat-123',
        userMessage: 'Hello',
      });

      expect(result.success).toBe(true);
    });

    it('should allow SYSTEM_ACTOR to build context', async () => {
      const result = await service.buildContext(SYSTEM_ACTOR, {
        chatId: 'chat-123',
        userMessage: 'Hello',
      });

      expect(result.success).toBe(true);
    });

    it('should handle missing active prompt gracefully', async () => {
      vi.mocked(mockPromptService.getActivePrompt).mockResolvedValue({
        success: false,
        error: { code: 'NOT_FOUND', message: 'No active prompt' },
      });
      const actor = createUserActor('user-1');

      const result = await service.buildContext(actor, {
        chatId: 'chat-123',
        userMessage: 'Hello',
      });

      // Should still succeed with default/empty system prompt
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.systemPrompt).toBeDefined();
      }
    });

    it('should handle empty memories gracefully', async () => {
      vi.mocked(mockMemoryService.searchMemories).mockResolvedValue({
        success: true,
        data: [],
      });
      const actor = createUserActor('user-1');

      const result = await service.buildContext(actor, {
        chatId: 'chat-123',
        userMessage: 'Hello',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.memories).toEqual([]);
      }
    });

    it('should handle empty knowledge gracefully', async () => {
      vi.mocked(mockKnowledgeService.searchKnowledge).mockResolvedValue({
        success: true,
        data: [],
      });
      const actor = createUserActor('user-1');

      const result = await service.buildContext(actor, {
        chatId: 'chat-123',
        userMessage: 'Hello',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.knowledge).toEqual([]);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // getAvailableTools
  // ─────────────────────────────────────────────────────────────

  describe('getAvailableTools', () => {
    it('should return available tools for user', async () => {
      const actor = createUserActor('user-1');

      const result = await service.getAvailableTools(actor);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBeGreaterThan(0);
        expect(result.data[0].name).toBe('web_search');
      }
    });

    it('should allow AI_ACTOR to get available tools', async () => {
      const result = await service.getAvailableTools(AI_ACTOR);

      expect(result.success).toBe(true);
    });

    it('should allow SYSTEM_ACTOR to get available tools', async () => {
      const result = await service.getAvailableTools(SYSTEM_ACTOR);

      expect(result.success).toBe(true);
    });

    it('should return empty array when no tools available', async () => {
      vi.mocked(mockToolService.listAvailableTools).mockResolvedValue({
        success: true,
        data: { items: [] },
      });
      const actor = createUserActor('user-1');

      const result = await service.getAvailableTools(actor);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual([]);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // persistResponse
  // ─────────────────────────────────────────────────────────────

  describe('persistResponse', () => {
    it('should persist AI response to chat', async () => {
      const actor = createUserActor('user-1');

      const result = await service.persistResponse(actor, {
        chatId: 'chat-123',
        response: {
          content: 'Here is my response.',
          model: 'claude-3',
          tokenCount: 100,
        },
      });

      expect(result.success).toBe(true);
      expect(mockChatService.addMessage).toHaveBeenCalled();
    });

    it('should add message with assistant role', async () => {
      const actor = createUserActor('user-1');

      await service.persistResponse(actor, {
        chatId: 'chat-123',
        response: {
          content: 'Here is my response.',
          model: 'claude-3',
          tokenCount: 100,
        },
      });

      expect(mockChatService.addMessage).toHaveBeenCalledWith(
        expect.anything(),
        'chat-123',
        expect.objectContaining({
          role: 'assistant',
          content: 'Here is my response.',
        })
      );
    });

    it('should include AI actor type in metadata', async () => {
      const actor = createUserActor('user-1');

      await service.persistResponse(actor, {
        chatId: 'chat-123',
        response: {
          content: 'Response',
          model: 'claude-3',
          tokenCount: 100,
        },
      });

      expect(mockChatService.addMessage).toHaveBeenCalledWith(
        expect.anything(),
        'chat-123',
        expect.objectContaining({
          metadata: expect.objectContaining({
            actorType: 'ai',
          }),
        })
      );
    });

    it('should use SYSTEM_ACTOR for writes', async () => {
      const actor = createUserActor('user-1');

      await service.persistResponse(actor, {
        chatId: 'chat-123',
        response: {
          content: 'Response',
          model: 'claude-3',
          tokenCount: 100,
        },
      });

      // The first argument to addMessage should be SYSTEM_ACTOR
      expect(mockChatService.addMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'system' }),
        expect.any(String),
        expect.any(Object)
      );
    });

    it('should return NOT_FOUND if chat does not exist', async () => {
      vi.mocked(mockChatService.addMessage).mockResolvedValue({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Chat not found' },
      });
      const actor = createUserActor('user-1');

      const result = await service.persistResponse(actor, {
        chatId: 'nonexistent',
        response: {
          content: 'Response',
          model: 'claude-3',
          tokenCount: 100,
        },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should handle response with tool calls', async () => {
      const actor = createUserActor('user-1');

      const result = await service.persistResponse(actor, {
        chatId: 'chat-123',
        response: {
          content: 'I searched the web.',
          model: 'claude-3',
          tokenCount: 150,
          toolCalls: [
            {
              toolName: 'web_search',
              input: { query: 'TypeScript' },
              output: { results: [] },
              status: 'success',
            },
          ],
        },
      });

      expect(result.success).toBe(true);
    });

    it('should handle response with memories to create', async () => {
      const actor = createUserActor('user-1');

      const result = await service.persistResponse(actor, {
        chatId: 'chat-123',
        response: {
          content: 'Noted your preference.',
          model: 'claude-3',
          tokenCount: 50,
          memoriesToCreate: ['User prefers dark mode'],
        },
      });

      expect(result.success).toBe(true);
      // Memory creation is deferred, so no immediate call expected
    });

    it('should allow AI_ACTOR to persist response', async () => {
      const result = await service.persistResponse(AI_ACTOR, {
        chatId: 'chat-123',
        response: {
          content: 'Response',
          model: 'claude-3',
          tokenCount: 100,
        },
      });

      expect(result.success).toBe(true);
    });

    it('should allow SYSTEM_ACTOR to persist response', async () => {
      const result = await service.persistResponse(SYSTEM_ACTOR, {
        chatId: 'chat-123',
        response: {
          content: 'Response',
          model: 'claude-3',
          tokenCount: 100,
        },
      });

      expect(result.success).toBe(true);
    });

    it('should include model and token count in metadata', async () => {
      const actor = createUserActor('user-1');

      await service.persistResponse(actor, {
        chatId: 'chat-123',
        response: {
          content: 'Response',
          model: 'claude-3-opus',
          tokenCount: 500,
        },
      });

      expect(mockChatService.addMessage).toHaveBeenCalledWith(
        expect.anything(),
        'chat-123',
        expect.objectContaining({
          metadata: expect.objectContaining({
            model: 'claude-3-opus',
            tokenCount: 500,
          }),
        })
      );
    });
  });
});
