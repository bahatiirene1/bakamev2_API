/**
 * Tool Domain Types
 * Phase 2: TDD - Type definitions for ToolService
 *
 * Reference: docs/stage-2-service-layer.md Section 3.7
 *
 * SCOPE: Tool registry and invocation logging
 *
 * Policy Enforcement: Tool cost tracking (Stage 1 Section 9.4)
 */

/**
 * Tool types - how the tool is executed
 */
export type ToolType = 'local' | 'mcp' | 'n8n';

/**
 * Tool status
 */
export type ToolStatus = 'active' | 'disabled' | 'deprecated';

/**
 * Tool invocation status
 */
export type InvocationStatus = 'pending' | 'success' | 'failure';

/**
 * Tool cost tracking
 */
export interface ToolCost {
  tokens?: number;
  latencyMs?: number;
  apiCost?: number;
}

/**
 * Tool definition - for registering new tools
 */
export interface ToolDefinition {
  name: string;
  description: string;
  type: ToolType;
  config: Record<string, unknown>;
  inputSchema: Record<string, unknown>; // JSON Schema
  outputSchema?: Record<string, unknown>;
  requiresPermission?: string;
  estimatedCost?: ToolCost;
}

/**
 * Tool entity
 */
export interface Tool {
  id: string;
  name: string;
  description: string;
  type: ToolType;
  config: Record<string, unknown>;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown> | null;
  status: ToolStatus;
  requiresPermission: string | null;
  estimatedCost: ToolCost | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Tool update parameters
 */
export interface ToolUpdate {
  description?: string;
  config?: Record<string, unknown>;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  requiresPermission?: string | null;
  estimatedCost?: ToolCost | null;
}

/**
 * Tool invocation log entity
 */
export interface ToolInvocation {
  id: string;
  toolId: string;
  toolName: string;
  chatId: string | null;
  userId: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  status: InvocationStatus;
  errorMessage: string | null;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  actualCost: ToolCost | null;
  requestId: string | null;
}

/**
 * Parameters for starting an invocation
 */
export interface LogInvocationStartParams {
  toolId: string;
  chatId?: string;
  input: Record<string, unknown>;
}

/**
 * Result of starting an invocation
 */
export interface InvocationStartResult {
  invocationId: string;
}

/**
 * Parameters for completing an invocation
 */
export interface LogInvocationCompleteParams {
  status: 'success' | 'failure';
  output?: Record<string, unknown>;
  errorMessage?: string;
  actualCost?: ToolCost;
}

/**
 * Parameters for listing invocation history
 */
export interface ListInvocationsParams {
  userId?: string;
  toolId?: string;
  status?: 'success' | 'failure';
}

/**
 * Result of canInvokeTool check
 */
export interface CanInvokeResult {
  allowed: boolean;
  reason?: string;
}
