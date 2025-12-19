/**
 * AI Orchestrator Exports
 * Phase 5 will implement this following Stage 4 design
 *
 * The orchestrator manages AI interactions:
 * - Prompt construction
 * - Tool loop execution
 * - SSE streaming
 * - Cost tracking
 *
 * LLM PROVIDER: OpenRouter (https://openrouter.ai)
 * - Uses OpenAI-compatible API via 'openai' package
 * - Base URL: https://openrouter.ai/api/v1
 * - Supports Claude, GPT-4, Llama, etc.
 * - Required env: OPENROUTER_API_KEY
 */

// Export orchestrator components as they are implemented
export { createLLMClient } from './llm-client.js';
export type { LLMClientConfig } from './llm-client.js';
export { createPromptBuilder, CORE_INSTRUCTIONS } from './prompt-builder.js';
export type { PromptBuilder } from './prompt-builder.js';
export { createToolLoop } from './tool-loop.js';
export type {
  ToolLoop,
  ToolLoopConfig,
  ToolLoopContext,
  ToolLoopInput,
  ToolLoopResult,
  ToolCallRecord,
} from './tool-loop.js';
export { createOrchestrator } from './orchestrator.js';
export type {
  Orchestrator,
  OrchestratorContextService,
  OrchestratorDeps,
} from './orchestrator.js';
