/**
 * MCP Client Stub
 * Phase 4: Tool Execution Layer
 *
 * Reference: docs/stage-5-tool-execution.md Section 3
 *
 * STUB IMPLEMENTATION: Will be replaced with real MCP SDK integration
 * when MCP servers are configured.
 */

import type {
  MCPClient,
  MCPToolResult,
  MCPToolInfo,
  MCPConfig,
} from '../types.js';

/**
 * Create a stub MCP client
 *
 * This is a placeholder that returns appropriate errors.
 * Replace with real MCP SDK integration when ready.
 */
export function createStubMCPClient(_config?: MCPConfig): MCPClient {
  return {
    callTool(
      serverName: string,
      toolName: string,
      _input: Record<string, unknown>,
      _timeout: number
    ): Promise<MCPToolResult> {
      // Stub: always return not configured
      return Promise.resolve({
        success: false,
        output: {},
        errorMessage: `MCP server '${serverName}' not configured. Tool '${toolName}' unavailable.`,
      });
    },

    listTools(_serverName: string): Promise<MCPToolInfo[]> {
      // Stub: return empty list
      return Promise.resolve([]);
    },

    isHealthy(): boolean {
      // Stub is always "healthy" but non-functional
      return false;
    },
  };
}

/**
 * MCP Client Factory
 *
 * When implementing real MCP, this factory will:
 * 1. Spawn MCP server processes
 * 2. Establish stdio/SSE connections
 * 3. Handle server lifecycle (start, health check, restart)
 *
 * For now, returns stub.
 */
export function createMCPClient(config?: MCPConfig): MCPClient {
  // TODO: Implement real MCP client with @modelcontextprotocol/sdk
  // For now, return stub
  return createStubMCPClient(config);
}
