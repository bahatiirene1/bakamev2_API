/**
 * Local Tools Registry
 * Phase 4: Tool Execution Layer
 *
 * Reference: docs/stage-5-tool-execution.md Section 2
 *
 * Built-in tools that run in-process without external dependencies.
 */

import type { ToolDefinition } from '@/types/tool.js';

import type { LocalToolRegistry, ToolRouteRegistry } from '../types.js';

import { calculatorHandler, calculatorToolDefinition } from './calculator.js';

/**
 * Create the local tool handlers registry
 */
export function createLocalHandlers(): LocalToolRegistry {
  const handlers: LocalToolRegistry = new Map();

  // Register calculator
  handlers.set('calculator', calculatorHandler);

  // Future tools will be registered here:
  // handlers.set('datetime', datetimeHandler);
  // handlers.set('json_parser', jsonParserHandler);

  return handlers;
}

/**
 * Create route registry for all tools
 * Maps tool names to their execution routes
 */
export function createDefaultRouteRegistry(): ToolRouteRegistry {
  const routes: ToolRouteRegistry = new Map();

  // Local tools
  routes.set('calculator', { type: 'local' });

  // MCP tools (configured but stub until MCP is set up)
  // routes.set('web_search', { type: 'mcp', server: 'brave-search', mcpToolName: 'brave_search' });

  // Workflow tools (configured but stub until n8n is set up)
  // routes.set('send_email', { type: 'n8n', workflowId: 'wf-send-email' });

  return routes;
}

/**
 * Get all local tool definitions
 */
export function getLocalToolDefinitions(): ToolDefinition[] {
  return [calculatorToolDefinition];
}

// Re-export individual tools
export { calculatorHandler, calculatorToolDefinition } from './calculator.js';
