/**
 * Tool Executor Types
 * Phase 4: Tool Execution Layer
 *
 * Reference: docs/stage-5-tool-execution.md
 *
 * SCOPE: Internal types for tool execution infrastructure
 */

import type { ToolType } from '@/types/tool.js';

/**
 * Context passed to tool handlers during execution
 */
export interface ToolExecutionContext {
  userId: string;
  chatId: string;
  requestId: string;
  timeout: number;
}

/**
 * Local tool handler function signature
 * Receives validated input and returns output
 */
export type LocalToolHandler = (
  input: Record<string, unknown>,
  context: ToolExecutionContext
) => Promise<Record<string, unknown>>;

/**
 * Registry of local tool handlers
 */
export type LocalToolRegistry = Map<string, LocalToolHandler>;

/**
 * MCP server configuration
 */
export interface MCPServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * MCP client configuration
 */
export interface MCPConfig {
  servers: Record<string, MCPServerConfig>;
}

/**
 * MCP client interface (stub for now)
 */
export interface MCPClient {
  /**
   * Call a tool on an MCP server
   */
  callTool(
    serverName: string,
    toolName: string,
    input: Record<string, unknown>,
    timeout: number
  ): Promise<MCPToolResult>;

  /**
   * List available tools from a server
   */
  listTools(serverName: string): Promise<MCPToolInfo[]>;

  /**
   * Check if client is healthy
   */
  isHealthy(): boolean;
}

/**
 * MCP tool call result
 */
export interface MCPToolResult {
  success: boolean;
  output: Record<string, unknown>;
  errorMessage?: string;
}

/**
 * MCP tool info
 */
export interface MCPToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Workflow client configuration
 */
export interface WorkflowConfig {
  baseUrl: string;
  webhookSecret: string;
}

/**
 * Workflow client interface (stub for now)
 */
export interface WorkflowClient {
  /**
   * Invoke a workflow synchronously
   */
  invoke(
    workflowId: string,
    input: Record<string, unknown>,
    timeout: number
  ): Promise<WorkflowResult>;

  /**
   * Check if client is healthy
   */
  isHealthy(): boolean;
}

/**
 * Workflow invocation result
 */
export interface WorkflowResult {
  success: boolean;
  output: Record<string, unknown>;
  errorMessage?: string;
  executionId?: string;
}

/**
 * Tool executor factory dependencies
 */
export interface ToolExecutorDeps {
  /** Registry of local tool handlers */
  localHandlers: LocalToolRegistry;

  /** MCP client (optional, can be stub) */
  mcpClient?: MCPClient;

  /** Workflow client (optional, can be stub) */
  workflowClient?: WorkflowClient;

  /** Default timeout for tool execution (ms) */
  defaultTimeout: number;
}

/**
 * Tool routing information
 * Used to look up how to execute a tool
 */
export interface ToolRouteInfo {
  type: ToolType;
  /** For MCP tools: server name */
  server?: string;
  /** For MCP tools: tool name on the server */
  mcpToolName?: string;
  /** For workflow tools: workflow ID */
  workflowId?: string;
}

/**
 * Tool route registry
 * Maps tool names to their execution route
 */
export type ToolRouteRegistry = Map<string, ToolRouteInfo>;

/**
 * Tool error for controlled failures
 */
export class ToolError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ToolError';
  }
}
