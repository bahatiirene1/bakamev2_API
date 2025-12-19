/**
 * Tool Executor Factory Tests
 * Phase 4: Tool Execution Layer - TDD
 *
 * Reference: docs/stage-5-tool-execution.md Section 8
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createToolExecutor } from '@/tools/executor.js';
import { calculatorHandler } from '@/tools/local/calculator.js';
import type {
  LocalToolRegistry,
  MCPClient,
  WorkflowClient,
  ToolRouteRegistry,
} from '@/tools/types.js';
import type { ToolExecutor } from '@/types/orchestrator.js';

describe('Tool Executor Factory', () => {
  let executor: ToolExecutor;
  let localHandlers: LocalToolRegistry;
  let routeRegistry: ToolRouteRegistry;
  let mockMCPClient: MCPClient;
  let mockWorkflowClient: WorkflowClient;

  const defaultContext = {
    userId: 'user-123',
    chatId: 'chat-456',
    requestId: 'req-789',
  };

  beforeEach(() => {
    // Set up local handlers
    localHandlers = new Map();
    localHandlers.set('calculator', calculatorHandler);

    // Set up route registry
    routeRegistry = new Map();
    routeRegistry.set('calculator', { type: 'local' });
    routeRegistry.set('web_search', {
      type: 'mcp',
      server: 'brave-search',
      mcpToolName: 'brave_search',
    });
    routeRegistry.set('send_email', {
      type: 'n8n',
      workflowId: 'wf-send-email',
    });

    // Set up mock MCP client
    mockMCPClient = {
      callTool: vi.fn().mockResolvedValue({
        success: true,
        output: { results: [{ title: 'Test', url: 'https://example.com' }] },
      }),
      listTools: vi.fn().mockResolvedValue([]),
      isHealthy: vi.fn().mockReturnValue(true),
    };

    // Set up mock workflow client
    mockWorkflowClient = {
      invoke: vi.fn().mockResolvedValue({
        success: true,
        output: { sent: true, messageId: 'msg-123' },
        executionId: 'exec-456',
      }),
      isHealthy: vi.fn().mockReturnValue(true),
    };

    // Create executor
    executor = createToolExecutor({
      localHandlers,
      routeRegistry,
      mcpClient: mockMCPClient,
      workflowClient: mockWorkflowClient,
      defaultTimeout: 30000,
    });
  });

  describe('Local Tool Execution', () => {
    it('should execute calculator tool successfully', async () => {
      const result = await executor.execute(
        'calculator',
        { expression: '2 + 2' },
        defaultContext
      );

      expect(result.success).toBe(true);
      expect(result.output).toEqual({
        expression: '2 + 2',
        result: 4,
        resultType: 'number',
      });
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle calculator errors gracefully', async () => {
      const result = await executor.execute(
        'calculator',
        { expression: 'eval("bad")' },
        defaultContext
      );

      expect(result.success).toBe(false);
      expect(result.errorMessage).toBeDefined();
      expect(result.errorMessage).toContain('Invalid math expression');
    });

    it('should handle missing expression', async () => {
      const result = await executor.execute('calculator', {}, defaultContext);

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain('Expression is required');
    });
  });

  describe('MCP Tool Execution', () => {
    it('should route MCP tools to MCP client', async () => {
      const result = await executor.execute(
        'web_search',
        { query: 'test query' },
        defaultContext
      );

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockMCPClient.callTool).toHaveBeenCalledWith(
        'brave-search',
        'brave_search',
        { query: 'test query' },
        30000
      );
      expect(result.success).toBe(true);
      expect(result.output).toEqual({
        results: [{ title: 'Test', url: 'https://example.com' }],
      });
    });

    it('should handle MCP tool errors', async () => {
      mockMCPClient.callTool = vi.fn().mockResolvedValue({
        success: false,
        output: {},
        errorMessage: 'MCP server error',
      });

      const result = await executor.execute(
        'web_search',
        { query: 'test' },
        defaultContext
      );

      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe('MCP server error');
    });

    it('should handle MCP client not configured', async () => {
      const executorWithoutMCP = createToolExecutor({
        localHandlers,
        routeRegistry,
        defaultTimeout: 30000,
      });

      const result = await executorWithoutMCP.execute(
        'web_search',
        { query: 'test' },
        defaultContext
      );

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain('MCP client not configured');
    });
  });

  describe('Workflow Tool Execution', () => {
    it('should route workflow tools to workflow client', async () => {
      const result = await executor.execute(
        'send_email',
        { to: 'test@example.com', subject: 'Test', body: 'Hello' },
        defaultContext
      );

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockWorkflowClient.invoke).toHaveBeenCalledWith(
        'wf-send-email',
        { to: 'test@example.com', subject: 'Test', body: 'Hello' },
        30000
      );
      expect(result.success).toBe(true);
      expect(result.output).toEqual({ sent: true, messageId: 'msg-123' });
    });

    it('should handle workflow errors', async () => {
      mockWorkflowClient.invoke = vi.fn().mockResolvedValue({
        success: false,
        output: {},
        errorMessage: 'Workflow timeout',
      });

      const result = await executor.execute(
        'send_email',
        { to: 'test@example.com' },
        defaultContext
      );

      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe('Workflow timeout');
    });

    it('should handle workflow client not configured', async () => {
      const executorWithoutWorkflow = createToolExecutor({
        localHandlers,
        routeRegistry,
        defaultTimeout: 30000,
      });

      const result = await executorWithoutWorkflow.execute(
        'send_email',
        { to: 'test@example.com' },
        defaultContext
      );

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain('Workflow client not configured');
    });
  });

  describe('Unknown Tool Handling', () => {
    it('should return error for unknown tool', async () => {
      const result = await executor.execute(
        'unknown_tool',
        { foo: 'bar' },
        defaultContext
      );

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain('Unknown tool: unknown_tool');
    });
  });

  describe('Error Handling', () => {
    it('should catch and wrap handler exceptions', async () => {
      // Add a handler that throws
      localHandlers.set('failing_tool', async () => {
        throw new Error('Handler exploded');
      });
      routeRegistry.set('failing_tool', { type: 'local' });

      const result = await executor.execute('failing_tool', {}, defaultContext);

      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe('Handler exploded');
    });

    it('should catch MCP client exceptions', async () => {
      mockMCPClient.callTool = vi
        .fn()
        .mockRejectedValue(new Error('Connection failed'));

      const result = await executor.execute(
        'web_search',
        { query: 'test' },
        defaultContext
      );

      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe('Connection failed');
    });

    it('should catch workflow client exceptions', async () => {
      mockWorkflowClient.invoke = vi
        .fn()
        .mockRejectedValue(new Error('Network error'));

      const result = await executor.execute(
        'send_email',
        { to: 'test@example.com' },
        defaultContext
      );

      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe('Network error');
    });
  });

  describe('Duration Tracking', () => {
    it('should track execution duration', async () => {
      const result = await executor.execute(
        'calculator',
        { expression: '1 + 1' },
        defaultContext
      );

      expect(result.durationMs).toBeDefined();
      expect(typeof result.durationMs).toBe('number');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});
