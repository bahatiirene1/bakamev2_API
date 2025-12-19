/**
 * Tool Executor Factory
 * Phase 4: Tool Execution Layer
 *
 * Reference: docs/stage-5-tool-execution.md Section 8
 *
 * Routes tool calls to appropriate handlers (local, MCP, workflow)
 */

import type {
  ToolExecutor,
  ToolExecutionResult,
} from '@/types/orchestrator.js';

import type {
  LocalToolRegistry,
  MCPClient,
  WorkflowClient,
  ToolRouteRegistry,
  ToolExecutionContext,
} from './types.js';
import { ToolError } from './types.js';

/**
 * Dependencies for creating a tool executor
 */
export interface CreateToolExecutorDeps {
  /** Registry of local tool handlers */
  localHandlers: LocalToolRegistry;

  /** Route registry mapping tool names to execution routes */
  routeRegistry: ToolRouteRegistry;

  /** MCP client (optional) */
  mcpClient?: MCPClient;

  /** Workflow client (optional) */
  workflowClient?: WorkflowClient;

  /** Default timeout for tool execution (ms) */
  defaultTimeout: number;
}

/**
 * Create a tool executor instance
 *
 * The executor routes tool calls to the appropriate handler based on
 * the tool's type (local, mcp, or n8n/workflow).
 */
export function createToolExecutor(deps: CreateToolExecutorDeps): ToolExecutor {
  const {
    localHandlers,
    routeRegistry,
    mcpClient,
    workflowClient,
    defaultTimeout,
  } = deps;

  return {
    async execute(
      toolName: string,
      input: Record<string, unknown>,
      context: { userId: string; chatId: string; requestId: string }
    ): Promise<ToolExecutionResult> {
      const startTime = Date.now();

      // Look up route for this tool
      const route = routeRegistry.get(toolName);

      if (!route) {
        return {
          success: false,
          output: {},
          errorMessage: `Unknown tool: ${toolName}`,
          durationMs: Date.now() - startTime,
        };
      }

      // Build execution context
      const executionContext: ToolExecutionContext = {
        ...context,
        timeout: defaultTimeout,
      };

      try {
        switch (route.type) {
          case 'local':
            return await executeLocal(
              toolName,
              input,
              executionContext,
              localHandlers,
              startTime
            );

          case 'mcp': {
            const server = route.server ?? '';
            const mcpToolName = route.mcpToolName ?? toolName;
            return await executeMCP(
              server,
              mcpToolName,
              input,
              executionContext,
              mcpClient,
              startTime
            );
          }

          case 'n8n': {
            const workflowId = route.workflowId ?? '';
            return await executeWorkflow(
              workflowId,
              input,
              executionContext,
              workflowClient,
              startTime
            );
          }

          default: {
            const unknownType = route.type as string;
            return {
              success: false,
              output: {},
              errorMessage: `Unknown tool type: ${unknownType}`,
              durationMs: Date.now() - startTime,
            };
          }
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        return {
          success: false,
          output: {},
          errorMessage: message,
          durationMs: Date.now() - startTime,
        };
      }
    },
  };
}

/**
 * Execute a local tool handler
 */
async function executeLocal(
  toolName: string,
  input: Record<string, unknown>,
  context: ToolExecutionContext,
  handlers: LocalToolRegistry,
  startTime: number
): Promise<ToolExecutionResult> {
  const handler = handlers.get(toolName);

  if (!handler) {
    return {
      success: false,
      output: {},
      errorMessage: `No handler registered for local tool: ${toolName}`,
      durationMs: Date.now() - startTime,
    };
  }

  try {
    const output = await handler(input, context);
    return {
      success: true,
      output,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    let message: string;
    if (error instanceof ToolError) {
      message = error.message;
    } else if (error instanceof Error) {
      message = error.message;
    } else {
      message = 'Unknown error';
    }

    return {
      success: false,
      output: {},
      errorMessage: message,
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Execute an MCP tool via the MCP client
 */
async function executeMCP(
  serverName: string,
  toolName: string,
  input: Record<string, unknown>,
  context: ToolExecutionContext,
  mcpClient: MCPClient | undefined,
  startTime: number
): Promise<ToolExecutionResult> {
  if (!mcpClient) {
    return {
      success: false,
      output: {},
      errorMessage: 'MCP client not configured',
      durationMs: Date.now() - startTime,
    };
  }

  try {
    const result = await mcpClient.callTool(
      serverName,
      toolName,
      input,
      context.timeout
    );

    if (!result.success) {
      return {
        success: false,
        output: result.output,
        errorMessage: result.errorMessage ?? 'MCP tool execution failed',
        durationMs: Date.now() - startTime,
      };
    }

    return {
      success: true,
      output: result.output,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'MCP execution failed';
    return {
      success: false,
      output: {},
      errorMessage: message,
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Execute a workflow via the workflow client (n8n)
 */
async function executeWorkflow(
  workflowId: string,
  input: Record<string, unknown>,
  context: ToolExecutionContext,
  workflowClient: WorkflowClient | undefined,
  startTime: number
): Promise<ToolExecutionResult> {
  if (!workflowClient) {
    return {
      success: false,
      output: {},
      errorMessage: 'Workflow client not configured',
      durationMs: Date.now() - startTime,
    };
  }

  try {
    const result = await workflowClient.invoke(
      workflowId,
      input,
      context.timeout
    );

    if (!result.success) {
      return {
        success: false,
        output: result.output,
        errorMessage: result.errorMessage ?? 'Workflow execution failed',
        durationMs: Date.now() - startTime,
      };
    }

    return {
      success: true,
      output: result.output,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Workflow execution failed';
    return {
      success: false,
      output: {},
      errorMessage: message,
      durationMs: Date.now() - startTime,
    };
  }
}
