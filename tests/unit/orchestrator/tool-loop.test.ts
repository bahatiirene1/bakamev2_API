/**
 * Tool Loop Unit Tests
 * Phase 5: AI Orchestrator - TDD
 *
 * Tests for tool execution loop with iteration limits
 * Reference: docs/stage-4-ai-orchestrator.md Section 2.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createToolLoop, ToolLoopConfig } from '@/orchestrator/tool-loop.js';
import type {
  LLMClient,
  LLMRequest,
  LLMResponse,
  LLMMessage,
  ToolExecutor,
  ToolExecutionResult,
} from '@/types/index.js';

describe('Tool Loop', () => {
  // Mock LLM client
  let mockLLMClient: LLMClient;
  let mockComplete: ReturnType<typeof vi.fn>;

  // Mock tool executor
  let mockToolExecutor: ToolExecutor;
  let mockExecute: ReturnType<typeof vi.fn>;

  // Default config
  const defaultConfig: ToolLoopConfig = {
    maxIterations: 5,
    maxToolCalls: 10,
    toolCallTimeout: 30000,
  };

  // Helper to create a mock LLM response
  function createLLMResponse(
    overrides: Partial<LLMResponse> = {}
  ): LLMResponse {
    return {
      id: 'response-123',
      model: 'anthropic/claude-3.5-sonnet',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'Hello!',
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 10,
        total_tokens: 110,
      },
      ...overrides,
    };
  }

  // Helper to create a tool call response
  function createToolCallResponse(
    toolCalls: Array<{
      id: string;
      name: string;
      arguments: string;
    }>
  ): LLMResponse {
    return createLLMResponse({
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: '',
            tool_calls: toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function' as const,
              function: {
                name: tc.name,
                arguments: tc.arguments,
              },
            })),
          },
          finish_reason: 'tool_calls',
        },
      ],
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock LLM client
    mockComplete = vi.fn();
    mockLLMClient = {
      complete: mockComplete,
      stream: vi.fn(),
    };

    // Setup mock tool executor
    mockExecute = vi.fn();
    mockToolExecutor = {
      execute: mockExecute,
    };
  });

  describe('createToolLoop', () => {
    it('should create a tool loop instance', () => {
      const loop = createToolLoop({
        llmClient: mockLLMClient,
        toolExecutor: mockToolExecutor,
        config: defaultConfig,
      });

      expect(loop).toBeDefined();
      expect(typeof loop.run).toBe('function');
    });
  });

  describe('run()', () => {
    describe('no tool calls', () => {
      it('should return immediately when LLM returns no tool calls', async () => {
        mockComplete.mockResolvedValue(createLLMResponse());

        const loop = createToolLoop({
          llmClient: mockLLMClient,
          toolExecutor: mockToolExecutor,
          config: defaultConfig,
        });

        const result = await loop.run({
          messages: [
            { role: 'system', content: 'You are helpful' },
            { role: 'user', content: 'Hello' },
          ],
          model: 'anthropic/claude-3.5-sonnet',
        });

        expect(result.content).toBe('Hello!');
        expect(result.iterations).toBe(1);
        expect(result.toolCalls).toEqual([]);
        expect(mockComplete).toHaveBeenCalledTimes(1);
        expect(mockExecute).not.toHaveBeenCalled();
      });
    });

    describe('single tool call', () => {
      it('should execute tool and continue loop', async () => {
        // First call returns tool call
        mockComplete.mockResolvedValueOnce(
          createToolCallResponse([
            { id: 'call_1', name: 'calculator', arguments: '{"expr":"2+2"}' },
          ])
        );
        // Second call returns final response
        mockComplete.mockResolvedValueOnce(
          createLLMResponse({
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'The answer is 4.' },
                finish_reason: 'stop',
              },
            ],
          })
        );

        // Tool execution succeeds
        mockExecute.mockResolvedValue({
          success: true,
          output: { result: 4 },
          durationMs: 50,
        });

        const loop = createToolLoop({
          llmClient: mockLLMClient,
          toolExecutor: mockToolExecutor,
          config: defaultConfig,
        });

        const result = await loop.run({
          messages: [{ role: 'user', content: 'What is 2+2?' }],
          model: 'anthropic/claude-3.5-sonnet',
        });

        expect(result.content).toBe('The answer is 4.');
        expect(result.iterations).toBe(2);
        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls[0].toolName).toBe('calculator');
        expect(result.toolCalls[0].status).toBe('success');
        expect(mockComplete).toHaveBeenCalledTimes(2);
        expect(mockExecute).toHaveBeenCalledTimes(1);
      });

      it('should include tool result in next LLM request', async () => {
        mockComplete
          .mockResolvedValueOnce(
            createToolCallResponse([
              { id: 'call_1', name: 'calculator', arguments: '{"expr":"2+2"}' },
            ])
          )
          .mockResolvedValueOnce(createLLMResponse());

        mockExecute.mockResolvedValue({
          success: true,
          output: { result: 4 },
          durationMs: 50,
        });

        const loop = createToolLoop({
          llmClient: mockLLMClient,
          toolExecutor: mockToolExecutor,
          config: defaultConfig,
        });

        await loop.run({
          messages: [{ role: 'user', content: 'What is 2+2?' }],
          model: 'anthropic/claude-3.5-sonnet',
        });

        // Check second LLM call includes tool result
        const secondCall = mockComplete.mock.calls[1][0] as LLMRequest;
        const toolResultMessage = secondCall.messages.find(
          (m) => m.role === 'tool'
        );
        expect(toolResultMessage).toBeDefined();
        expect(toolResultMessage?.content).toContain('"result":4');
        expect(toolResultMessage?.tool_call_id).toBe('call_1');
      });
    });

    describe('multiple tool calls', () => {
      it('should execute multiple tools in parallel', async () => {
        mockComplete
          .mockResolvedValueOnce(
            createToolCallResponse([
              { id: 'call_1', name: 'calculator', arguments: '{"expr":"2+2"}' },
              { id: 'call_2', name: 'weather', arguments: '{"city":"Kigali"}' },
            ])
          )
          .mockResolvedValueOnce(createLLMResponse());

        mockExecute
          .mockResolvedValueOnce({
            success: true,
            output: { result: 4 },
            durationMs: 50,
          })
          .mockResolvedValueOnce({
            success: true,
            output: { temp: 25, condition: 'sunny' },
            durationMs: 100,
          });

        const loop = createToolLoop({
          llmClient: mockLLMClient,
          toolExecutor: mockToolExecutor,
          config: defaultConfig,
        });

        const result = await loop.run({
          messages: [
            {
              role: 'user',
              content: 'Calculate 2+2 and get weather in Kigali',
            },
          ],
          model: 'anthropic/claude-3.5-sonnet',
        });

        expect(result.toolCalls).toHaveLength(2);
        expect(mockExecute).toHaveBeenCalledTimes(2);
      });

      it('should handle partial tool failures', async () => {
        mockComplete
          .mockResolvedValueOnce(
            createToolCallResponse([
              { id: 'call_1', name: 'calculator', arguments: '{"expr":"2+2"}' },
              {
                id: 'call_2',
                name: 'weather',
                arguments: '{"city":"unknown"}',
              },
            ])
          )
          .mockResolvedValueOnce(createLLMResponse());

        mockExecute
          .mockResolvedValueOnce({
            success: true,
            output: { result: 4 },
            durationMs: 50,
          })
          .mockResolvedValueOnce({
            success: false,
            output: {},
            errorMessage: 'City not found',
            durationMs: 100,
          });

        const loop = createToolLoop({
          llmClient: mockLLMClient,
          toolExecutor: mockToolExecutor,
          config: defaultConfig,
        });

        const result = await loop.run({
          messages: [{ role: 'user', content: 'Test' }],
          model: 'anthropic/claude-3.5-sonnet',
        });

        expect(result.toolCalls).toHaveLength(2);
        expect(result.toolCalls[0].status).toBe('success');
        expect(result.toolCalls[1].status).toBe('failure');
      });
    });

    describe('iteration limits', () => {
      it('should stop at maxIterations', async () => {
        // Always return tool calls (would loop forever without limit)
        mockComplete.mockResolvedValue(
          createToolCallResponse([
            { id: 'call_1', name: 'calculator', arguments: '{"expr":"1+1"}' },
          ])
        );
        mockExecute.mockResolvedValue({
          success: true,
          output: { result: 2 },
          durationMs: 10,
        });

        const loop = createToolLoop({
          llmClient: mockLLMClient,
          toolExecutor: mockToolExecutor,
          config: { ...defaultConfig, maxIterations: 3 },
        });

        const result = await loop.run({
          messages: [{ role: 'user', content: 'Loop forever' }],
          model: 'anthropic/claude-3.5-sonnet',
        });

        expect(result.iterations).toBe(3);
        expect(result.stoppedReason).toBe('max_iterations');
        expect(mockComplete).toHaveBeenCalledTimes(3);
      });

      it('should stop at maxToolCalls', async () => {
        // Return 3 tool calls each iteration
        mockComplete.mockResolvedValue(
          createToolCallResponse([
            { id: 'call_1', name: 't1', arguments: '{}' },
            { id: 'call_2', name: 't2', arguments: '{}' },
            { id: 'call_3', name: 't3', arguments: '{}' },
          ])
        );
        mockExecute.mockResolvedValue({
          success: true,
          output: {},
          durationMs: 10,
        });

        const loop = createToolLoop({
          llmClient: mockLLMClient,
          toolExecutor: mockToolExecutor,
          config: { ...defaultConfig, maxToolCalls: 5 },
        });

        const result = await loop.run({
          messages: [{ role: 'user', content: 'Many tools' }],
          model: 'anthropic/claude-3.5-sonnet',
        });

        // Should stop after hitting 5 tool calls (iteration 2, 3+3=6 > 5)
        expect(result.stoppedReason).toBe('max_tool_calls');
        expect(result.toolCalls.length).toBeLessThanOrEqual(5);
      });
    });

    describe('error handling', () => {
      it('should handle LLM client errors', async () => {
        mockComplete.mockRejectedValue(new Error('API timeout'));

        const loop = createToolLoop({
          llmClient: mockLLMClient,
          toolExecutor: mockToolExecutor,
          config: defaultConfig,
        });

        await expect(
          loop.run({
            messages: [{ role: 'user', content: 'Hello' }],
            model: 'anthropic/claude-3.5-sonnet',
          })
        ).rejects.toThrow('API timeout');
      });

      it('should continue loop even when tool execution fails', async () => {
        mockComplete
          .mockResolvedValueOnce(
            createToolCallResponse([
              { id: 'call_1', name: 'calculator', arguments: '{"expr":"bad"}' },
            ])
          )
          .mockResolvedValueOnce(
            createLLMResponse({
              choices: [
                {
                  index: 0,
                  message: {
                    role: 'assistant',
                    content: 'Sorry, the calculation failed.',
                  },
                  finish_reason: 'stop',
                },
              ],
            })
          );

        mockExecute.mockResolvedValue({
          success: false,
          output: {},
          errorMessage: 'Invalid expression',
          durationMs: 10,
        });

        const loop = createToolLoop({
          llmClient: mockLLMClient,
          toolExecutor: mockToolExecutor,
          config: defaultConfig,
        });

        const result = await loop.run({
          messages: [{ role: 'user', content: 'Calculate bad' }],
          model: 'anthropic/claude-3.5-sonnet',
        });

        expect(result.content).toBe('Sorry, the calculation failed.');
        expect(result.toolCalls[0].status).toBe('failure');
      });

      it('should include error message in tool result for LLM', async () => {
        mockComplete
          .mockResolvedValueOnce(
            createToolCallResponse([
              { id: 'call_1', name: 'api_call', arguments: '{}' },
            ])
          )
          .mockResolvedValueOnce(createLLMResponse());

        mockExecute.mockResolvedValue({
          success: false,
          output: {},
          errorMessage: 'Network error',
          durationMs: 10,
        });

        const loop = createToolLoop({
          llmClient: mockLLMClient,
          toolExecutor: mockToolExecutor,
          config: defaultConfig,
        });

        await loop.run({
          messages: [{ role: 'user', content: 'Test' }],
          model: 'anthropic/claude-3.5-sonnet',
        });

        // Check error is included in tool result message
        const secondCall = mockComplete.mock.calls[1][0] as LLMRequest;
        const toolResultMessage = secondCall.messages.find(
          (m) => m.role === 'tool'
        );
        expect(toolResultMessage?.content).toContain('Network error');
      });
    });

    describe('context', () => {
      it('should pass context to tool executor', async () => {
        mockComplete
          .mockResolvedValueOnce(
            createToolCallResponse([
              { id: 'call_1', name: 'tool', arguments: '{}' },
            ])
          )
          .mockResolvedValueOnce(createLLMResponse());

        mockExecute.mockResolvedValue({
          success: true,
          output: {},
          durationMs: 10,
        });

        const loop = createToolLoop({
          llmClient: mockLLMClient,
          toolExecutor: mockToolExecutor,
          config: defaultConfig,
        });

        await loop.run({
          messages: [{ role: 'user', content: 'Test' }],
          model: 'anthropic/claude-3.5-sonnet',
          context: {
            userId: 'user-123',
            chatId: 'chat-456',
            requestId: 'req-789',
          },
        });

        expect(mockExecute).toHaveBeenCalledWith(
          'tool',
          {},
          expect.objectContaining({
            userId: 'user-123',
            chatId: 'chat-456',
            requestId: 'req-789',
          })
        );
      });
    });

    describe('usage tracking', () => {
      it('should accumulate token usage across iterations', async () => {
        mockComplete
          .mockResolvedValueOnce({
            ...createToolCallResponse([
              { id: 'call_1', name: 'tool', arguments: '{}' },
            ]),
            usage: {
              prompt_tokens: 100,
              completion_tokens: 20,
              total_tokens: 120,
            },
          })
          .mockResolvedValueOnce({
            ...createLLMResponse(),
            usage: {
              prompt_tokens: 150,
              completion_tokens: 30,
              total_tokens: 180,
            },
          });

        mockExecute.mockResolvedValue({
          success: true,
          output: {},
          durationMs: 10,
        });

        const loop = createToolLoop({
          llmClient: mockLLMClient,
          toolExecutor: mockToolExecutor,
          config: defaultConfig,
        });

        const result = await loop.run({
          messages: [{ role: 'user', content: 'Test' }],
          model: 'anthropic/claude-3.5-sonnet',
        });

        expect(result.usage.promptTokens).toBe(250); // 100 + 150
        expect(result.usage.completionTokens).toBe(50); // 20 + 30
        expect(result.usage.totalTokens).toBe(300); // 120 + 180
      });
    });
  });
});
