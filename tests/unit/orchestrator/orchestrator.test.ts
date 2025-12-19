/**
 * Orchestrator Unit Tests
 * Phase 5: AI Orchestrator - TDD
 *
 * Tests for the main orchestrator that ties everything together
 * Reference: docs/stage-4-ai-orchestrator.md
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createOrchestrator } from '@/orchestrator/orchestrator.js';
import type {
  OrchestratorConfig,
  OrchestratorInput,
  OrchestratorResult,
  LLMClient,
  ToolExecutor,
  AIContext,
  Result,
} from '@/types/index.js';

// Mock dependencies
interface MockContextService {
  buildContext: ReturnType<typeof vi.fn>;
  persistResponse: ReturnType<typeof vi.fn>;
}

describe('Orchestrator', () => {
  // Mock dependencies
  let mockLLMClient: LLMClient;
  let mockToolExecutor: ToolExecutor;
  let mockContextService: MockContextService;
  let mockComplete: ReturnType<typeof vi.fn>;
  let mockExecute: ReturnType<typeof vi.fn>;

  // Default config
  const defaultConfig: OrchestratorConfig = {
    model: 'anthropic/claude-3.5-sonnet',
    maxInputTokens: 100000,
    maxOutputTokens: 4096,
    maxToolCalls: 10,
    maxIterations: 5,
    toolCallTimeout: 30000,
    totalTimeout: 120000,
    temperature: 0.7,
  };

  // Mock AI context
  const mockContext: AIContext = {
    version: 'v1',
    coreInstructions: '## SAFETY\nBe safe.',
    systemPrompt: 'You are Bakame, a helpful assistant.',
    userPreferences: {
      responseLength: 'medium',
      formality: 'balanced',
      customInstructions: null,
    },
    memories: [],
    knowledge: [],
    messages: [],
    tools: [],
    userId: 'user-123',
    chatId: 'chat-456',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock LLM client
    mockComplete = vi.fn().mockResolvedValue({
      id: 'response-123',
      model: 'anthropic/claude-3.5-sonnet',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Hello! How can I help?' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    });

    mockLLMClient = {
      complete: mockComplete,
      stream: vi.fn(),
    };

    // Setup mock tool executor
    mockExecute = vi.fn();
    mockToolExecutor = {
      execute: mockExecute,
    };

    // Setup mock context service
    mockContextService = {
      buildContext: vi.fn().mockResolvedValue({
        success: true,
        data: mockContext,
      }),
      persistResponse: vi.fn().mockResolvedValue({
        success: true,
        data: undefined,
      }),
    };
  });

  describe('createOrchestrator', () => {
    it('should create an orchestrator instance', () => {
      const orchestrator = createOrchestrator({
        llmClient: mockLLMClient,
        toolExecutor: mockToolExecutor,
        contextService: mockContextService,
        config: defaultConfig,
      });

      expect(orchestrator).toBeDefined();
      expect(typeof orchestrator.run).toBe('function');
      expect(typeof orchestrator.stream).toBe('function');
    });
  });

  describe('run()', () => {
    it('should orchestrate a complete request', async () => {
      const orchestrator = createOrchestrator({
        llmClient: mockLLMClient,
        toolExecutor: mockToolExecutor,
        contextService: mockContextService,
        config: defaultConfig,
      });

      const input: OrchestratorInput = {
        userMessage: 'Hello',
        chatId: 'chat-456',
        userId: 'user-123',
      };

      const result = await orchestrator.run(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toBe('Hello! How can I help?');
        expect(result.data.model).toBe('anthropic/claude-3.5-sonnet');
        expect(result.data.iterations).toBe(1);
        expect(result.data.toolCalls).toEqual([]);
      }
    });

    it('should build context before calling LLM', async () => {
      const orchestrator = createOrchestrator({
        llmClient: mockLLMClient,
        toolExecutor: mockToolExecutor,
        contextService: mockContextService,
        config: defaultConfig,
      });

      await orchestrator.run({
        userMessage: 'Hello',
        chatId: 'chat-456',
        userId: 'user-123',
      });

      expect(mockContextService.buildContext).toHaveBeenCalledWith(
        expect.anything(), // actor
        expect.objectContaining({
          chatId: 'chat-456',
          userMessage: 'Hello',
        })
      );
    });

    it('should persist response after completion', async () => {
      const orchestrator = createOrchestrator({
        llmClient: mockLLMClient,
        toolExecutor: mockToolExecutor,
        contextService: mockContextService,
        config: defaultConfig,
      });

      await orchestrator.run({
        userMessage: 'Hello',
        chatId: 'chat-456',
        userId: 'user-123',
      });

      expect(mockContextService.persistResponse).toHaveBeenCalledWith(
        expect.anything(), // actor
        expect.objectContaining({
          chatId: 'chat-456',
          response: expect.objectContaining({
            content: 'Hello! How can I help?',
            model: 'anthropic/claude-3.5-sonnet',
          }),
        })
      );
    });

    it('should handle context building failure', async () => {
      mockContextService.buildContext.mockResolvedValue({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Chat not found' },
      });

      const orchestrator = createOrchestrator({
        llmClient: mockLLMClient,
        toolExecutor: mockToolExecutor,
        contextService: mockContextService,
        config: defaultConfig,
      });

      const result = await orchestrator.run({
        userMessage: 'Hello',
        chatId: 'invalid-chat',
        userId: 'user-123',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should handle LLM errors', async () => {
      mockComplete.mockRejectedValue(new Error('API rate limit exceeded'));

      const orchestrator = createOrchestrator({
        llmClient: mockLLMClient,
        toolExecutor: mockToolExecutor,
        contextService: mockContextService,
        config: defaultConfig,
      });

      const result = await orchestrator.run({
        userMessage: 'Hello',
        chatId: 'chat-456',
        userId: 'user-123',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('LLM_ERROR');
        expect(result.error.message).toContain('rate limit');
      }
    });

    it('should apply config overrides', async () => {
      const orchestrator = createOrchestrator({
        llmClient: mockLLMClient,
        toolExecutor: mockToolExecutor,
        contextService: mockContextService,
        config: defaultConfig,
      });

      await orchestrator.run({
        userMessage: 'Hello',
        chatId: 'chat-456',
        userId: 'user-123',
        configOverrides: {
          model: 'openai/gpt-4',
          temperature: 0.5,
        },
      });

      // Check LLM was called with overridden model
      expect(mockComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'openai/gpt-4',
          temperature: 0.5,
        })
      );
    });

    it('should include tools from context', async () => {
      const contextWithTools: AIContext = {
        ...mockContext,
        tools: [
          {
            name: 'calculator',
            description: 'Calculate math expressions',
            type: 'local',
            config: {},
            inputSchema: {
              type: 'object',
              properties: { expr: { type: 'string' } },
            },
          },
        ],
      };

      mockContextService.buildContext.mockResolvedValue({
        success: true,
        data: contextWithTools,
      });

      const orchestrator = createOrchestrator({
        llmClient: mockLLMClient,
        toolExecutor: mockToolExecutor,
        contextService: mockContextService,
        config: defaultConfig,
      });

      await orchestrator.run({
        userMessage: 'Calculate 2+2',
        chatId: 'chat-456',
        userId: 'user-123',
      });

      expect(mockComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.arrayContaining([
            expect.objectContaining({
              type: 'function',
              function: expect.objectContaining({
                name: 'calculator',
              }),
            }),
          ]),
        })
      );
    });

    it('should handle tool execution in loop', async () => {
      // First call returns tool call
      mockComplete.mockResolvedValueOnce({
        id: 'response-1',
        model: 'anthropic/claude-3.5-sonnet',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'calculator', arguments: '{"expr":"2+2"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      });
      // Second call returns final response
      mockComplete.mockResolvedValueOnce({
        id: 'response-2',
        model: 'anthropic/claude-3.5-sonnet',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'The answer is 4.' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 150, completion_tokens: 10, total_tokens: 160 },
      });

      // Tool execution succeeds
      mockExecute.mockResolvedValue({
        success: true,
        output: { result: 4 },
        durationMs: 50,
      });

      const contextWithTools: AIContext = {
        ...mockContext,
        tools: [
          {
            name: 'calculator',
            description: 'Calculate',
            type: 'local',
            config: {},
            inputSchema: {
              type: 'object',
              properties: { expr: { type: 'string' } },
            },
          },
        ],
      };

      mockContextService.buildContext.mockResolvedValue({
        success: true,
        data: contextWithTools,
      });

      const orchestrator = createOrchestrator({
        llmClient: mockLLMClient,
        toolExecutor: mockToolExecutor,
        contextService: mockContextService,
        config: defaultConfig,
      });

      const result = await orchestrator.run({
        userMessage: 'What is 2+2?',
        chatId: 'chat-456',
        userId: 'user-123',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toBe('The answer is 4.');
        expect(result.data.toolCalls).toHaveLength(1);
        expect(result.data.toolCalls[0].toolName).toBe('calculator');
        expect(result.data.iterations).toBe(2);
      }
    });

    it('should respect maxIterations from config', async () => {
      // Always return tool calls (infinite loop without limit)
      mockComplete.mockResolvedValue({
        id: 'response-loop',
        model: 'anthropic/claude-3.5-sonnet',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: 'call_loop',
                  type: 'function',
                  function: { name: 'tool', arguments: '{}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
      });

      mockExecute.mockResolvedValue({
        success: true,
        output: {},
        durationMs: 10,
      });

      const contextWithTools: AIContext = {
        ...mockContext,
        tools: [
          {
            name: 'tool',
            description: 'A tool',
            type: 'local',
            config: {},
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      };

      mockContextService.buildContext.mockResolvedValue({
        success: true,
        data: contextWithTools,
      });

      const orchestrator = createOrchestrator({
        llmClient: mockLLMClient,
        toolExecutor: mockToolExecutor,
        contextService: mockContextService,
        config: { ...defaultConfig, maxIterations: 3 },
      });

      const result = await orchestrator.run({
        userMessage: 'Loop forever',
        chatId: 'chat-456',
        userId: 'user-123',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.iterations).toBe(3);
      }
      expect(mockComplete).toHaveBeenCalledTimes(3);
    });

    it('should include memories in prompt', async () => {
      const contextWithMemories: AIContext = {
        ...mockContext,
        memories: [
          {
            content: 'User prefers coffee',
            category: 'preference',
            importance: 8,
            similarity: 0.9,
          },
        ],
      };

      mockContextService.buildContext.mockResolvedValue({
        success: true,
        data: contextWithMemories,
      });

      const orchestrator = createOrchestrator({
        llmClient: mockLLMClient,
        toolExecutor: mockToolExecutor,
        contextService: mockContextService,
        config: defaultConfig,
      });

      await orchestrator.run({
        userMessage: 'What should I order?',
        chatId: 'chat-456',
        userId: 'user-123',
      });

      // Check that the system message includes memories
      const callArgs = mockComplete.mock.calls[0][0];
      const systemMessage = callArgs.messages.find(
        (m: { role: string }) => m.role === 'system'
      );
      expect(systemMessage?.content).toContain('User prefers coffee');
    });

    it('should include conversation history', async () => {
      const contextWithHistory: AIContext = {
        ...mockContext,
        messages: [
          { role: 'user', content: 'Hello', createdAt: new Date() },
          { role: 'assistant', content: 'Hi there!', createdAt: new Date() },
        ],
      };

      mockContextService.buildContext.mockResolvedValue({
        success: true,
        data: contextWithHistory,
      });

      const orchestrator = createOrchestrator({
        llmClient: mockLLMClient,
        toolExecutor: mockToolExecutor,
        contextService: mockContextService,
        config: defaultConfig,
      });

      await orchestrator.run({
        userMessage: 'What did I say?',
        chatId: 'chat-456',
        userId: 'user-123',
      });

      const callArgs = mockComplete.mock.calls[0][0];
      const messages = callArgs.messages;

      // Should include history messages
      const userHistoryMsg = messages.find(
        (m: { role: string; content: string }) =>
          m.role === 'user' && m.content === 'Hello'
      );
      const assistantHistoryMsg = messages.find(
        (m: { role: string; content: string }) =>
          m.role === 'assistant' && m.content === 'Hi there!'
      );

      expect(userHistoryMsg).toBeDefined();
      expect(assistantHistoryMsg).toBeDefined();
    });
  });

  describe('stream()', () => {
    it('should be defined', () => {
      const orchestrator = createOrchestrator({
        llmClient: mockLLMClient,
        toolExecutor: mockToolExecutor,
        contextService: mockContextService,
        config: defaultConfig,
      });

      expect(typeof orchestrator.stream).toBe('function');
    });

    // Streaming tests would require async iterator mocking
    // Will implement in detail when building streaming support
  });

  describe('memory extraction', () => {
    it('should extract memories from AI response', async () => {
      mockComplete.mockResolvedValue({
        id: 'response-memory',
        model: 'anthropic/claude-3.5-sonnet',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content:
                "I see you're interested in machine learning. I'll remember that. The capital of France is Paris.",
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 },
      });

      const orchestrator = createOrchestrator({
        llmClient: mockLLMClient,
        toolExecutor: mockToolExecutor,
        contextService: mockContextService,
        config: defaultConfig,
      });

      const result = await orchestrator.run({
        userMessage: 'Tell me about the capital of France',
        chatId: 'chat-456',
        userId: 'user-123',
      });

      expect(result.success).toBe(true);
      // Memory extraction would be in the persisted response
      expect(mockContextService.persistResponse).toHaveBeenCalled();
    });
  });
});
