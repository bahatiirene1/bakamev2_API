/**
 * Main Orchestrator Implementation
 * Phase 5: AI Orchestrator
 *
 * Ties together context building, prompt assembly, tool loop, and persistence
 * Reference: docs/stage-4-ai-orchestrator.md
 */

import type {
  ActorContext,
  Result,
  LLMClient,
  OrchestratorConfig,
  OrchestratorInput,
  OrchestratorResult,
  AIContext,
  AIResponse,
  ToolExecutor,
  StreamEvent,
  BuildContextParams,
  PersistResponseParams,
} from '@/types/index.js';
import { success, failure, AI_ACTOR } from '@/types/index.js';

import { createPromptBuilder, CORE_INSTRUCTIONS } from './prompt-builder.js';
import { createToolLoop } from './tool-loop.js';
import type { ToolLoopResult } from './tool-loop.js';

/**
 * Context service interface (minimal subset needed by orchestrator)
 */
export interface OrchestratorContextService {
  buildContext(
    actor: ActorContext,
    params: BuildContextParams
  ): Promise<Result<AIContext>>;

  persistResponse(
    actor: ActorContext,
    params: PersistResponseParams
  ): Promise<Result<void>>;
}

/**
 * Orchestrator interface
 */
export interface Orchestrator {
  /**
   * Run a non-streaming orchestration request
   */
  run(input: OrchestratorInput): Promise<Result<OrchestratorResult>>;

  /**
   * Run a streaming orchestration request
   */
  stream(input: OrchestratorInput): AsyncIterable<StreamEvent>;
}

/**
 * Dependencies for orchestrator
 */
export interface OrchestratorDeps {
  llmClient: LLMClient;
  toolExecutor: ToolExecutor;
  contextService: OrchestratorContextService;
  config: OrchestratorConfig;
}

/**
 * Create the AI actor context for orchestration
 */
function createAIActor(requestId: string): ActorContext {
  return {
    ...AI_ACTOR,
    requestId,
  };
}

/**
 * Create an orchestrator instance
 */
export function createOrchestrator(deps: OrchestratorDeps): Orchestrator {
  const { llmClient, toolExecutor, contextService, config } = deps;

  // Create prompt builder
  const promptBuilder = createPromptBuilder();

  return {
    async run(input: OrchestratorInput): Promise<Result<OrchestratorResult>> {
      const requestId = `orch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const actor = createAIActor(requestId);

      // Merge config with overrides
      const effectiveConfig: OrchestratorConfig = {
        ...config,
        ...input.configOverrides,
      };

      // Step 1: Build context from services
      const contextResult = await contextService.buildContext(actor, {
        chatId: input.chatId,
        userMessage: input.userMessage,
      });

      if (!contextResult.success) {
        return failure(contextResult.error.code, contextResult.error.message);
      }

      const aiContext = contextResult.data;

      // Step 2: Build prompt using prompt builder
      const promptOutput = promptBuilder.build({
        coreInstructions: aiContext.coreInstructions || CORE_INSTRUCTIONS,
        systemPrompt: aiContext.systemPrompt,
        userPreferences: {
          responseLength: aiContext.userPreferences.responseLength,
          formality: aiContext.userPreferences.formality,
          customInstructions: aiContext.userPreferences.customInstructions,
        },
        memories: aiContext.memories.map((m) => ({
          content: m.content,
          category: m.category,
          importance: m.importance,
        })),
        knowledge: aiContext.knowledge.map((k) => ({
          title: k.title,
          chunk: k.chunk,
        })),
        conversationHistory: aiContext.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        userMessage: input.userMessage,
        tools: aiContext.tools,
      });

      // Step 3: Create tool loop and run
      const toolLoop = createToolLoop({
        llmClient,
        toolExecutor,
        config: {
          maxIterations: effectiveConfig.maxIterations,
          maxToolCalls: effectiveConfig.maxToolCalls,
          toolCallTimeout: effectiveConfig.toolCallTimeout,
        },
      });

      let loopResult: ToolLoopResult;
      try {
        loopResult = await toolLoop.run({
          messages: promptOutput.messages,
          model: effectiveConfig.model,
          context: {
            userId: input.userId,
            chatId: input.chatId,
            requestId,
          },
          tools: promptOutput.tools,
          temperature: effectiveConfig.temperature,
          maxTokens: effectiveConfig.maxOutputTokens,
        });
      } catch (error) {
        return failure(
          'LLM_ERROR',
          error instanceof Error ? error.message : 'Unknown LLM error'
        );
      }

      // Step 4: Build result
      const result: OrchestratorResult = {
        content: loopResult.content,
        model: loopResult.model,
        usage: {
          inputTokens: loopResult.usage.promptTokens,
          outputTokens: loopResult.usage.completionTokens,
        },
        toolCalls: loopResult.toolCalls.map((tc) => ({
          toolName: tc.toolName,
          input: tc.input,
          output: tc.output,
          status: tc.status,
          durationMs: tc.durationMs,
        })),
        iterations: loopResult.iterations,
        extractedMemories: [], // Would be populated by memory extraction logic
      };

      // Step 5: Persist response
      const aiResponse: AIResponse = {
        content: result.content,
        model: result.model,
        tokenCount: result.usage.inputTokens + result.usage.outputTokens,
        toolCalls: result.toolCalls.map((tc) => ({
          toolName: tc.toolName,
          input: tc.input,
          output: tc.output,
          status: tc.status,
        })),
        memoriesToCreate: result.extractedMemories,
      };

      await contextService.persistResponse(actor, {
        chatId: input.chatId,
        response: aiResponse,
      });

      return success(result);
    },

    async *stream(input: OrchestratorInput): AsyncIterable<StreamEvent> {
      const requestId = `orch-stream-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const messageId = `msg-${Date.now()}`;
      const actor = createAIActor(requestId);

      // Merge config with overrides
      const effectiveConfig: OrchestratorConfig = {
        ...config,
        ...input.configOverrides,
      };

      // Step 1: Build context
      const contextResult = await contextService.buildContext(actor, {
        chatId: input.chatId,
        userMessage: input.userMessage,
      });

      if (!contextResult.success) {
        yield {
          type: 'error',
          code: contextResult.error.code,
          message: contextResult.error.message,
          timestamp: Date.now(),
        };
        yield { type: 'done', timestamp: Date.now() };
        return;
      }

      const aiContext = contextResult.data;

      // Step 2: Build prompt
      const promptOutput = promptBuilder.build({
        coreInstructions: aiContext.coreInstructions || CORE_INSTRUCTIONS,
        systemPrompt: aiContext.systemPrompt,
        userPreferences: {
          responseLength: aiContext.userPreferences.responseLength,
          formality: aiContext.userPreferences.formality,
          customInstructions: aiContext.userPreferences.customInstructions,
        },
        memories: aiContext.memories.map((m) => ({
          content: m.content,
          category: m.category,
          importance: m.importance,
        })),
        knowledge: aiContext.knowledge.map((k) => ({
          title: k.title,
          chunk: k.chunk,
        })),
        conversationHistory: aiContext.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        userMessage: input.userMessage,
        tools: aiContext.tools,
      });

      // Emit message start
      yield {
        type: 'message.start',
        messageId,
        timestamp: Date.now(),
      };

      try {
        // For now, use non-streaming LLM call and emit as single delta
        // Full streaming implementation would use llmClient.stream()
        const toolLoop = createToolLoop({
          llmClient,
          toolExecutor,
          config: {
            maxIterations: effectiveConfig.maxIterations,
            maxToolCalls: effectiveConfig.maxToolCalls,
            toolCallTimeout: effectiveConfig.toolCallTimeout,
          },
        });

        const loopResult = await toolLoop.run({
          messages: promptOutput.messages,
          model: effectiveConfig.model,
          context: {
            userId: input.userId,
            chatId: input.chatId,
            requestId,
          },
          tools: promptOutput.tools,
          temperature: effectiveConfig.temperature,
          maxTokens: effectiveConfig.maxOutputTokens,
        });

        // Emit tool events
        for (const tc of loopResult.toolCalls) {
          yield {
            type: 'tool.start',
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            input: tc.input,
            timestamp: Date.now(),
          };

          yield {
            type: 'tool.complete',
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            output: tc.output,
            status: tc.status,
            durationMs: tc.durationMs,
            timestamp: Date.now(),
          };
        }

        // Emit content as single delta
        yield {
          type: 'message.delta',
          content: loopResult.content,
          timestamp: Date.now(),
        };

        // Emit message complete
        yield {
          type: 'message.complete',
          messageId,
          model: loopResult.model,
          usage: {
            inputTokens: loopResult.usage.promptTokens,
            outputTokens: loopResult.usage.completionTokens,
          },
          timestamp: Date.now(),
        };

        // Persist response
        const aiResponse: AIResponse = {
          content: loopResult.content,
          model: loopResult.model,
          tokenCount:
            loopResult.usage.promptTokens + loopResult.usage.completionTokens,
          toolCalls: loopResult.toolCalls.map((tc) => ({
            toolName: tc.toolName,
            input: tc.input,
            output: tc.output,
            status: tc.status,
          })),
        };

        await contextService.persistResponse(actor, {
          chatId: input.chatId,
          response: aiResponse,
        });
      } catch (error) {
        yield {
          type: 'error',
          code: 'LLM_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
          timestamp: Date.now(),
        };
      }

      // Emit done
      yield { type: 'done', timestamp: Date.now() };
    },
  };
}
