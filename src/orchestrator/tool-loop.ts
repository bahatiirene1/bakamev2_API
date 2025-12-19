/**
 * Tool Loop Implementation
 * Phase 5: AI Orchestrator
 *
 * Handles iterative tool execution with safety limits
 * Reference: docs/stage-4-ai-orchestrator.md Section 2.4
 */

import type {
  LLMClient,
  LLMMessage,
  LLMRequest,
  ToolExecutor,
  ToolExecutionResult,
} from '@/types/index.js';

/**
 * Tool Loop configuration
 */
export interface ToolLoopConfig {
  /** Maximum iterations before stopping */
  maxIterations: number;

  /** Maximum total tool calls across all iterations */
  maxToolCalls: number;

  /** Timeout for individual tool execution (ms) */
  toolCallTimeout: number;
}

/**
 * Context passed to tool executor
 */
export interface ToolLoopContext {
  userId: string;
  chatId: string;
  requestId: string;
}

/**
 * Input for tool loop run
 */
export interface ToolLoopInput {
  /** Initial messages for LLM */
  messages: LLMMessage[];

  /** Model to use */
  model: string;

  /** Optional context for tool execution */
  context?: ToolLoopContext;

  /** Optional tools list (for filtering) */
  tools?: LLMRequest['tools'];

  /** Optional temperature */
  temperature?: number;

  /** Optional max tokens */
  maxTokens?: number;
}

/**
 * Tool call record
 */
export interface ToolCallRecord {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  status: 'success' | 'failure';
  errorMessage?: string;
  durationMs: number;
}

/**
 * Result from tool loop execution
 */
export interface ToolLoopResult {
  /** Final response content */
  content: string;

  /** Model used */
  model: string;

  /** Number of iterations executed */
  iterations: number;

  /** All tool calls made */
  toolCalls: ToolCallRecord[];

  /** Reason loop stopped (if not natural completion) */
  stoppedReason?: 'max_iterations' | 'max_tool_calls';

  /** Accumulated token usage */
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Tool Loop interface
 */
export interface ToolLoop {
  run(input: ToolLoopInput): Promise<ToolLoopResult>;
}

/**
 * Dependencies for tool loop
 */
export interface ToolLoopDeps {
  llmClient: LLMClient;
  toolExecutor: ToolExecutor;
  config: ToolLoopConfig;
}

/**
 * Create a tool loop instance
 */
export function createToolLoop(deps: ToolLoopDeps): ToolLoop {
  const { llmClient, toolExecutor, config } = deps;

  return {
    async run(input: ToolLoopInput): Promise<ToolLoopResult> {
      const messages = [...input.messages];
      let iterations = 0;
      let totalToolCalls = 0;
      const toolCalls: ToolCallRecord[] = [];
      let stoppedReason: ToolLoopResult['stoppedReason'] | undefined;

      // Token usage accumulator
      const usage = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      };

      // Default context for tool execution
      const context = input.context ?? {
        userId: 'unknown',
        chatId: 'unknown',
        requestId: `req-${Date.now()}`,
      };

      // Main loop
      while (iterations < config.maxIterations) {
        iterations++;

        // Check if we've hit max tool calls
        if (totalToolCalls >= config.maxToolCalls) {
          stoppedReason = 'max_tool_calls';
          break;
        }

        // Call LLM
        const request: LLMRequest = {
          model: input.model,
          messages,
          ...(input.tools && { tools: input.tools }),
          ...(input.temperature !== undefined && {
            temperature: input.temperature,
          }),
          ...(input.maxTokens && { max_tokens: input.maxTokens }),
        };

        const response = await llmClient.complete(request);

        // Accumulate usage
        usage.promptTokens += response.usage.prompt_tokens;
        usage.completionTokens += response.usage.completion_tokens;
        usage.totalTokens += response.usage.total_tokens;

        const choice = response.choices[0];
        if (!choice) {
          throw new Error('No choice returned from LLM');
        }
        const assistantMessage = choice.message;

        // If no tool calls, we're done
        if (
          !assistantMessage.tool_calls ||
          assistantMessage.tool_calls.length === 0
        ) {
          return {
            content: assistantMessage.content,
            model: response.model,
            iterations,
            toolCalls,
            usage,
          };
        }

        // Check if tool calls would exceed limit
        if (
          totalToolCalls + assistantMessage.tool_calls.length >
          config.maxToolCalls
        ) {
          stoppedReason = 'max_tool_calls';
          break;
        }

        // Add assistant message with tool calls to conversation
        messages.push({
          role: 'assistant',
          content: assistantMessage.content,
          tool_calls: assistantMessage.tool_calls,
        });

        // Execute all tool calls in parallel
        const toolResults = await Promise.all(
          assistantMessage.tool_calls.map(async (tc) => {
            const toolInput = JSON.parse(tc.function.arguments) as Record<
              string,
              unknown
            >;
            const startTime = Date.now();

            let result: ToolExecutionResult;
            try {
              result = await toolExecutor.execute(
                tc.function.name,
                toolInput,
                context
              );
            } catch (error) {
              result = {
                success: false,
                output: {},
                errorMessage:
                  error instanceof Error ? error.message : 'Unknown error',
                durationMs: Date.now() - startTime,
              };
            }

            // Record the tool call
            const record: ToolCallRecord = {
              toolCallId: tc.id,
              toolName: tc.function.name,
              input: toolInput,
              output: result.output,
              status: result.success ? 'success' : 'failure',
              ...(result.errorMessage && { errorMessage: result.errorMessage }),
              durationMs: result.durationMs,
            };

            toolCalls.push(record);
            totalToolCalls++;

            return {
              toolCallId: tc.id,
              result,
            };
          })
        );

        // Add tool results to conversation
        for (const { toolCallId, result } of toolResults) {
          const content = result.success
            ? JSON.stringify(result.output)
            : JSON.stringify({
                error: result.errorMessage ?? 'Tool execution failed',
              });

          messages.push({
            role: 'tool',
            content,
            tool_call_id: toolCallId,
          });
        }
      }

      // If we exit the loop without returning, we hit max iterations
      if (!stoppedReason) {
        stoppedReason = 'max_iterations';
      }

      // Return graceful degradation response
      return {
        content:
          'I apologize, but I was unable to complete the task within the allowed limits. ' +
          'Please try breaking down your request into smaller parts.',
        model: input.model,
        iterations,
        toolCalls,
        stoppedReason,
        usage,
      };
    },
  };
}
