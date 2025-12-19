/**
 * Tool Executor Exports
 * Phase 4: Tool Execution Layer
 *
 * Reference: docs/stage-5-tool-execution.md
 *
 * Tools are deterministic and stateless.
 * They execute actions on behalf of the AI.
 */

// Types
export type {
  ToolExecutionContext,
  LocalToolHandler,
  LocalToolRegistry,
  MCPClient,
  MCPConfig,
  MCPServerConfig,
  MCPToolResult,
  MCPToolInfo,
  WorkflowClient,
  WorkflowConfig,
  WorkflowResult,
  ToolExecutorDeps,
  ToolRouteInfo,
  ToolRouteRegistry,
} from './types.js';

export { ToolError } from './types.js';

// Tool Executor Factory
export { createToolExecutor } from './executor.js';
export type { CreateToolExecutorDeps } from './executor.js';

// Local Tools
export {
  createLocalHandlers,
  createDefaultRouteRegistry,
  getLocalToolDefinitions,
  calculatorHandler,
  calculatorToolDefinition,
} from './local/index.js';

export { isValidMathExpression } from './local/calculator.js';

// MCP Client (stub for now)
export { createMCPClient, createStubMCPClient } from './mcp/client.js';

// Workflow Client (stub for now)
export {
  createWorkflowClient,
  createStubWorkflowClient,
} from './workflow/client.js';
