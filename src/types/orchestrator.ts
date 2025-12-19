/**
 * Orchestrator Domain Types
 * Phase 5: AI Orchestrator
 *
 * Reference: docs/stage-4-ai-orchestrator.md
 *
 * SCOPE: LLM interaction, prompt assembly, tool loop, streaming
 */

import type { ToolDefinition } from './tool.js';

// ─────────────────────────────────────────────────────────────
// LLM CLIENT TYPES
// ─────────────────────────────────────────────────────────────

/**
 * OpenRouter-compatible message format
 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: LLMToolCall[];
}

/**
 * Tool call from LLM response
 */
export interface LLMToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

/**
 * OpenRouter chat completion request
 */
export interface LLMRequest {
  model: string;
  messages: LLMMessage[];
  tools?: LLMToolDefinition[];
  tool_choice?:
    | 'none'
    | 'auto'
    | 'required'
    | { type: 'function'; function: { name: string } };
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
}

/**
 * Tool definition in OpenRouter format
 */
export interface LLMToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema
  };
}

/**
 * Non-streaming LLM response
 */
export interface LLMResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: LLMMessage;
    finish_reason:
      | 'stop'
      | 'tool_calls'
      | 'length'
      | 'content_filter'
      | 'error';
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Streaming chunk from LLM
 */
export interface LLMStreamChunk {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    delta: Partial<LLMMessage>;
    finish_reason:
      | 'stop'
      | 'tool_calls'
      | 'length'
      | 'content_filter'
      | 'error'
      | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * LLM Client interface for making requests to OpenRouter
 */
export interface LLMClient {
  /**
   * Send a chat completion request (non-streaming)
   */
  complete(request: LLMRequest): Promise<LLMResponse>;

  /**
   * Send a streaming chat completion request
   * Returns an async iterator of chunks
   */
  stream(request: LLMRequest): AsyncIterable<LLMStreamChunk>;
}

// ─────────────────────────────────────────────────────────────
// ORCHESTRATOR CONFIG
// ─────────────────────────────────────────────────────────────

/**
 * Orchestrator configuration
 * Reference: docs/stage-4-ai-orchestrator.md Section 2.2
 */
export interface OrchestratorConfig {
  /** Model identifier (e.g., 'anthropic/claude-3.5-sonnet') */
  model: string;

  /** Maximum input tokens for context window */
  maxInputTokens: number;

  /** Maximum output tokens for response */
  maxOutputTokens: number;

  /** Maximum tool calls per request (cumulative across iterations) */
  maxToolCalls: number;

  /** Maximum tool loop iterations (prevents runaway reasoning) */
  maxIterations: number;

  /** Timeout for individual tool calls (ms) */
  toolCallTimeout: number;

  /** Total request timeout (ms) */
  totalTimeout: number;

  /** Temperature for generation (0-2) */
  temperature: number;
}

/**
 * Default orchestrator configuration
 */
export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  model: 'anthropic/claude-3.5-sonnet',
  maxInputTokens: 100000,
  maxOutputTokens: 4096,
  maxToolCalls: 10,
  maxIterations: 5,
  toolCallTimeout: 30000,
  totalTimeout: 120000,
  temperature: 0.7,
};

// ─────────────────────────────────────────────────────────────
// STREAMING EVENT TYPES (SSE)
// ─────────────────────────────────────────────────────────────

/**
 * Base SSE event
 */
export interface BaseStreamEvent {
  type: string;
  timestamp: number;
}

/**
 * Message started event
 */
export interface MessageStartEvent extends BaseStreamEvent {
  type: 'message.start';
  messageId: string;
}

/**
 * Content delta event (text chunk)
 */
export interface MessageDeltaEvent extends BaseStreamEvent {
  type: 'message.delta';
  content: string;
}

/**
 * Message completed event
 */
export interface MessageCompleteEvent extends BaseStreamEvent {
  type: 'message.complete';
  messageId: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Tool execution started
 */
export interface ToolStartEvent extends BaseStreamEvent {
  type: 'tool.start';
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

/**
 * Tool execution completed
 */
export interface ToolCompleteEvent extends BaseStreamEvent {
  type: 'tool.complete';
  toolCallId: string;
  toolName: string;
  output: Record<string, unknown>;
  status: 'success' | 'failure';
  durationMs: number;
}

/**
 * Error event
 */
export interface ErrorEvent extends BaseStreamEvent {
  type: 'error';
  code: string;
  message: string;
}

/**
 * Done event - stream complete
 */
export interface DoneEvent extends BaseStreamEvent {
  type: 'done';
}

/**
 * Union of all stream event types
 */
export type StreamEvent =
  | MessageStartEvent
  | MessageDeltaEvent
  | MessageCompleteEvent
  | ToolStartEvent
  | ToolCompleteEvent
  | ErrorEvent
  | DoneEvent;

// ─────────────────────────────────────────────────────────────
// ORCHESTRATOR INPUT/OUTPUT
// ─────────────────────────────────────────────────────────────

/**
 * Input to the orchestrator
 */
export interface OrchestratorInput {
  /** User's message */
  userMessage: string;

  /** Chat ID for conversation context */
  chatId: string;

  /** User ID for preferences and permissions */
  userId: string;

  /** Optional: override config for this request */
  configOverrides?: Partial<OrchestratorConfig>;
}

/**
 * Result of orchestration (non-streaming)
 */
export interface OrchestratorResult {
  /** Final AI response content */
  content: string;

  /** Model used */
  model: string;

  /** Token usage */
  usage: {
    inputTokens: number;
    outputTokens: number;
  };

  /** Tool calls made during execution */
  toolCalls: Array<{
    toolName: string;
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    status: 'success' | 'failure';
    durationMs: number;
  }>;

  /** Number of iterations used */
  iterations: number;

  /** Memories extracted from conversation (for persistence) */
  extractedMemories: string[];
}

// ─────────────────────────────────────────────────────────────
// PROMPT BUILDER
// ─────────────────────────────────────────────────────────────

/**
 * Input for prompt builder
 */
export interface PromptBuilderInput {
  /** Layer 1: Immutable core instructions */
  coreInstructions: string;

  /** Layer 2: System prompt (from PromptService) */
  systemPrompt: string;

  /** Layer 3: User preferences */
  userPreferences: {
    responseLength: string;
    formality: string;
    customInstructions: string | null;
  };

  /** Layer 4: Retrieved memories */
  memories: Array<{
    content: string;
    category: string | null;
    importance: number;
  }>;

  /** Layer 4: Retrieved knowledge */
  knowledge: Array<{
    title: string;
    chunk: string;
  }>;

  /** Layer 5: Conversation history */
  conversationHistory: Array<{
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
  }>;

  /** Current user message */
  userMessage: string;

  /** Available tools */
  tools: ToolDefinition[];
}

/**
 * Output from prompt builder
 */
export interface PromptBuilderOutput {
  /** Messages array for LLM */
  messages: LLMMessage[];

  /** Tools in LLM format */
  tools: LLMToolDefinition[];

  /** Estimated token count */
  estimatedTokens: number;
}

// ─────────────────────────────────────────────────────────────
// TOOL EXECUTOR INTERFACE
// ─────────────────────────────────────────────────────────────

/**
 * Result from executing a tool
 */
export interface ToolExecutionResult {
  success: boolean;
  output: Record<string, unknown>;
  errorMessage?: string;
  durationMs: number;
}

/**
 * Tool executor interface
 */
export interface ToolExecutor {
  /**
   * Execute a tool by name with given input
   */
  execute(
    toolName: string,
    input: Record<string, unknown>,
    context: {
      userId: string;
      chatId: string;
      requestId: string;
    }
  ): Promise<ToolExecutionResult>;
}
