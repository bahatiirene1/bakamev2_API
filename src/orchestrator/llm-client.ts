/**
 * LLM Client Implementation
 * Phase 5: AI Orchestrator
 *
 * Wraps OpenAI SDK to communicate with OpenRouter
 * Reference: docs/stage-4-ai-orchestrator.md
 */

import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

import type {
  LLMClient,
  LLMMessage,
  LLMRequest,
  LLMResponse,
  LLMStreamChunk,
} from '@/types/index.js';

/**
 * OpenRouter base URL
 */
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * LLM Client configuration options
 */
export interface LLMClientConfig {
  /** OpenRouter API key (required) */
  apiKey: string;

  /** Base URL override (default: OpenRouter) */
  baseURL?: string;

  /** Site URL for OpenRouter attribution */
  siteUrl?: string;

  /** Site name for OpenRouter attribution */
  siteName?: string;

  /** Request timeout in milliseconds */
  timeout?: number;
}

/**
 * Create an LLM client for OpenRouter
 */
export function createLLMClient(config: LLMClientConfig): LLMClient {
  // Validate API key
  if (!config.apiKey || config.apiKey.trim() === '') {
    throw new Error('API key is required');
  }

  // Build default headers for OpenRouter
  const defaultHeaders: Record<string, string> = {};
  if (config.siteUrl) {
    defaultHeaders['HTTP-Referer'] = config.siteUrl;
  }
  if (config.siteName) {
    defaultHeaders['X-Title'] = config.siteName;
  }

  // Create OpenAI client configured for OpenRouter
  const openai = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL ?? OPENROUTER_BASE_URL,
    defaultHeaders,
    timeout: config.timeout ?? 120000,
  });

  /**
   * Convert our LLMMessage to OpenAI's ChatCompletionMessageParam
   * This handles the discriminated union types properly
   */
  function toOpenAIMessage(msg: LLMMessage): ChatCompletionMessageParam {
    switch (msg.role) {
      case 'system':
        return {
          role: 'system',
          content: msg.content,
          ...(msg.name && { name: msg.name }),
        };
      case 'user':
        return {
          role: 'user',
          content: msg.content,
          ...(msg.name && { name: msg.name }),
        };
      case 'assistant':
        return {
          role: 'assistant',
          content: msg.content,
          ...(msg.tool_calls && {
            tool_calls: msg.tool_calls.map((tc) => ({
              id: tc.id,
              type: 'function' as const,
              function: {
                name: tc.function.name,
                arguments: tc.function.arguments,
              },
            })),
          }),
        };
      case 'tool':
        return {
          role: 'tool',
          content: msg.content,
          tool_call_id: msg.tool_call_id ?? '',
        };
    }
  }

  return {
    /**
     * Send a non-streaming chat completion request
     */
    async complete(request: LLMRequest): Promise<LLMResponse> {
      const response = await openai.chat.completions.create({
        model: request.model,
        messages: request.messages.map(toOpenAIMessage),
        ...(request.tools && { tools: request.tools }),
        ...(request.tool_choice && { tool_choice: request.tool_choice }),
        ...(request.max_tokens && { max_tokens: request.max_tokens }),
        ...(request.temperature !== undefined && {
          temperature: request.temperature,
        }),
        stream: false,
      });

      // Map OpenAI response to our LLMResponse type
      return {
        id: response.id,
        model: response.model,
        choices: response.choices.map((choice) => ({
          index: choice.index,
          message: {
            role: choice.message.role as 'assistant',
            content: choice.message.content ?? '',
            ...(choice.message.tool_calls && {
              tool_calls: choice.message.tool_calls.map((tc) => ({
                id: tc.id,
                type: tc.type as 'function',
                function: {
                  name: tc.function.name,
                  arguments: tc.function.arguments,
                },
              })),
            }),
          },
          finish_reason:
            choice.finish_reason as LLMResponse['choices'][0]['finish_reason'],
        })),
        usage: {
          prompt_tokens: response.usage?.prompt_tokens ?? 0,
          completion_tokens: response.usage?.completion_tokens ?? 0,
          total_tokens: response.usage?.total_tokens ?? 0,
        },
      };
    },

    /**
     * Send a streaming chat completion request
     * Returns an async iterable of chunks
     */
    async *stream(request: LLMRequest): AsyncIterable<LLMStreamChunk> {
      const response = await openai.chat.completions.create({
        model: request.model,
        messages: request.messages.map(toOpenAIMessage),
        ...(request.tools && { tools: request.tools }),
        ...(request.tool_choice && { tool_choice: request.tool_choice }),
        ...(request.max_tokens && { max_tokens: request.max_tokens }),
        ...(request.temperature !== undefined && {
          temperature: request.temperature,
        }),
        stream: true,
      });

      // Iterate over the stream
      for await (const chunk of response) {
        const mappedChoices = chunk.choices.map((choice) => {
          // Build delta object
          const delta: Partial<LLMMessage> = {};

          if (choice.delta.role) {
            delta.role = choice.delta.role as LLMMessage['role'];
          }
          if (
            choice.delta.content !== null &&
            choice.delta.content !== undefined
          ) {
            delta.content = choice.delta.content;
          }
          if (choice.delta.tool_calls) {
            delta.tool_calls = choice.delta.tool_calls.map((tc) => ({
              id: tc.id ?? '',
              type: 'function' as const,
              function: {
                name: tc.function?.name ?? '',
                arguments: tc.function?.arguments ?? '',
              },
            }));
          }

          return {
            index: choice.index,
            delta,
            finish_reason:
              choice.finish_reason as LLMStreamChunk['choices'][0]['finish_reason'],
          };
        });

        yield {
          id: chunk.id,
          model: chunk.model,
          choices: mappedChoices,
          ...(chunk.usage && {
            usage: {
              prompt_tokens: chunk.usage.prompt_tokens,
              completion_tokens: chunk.usage.completion_tokens,
              total_tokens: chunk.usage.total_tokens,
            },
          }),
        };
      }
    },
  };
}
