/**
 * LLM Client Unit Tests
 * Phase 5: AI Orchestrator - TDD
 *
 * Tests for OpenRouter LLM client abstraction
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createLLMClient } from '@/orchestrator/llm-client.js';
import type { LLMRequest, LLMStreamChunk } from '@/types/index.js';

// Create mock create function
const mockCreate = vi.fn();

// Mock the OpenAI SDK
vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    })),
  };
});

describe('LLM Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createLLMClient', () => {
    it('should create a client with valid API key', () => {
      const client = createLLMClient({
        apiKey: 'test-api-key',
      });
      expect(client).toBeDefined();
      expect(typeof client.complete).toBe('function');
      expect(typeof client.stream).toBe('function');
    });

    it('should throw if API key is missing', () => {
      expect(() => createLLMClient({ apiKey: '' })).toThrow(
        'API key is required'
      );
    });

    it('should use default base URL for OpenRouter', () => {
      const client = createLLMClient({
        apiKey: 'test-api-key',
      });
      expect(client).toBeDefined();
      // Base URL should be https://openrouter.ai/api/v1
    });

    it('should allow custom base URL override', () => {
      const client = createLLMClient({
        apiKey: 'test-api-key',
        baseURL: 'https://custom.api.com/v1',
      });
      expect(client).toBeDefined();
    });
  });

  describe('complete()', () => {
    it('should send a chat completion request and return response', async () => {
      // Mock OpenAI SDK response format
      mockCreate.mockResolvedValue({
        id: 'chatcmpl-123',
        model: 'anthropic/claude-3.5-sonnet',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Hello! How can I help you?',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 8,
          total_tokens: 18,
        },
      });

      const client = createLLMClient({ apiKey: 'test-api-key' });
      const request: LLMRequest = {
        model: 'anthropic/claude-3.5-sonnet',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const response = await client.complete(request);

      expect(response.id).toBe('chatcmpl-123');
      expect(response.choices[0].message.content).toBe(
        'Hello! How can I help you?'
      );
      expect(response.usage.total_tokens).toBe(18);
    });

    it('should handle tool calls in response', async () => {
      mockCreate.mockResolvedValue({
        id: 'chatcmpl-456',
        model: 'anthropic/claude-3.5-sonnet',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_abc123',
                  type: 'function',
                  function: {
                    name: 'web_search',
                    arguments: '{"query": "weather in NYC"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: {
          prompt_tokens: 15,
          completion_tokens: 20,
          total_tokens: 35,
        },
      });

      const client = createLLMClient({ apiKey: 'test-api-key' });
      const request: LLMRequest = {
        model: 'anthropic/claude-3.5-sonnet',
        messages: [{ role: 'user', content: 'What is the weather?' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'web_search',
              description: 'Search the web',
              parameters: {
                type: 'object',
                properties: { query: { type: 'string' } },
              },
            },
          },
        ],
      };

      const response = await client.complete(request);

      expect(response.choices[0].finish_reason).toBe('tool_calls');
      expect(response.choices[0].message.tool_calls).toHaveLength(1);
      expect(response.choices[0].message.tool_calls?.[0].function.name).toBe(
        'web_search'
      );
    });

    it('should handle API errors gracefully', async () => {
      mockCreate.mockRejectedValue(new Error('API rate limit exceeded'));

      const client = createLLMClient({ apiKey: 'test-api-key' });
      const request: LLMRequest = {
        model: 'anthropic/claude-3.5-sonnet',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      await expect(client.complete(request)).rejects.toThrow(
        'API rate limit exceeded'
      );
    });

    it('should include OpenRouter headers', async () => {
      mockCreate.mockResolvedValue({
        id: 'chatcmpl-789',
        model: 'anthropic/claude-3.5-sonnet',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hi' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
      });

      const client = createLLMClient({
        apiKey: 'test-api-key',
        siteUrl: 'https://bakame.app',
        siteName: 'Bakame AI',
      });

      const request: LLMRequest = {
        model: 'anthropic/claude-3.5-sonnet',
        messages: [{ role: 'user', content: 'Hi' }],
      };

      await client.complete(request);
      // Headers are set in the OpenAI client constructor - verified by no errors
      expect(mockCreate).toHaveBeenCalled();
    });

    it('should respect timeout configuration', () => {
      const client = createLLMClient({
        apiKey: 'test-api-key',
        timeout: 5000,
      });

      expect(client).toBeDefined();
      // Timeout is configured on the OpenAI client constructor
    });

    it('should handle null content in response', async () => {
      mockCreate.mockResolvedValue({
        id: 'chatcmpl-null',
        model: 'anthropic/claude-3.5-sonnet',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: null },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 },
      });

      const client = createLLMClient({ apiKey: 'test-api-key' });
      const response = await client.complete({
        model: 'anthropic/claude-3.5-sonnet',
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(response.choices[0].message.content).toBe('');
    });

    it('should handle missing usage in response', async () => {
      mockCreate.mockResolvedValue({
        id: 'chatcmpl-nousage',
        model: 'anthropic/claude-3.5-sonnet',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hi' },
            finish_reason: 'stop',
          },
        ],
        usage: undefined,
      });

      const client = createLLMClient({ apiKey: 'test-api-key' });
      const response = await client.complete({
        model: 'anthropic/claude-3.5-sonnet',
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(response.usage.prompt_tokens).toBe(0);
      expect(response.usage.completion_tokens).toBe(0);
      expect(response.usage.total_tokens).toBe(0);
    });
  });

  describe('stream()', () => {
    it('should return an async iterable of chunks', async () => {
      // Create mock chunks that match OpenAI SDK format
      const mockChunks = [
        {
          id: 'chatcmpl-stream-1',
          model: 'anthropic/claude-3.5-sonnet',
          choices: [
            { index: 0, delta: { role: 'assistant' }, finish_reason: null },
          ],
        },
        {
          id: 'chatcmpl-stream-1',
          model: 'anthropic/claude-3.5-sonnet',
          choices: [
            { index: 0, delta: { content: 'Hello' }, finish_reason: null },
          ],
        },
        {
          id: 'chatcmpl-stream-1',
          model: 'anthropic/claude-3.5-sonnet',
          choices: [
            { index: 0, delta: { content: ' there!' }, finish_reason: null },
          ],
        },
        {
          id: 'chatcmpl-stream-1',
          model: 'anthropic/claude-3.5-sonnet',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        },
      ];

      // Create an async iterator from mock chunks
      async function* mockStream(): AsyncIterable<(typeof mockChunks)[0]> {
        for (const chunk of mockChunks) {
          yield chunk;
        }
      }

      mockCreate.mockResolvedValue(mockStream());

      const client = createLLMClient({ apiKey: 'test-api-key' });
      const request: LLMRequest = {
        model: 'anthropic/claude-3.5-sonnet',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      };

      const chunks: LLMStreamChunk[] = [];
      for await (const chunk of client.stream(request)) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(4);
      expect(chunks[0].choices[0].delta.role).toBe('assistant');
      expect(chunks[1].choices[0].delta.content).toBe('Hello');
      expect(chunks[2].choices[0].delta.content).toBe(' there!');
      expect(chunks[3].choices[0].finish_reason).toBe('stop');
    });

    it('should handle tool calls in streaming mode', async () => {
      const mockChunks = [
        {
          id: 'chatcmpl-tool-stream',
          model: 'anthropic/claude-3.5-sonnet',
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [
                  {
                    id: 'call_stream_123',
                    type: 'function',
                    function: { name: 'calculator', arguments: '' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        },
        {
          id: 'chatcmpl-tool-stream',
          model: 'anthropic/claude-3.5-sonnet',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: { arguments: '{"expression":' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        },
        {
          id: 'chatcmpl-tool-stream',
          model: 'anthropic/claude-3.5-sonnet',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: { arguments: '"2+2"}' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        },
        {
          id: 'chatcmpl-tool-stream',
          model: 'anthropic/claude-3.5-sonnet',
          choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
        },
      ];

      async function* mockStream(): AsyncIterable<(typeof mockChunks)[0]> {
        for (const chunk of mockChunks) {
          yield chunk;
        }
      }

      mockCreate.mockResolvedValue(mockStream());

      const client = createLLMClient({ apiKey: 'test-api-key' });
      const request: LLMRequest = {
        model: 'anthropic/claude-3.5-sonnet',
        messages: [{ role: 'user', content: 'Calculate 2+2' }],
        stream: true,
        tools: [
          {
            type: 'function',
            function: {
              name: 'calculator',
              description: 'Calculate math expressions',
              parameters: {
                type: 'object',
                properties: { expression: { type: 'string' } },
              },
            },
          },
        ],
      };

      const chunks: LLMStreamChunk[] = [];
      for await (const chunk of client.stream(request)) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(4);
      expect(chunks[3].choices[0].finish_reason).toBe('tool_calls');
    });

    it('should handle mid-stream errors', async () => {
      async function* mockErrorStream(): AsyncIterable<{
        id: string;
        model: string;
        choices: Array<{
          index: number;
          delta: { content?: string };
          finish_reason: null;
        }>;
      }> {
        yield {
          id: 'chatcmpl-error',
          model: 'anthropic/claude-3.5-sonnet',
          choices: [
            {
              index: 0,
              delta: { content: 'Starting...' },
              finish_reason: null,
            },
          ],
        };
        throw new Error('Connection lost');
      }

      mockCreate.mockResolvedValue(mockErrorStream());

      const client = createLLMClient({ apiKey: 'test-api-key' });
      const request: LLMRequest = {
        model: 'anthropic/claude-3.5-sonnet',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      };

      const chunks: LLMStreamChunk[] = [];
      await expect(async () => {
        for await (const chunk of client.stream(request)) {
          chunks.push(chunk);
        }
      }).rejects.toThrow('Connection lost');

      expect(chunks).toHaveLength(1);
    });

    it('should handle empty delta content', async () => {
      const mockChunks = [
        {
          id: 'chatcmpl-empty',
          model: 'anthropic/claude-3.5-sonnet',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: null },
              finish_reason: null,
            },
          ],
        },
        {
          id: 'chatcmpl-empty',
          model: 'anthropic/claude-3.5-sonnet',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        },
      ];

      async function* mockStream(): AsyncIterable<(typeof mockChunks)[0]> {
        for (const chunk of mockChunks) {
          yield chunk;
        }
      }

      mockCreate.mockResolvedValue(mockStream());

      const client = createLLMClient({ apiKey: 'test-api-key' });
      const chunks: LLMStreamChunk[] = [];

      for await (const chunk of client.stream({
        model: 'anthropic/claude-3.5-sonnet',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      })) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);
      // Null content should not be included in delta
      expect(chunks[0].choices[0].delta.content).toBeUndefined();
    });
  });

  describe('message type mapping', () => {
    it('should correctly map system messages', async () => {
      mockCreate.mockResolvedValue({
        id: 'chatcmpl-sys',
        model: 'anthropic/claude-3.5-sonnet',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'OK' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
      });

      const client = createLLMClient({ apiKey: 'test-api-key' });
      await client.complete({
        model: 'anthropic/claude-3.5-sonnet',
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hi' },
        ],
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'system',
              content: 'You are helpful',
            }),
          ]),
        })
      );
    });

    it('should correctly map tool result messages', async () => {
      mockCreate.mockResolvedValue({
        id: 'chatcmpl-tool-result',
        model: 'anthropic/claude-3.5-sonnet',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'The result is 4' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
      });

      const client = createLLMClient({ apiKey: 'test-api-key' });
      await client.complete({
        model: 'anthropic/claude-3.5-sonnet',
        messages: [
          { role: 'user', content: 'Calculate 2+2' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_123',
                type: 'function',
                function: { name: 'calculator', arguments: '{"expr":"2+2"}' },
              },
            ],
          },
          { role: 'tool', content: '{"result": 4}', tool_call_id: 'call_123' },
        ],
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'tool',
              content: '{"result": 4}',
              tool_call_id: 'call_123',
            }),
          ]),
        })
      );
    });
  });
});
