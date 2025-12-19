/**
 * ToolService Unit Tests
 * Phase 2: TDD - RED phase
 *
 * Reference: docs/stage-2-service-layer.md Section 3.7
 *
 * SCOPE: Tool registry and invocation logging
 *
 * GUARDRAILS:
 * - registerTool, updateTool, disableTool require 'tool:manage' permission
 * - canInvokeTool checks tool permission + subscription entitlements
 * - AI_ACTOR can invoke tools but not manage them
 * - SYSTEM_ACTOR can perform any operation
 * - Invocation logging records all tool executions for cost tracking
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import type {
  ToolService,
  ToolServiceDb,
  ToolServiceAudit,
  ToolServiceSubscription,
} from '@/services/tool.service.js';
import { createToolService } from '@/services/tool.service.js';
import type {
  ActorContext,
  Tool,
  ToolInvocation,
  ToolDefinition,
} from '@/types/index.js';
import { AI_ACTOR, SYSTEM_ACTOR } from '@/types/index.js';

// ─────────────────────────────────────────────────────────────
// TEST FIXTURES
// ─────────────────────────────────────────────────────────────

const TEST_USER_ID = 'test-user-123';
const TEST_ADMIN_ID = 'test-admin-456';
const TEST_OTHER_USER_ID = 'test-other-user-789';
const TEST_REQUEST_ID = 'test-request-xyz';
const TEST_TOOL_ID = 'tool-001';
const TEST_TOOL_NAME = 'web_search';
const TEST_INVOCATION_ID = 'invocation-001';
const TEST_CHAT_ID = 'chat-001';

const mockTool: Tool = {
  id: TEST_TOOL_ID,
  name: TEST_TOOL_NAME,
  description: 'Search the web for information',
  type: 'mcp',
  config: { endpoint: 'https://api.search.com' },
  inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  outputSchema: { type: 'object', properties: { results: { type: 'array' } } },
  status: 'active',
  requiresPermission: 'tool:web_search',
  estimatedCost: { tokens: 100, latencyMs: 500 },
  createdAt: new Date('2024-01-15'),
  updatedAt: new Date('2024-01-15'),
};

const mockDisabledTool: Tool = {
  ...mockTool,
  id: 'tool-002',
  name: 'deprecated_tool',
  status: 'disabled',
};

const mockLocalTool: Tool = {
  ...mockTool,
  id: 'tool-003',
  name: 'calculator',
  type: 'local',
  requiresPermission: null,
  estimatedCost: null,
};

const mockN8nTool: Tool = {
  ...mockTool,
  id: 'tool-004',
  name: 'workflow_runner',
  type: 'n8n',
  config: { workflowId: 'wf-123' },
};

const mockInvocation: ToolInvocation = {
  id: TEST_INVOCATION_ID,
  toolId: TEST_TOOL_ID,
  toolName: TEST_TOOL_NAME,
  chatId: TEST_CHAT_ID,
  userId: TEST_USER_ID,
  input: { query: 'test search' },
  output: null,
  status: 'pending',
  errorMessage: null,
  startedAt: new Date('2024-01-15T10:00:00Z'),
  completedAt: null,
  durationMs: null,
  actualCost: null,
  requestId: TEST_REQUEST_ID,
};

const mockCompletedInvocation: ToolInvocation = {
  ...mockInvocation,
  id: 'invocation-002',
  status: 'success',
  output: { results: [{ title: 'Result 1' }] },
  completedAt: new Date('2024-01-15T10:00:01Z'),
  durationMs: 1000,
  actualCost: { tokens: 150, latencyMs: 1000 },
};

const mockFailedInvocation: ToolInvocation = {
  ...mockInvocation,
  id: 'invocation-003',
  status: 'failure',
  errorMessage: 'Connection timeout',
  completedAt: new Date('2024-01-15T10:00:05Z'),
  durationMs: 5000,
};

function createTestActor(overrides?: Partial<ActorContext>): ActorContext {
  return {
    type: 'user',
    userId: TEST_USER_ID,
    requestId: TEST_REQUEST_ID,
    permissions: [],
    ...overrides,
  };
}

function createAdminActor(overrides?: Partial<ActorContext>): ActorContext {
  return {
    type: 'admin',
    userId: TEST_ADMIN_ID,
    requestId: TEST_REQUEST_ID,
    permissions: ['tool:manage'],
    ...overrides,
  };
}

function createToolDefinition(
  overrides?: Partial<ToolDefinition>
): ToolDefinition {
  return {
    name: 'new_tool',
    description: 'A new tool',
    type: 'local',
    config: {},
    inputSchema: { type: 'object' },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────
// MOCK SETUP
// ─────────────────────────────────────────────────────────────

function createMockDb(): ToolServiceDb {
  return {
    createTool: vi.fn(),
    getTool: vi.fn(),
    getToolByName: vi.fn(),
    listTools: vi.fn(),
    updateTool: vi.fn(),
    updateToolStatus: vi.fn(),
    createInvocation: vi.fn(),
    getInvocation: vi.fn(),
    completeInvocation: vi.fn(),
    listInvocations: vi.fn(),
  };
}

function createMockAuditService(): ToolServiceAudit {
  return {
    log: vi.fn().mockResolvedValue({ success: true, data: undefined }),
  };
}

function createMockSubscriptionService(): ToolServiceSubscription {
  return {
    hasEntitlement: vi.fn().mockResolvedValue({ success: true, data: true }),
    getEntitlementValue: vi
      .fn()
      .mockResolvedValue({ success: true, data: null }),
    checkUsageLimit: vi
      .fn()
      .mockResolvedValue({ success: true, data: { allowed: true } }),
  };
}

// ─────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────

describe('ToolService', () => {
  let toolService: ToolService;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockAuditService: ReturnType<typeof createMockAuditService>;
  let mockSubscriptionService: ReturnType<typeof createMockSubscriptionService>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockAuditService = createMockAuditService();
    mockSubscriptionService = createMockSubscriptionService();
    toolService = createToolService({
      db: mockDb,
      auditService: mockAuditService,
      subscriptionService: mockSubscriptionService,
    });
  });

  // ─────────────────────────────────────────────────────────────
  // REGISTER TOOL
  // ─────────────────────────────────────────────────────────────

  describe('registerTool', () => {
    it('should register a new tool with admin permission', async () => {
      const actor = createAdminActor();
      mockDb.getToolByName.mockResolvedValue(null);
      mockDb.createTool.mockResolvedValue(mockTool);

      const result = await toolService.registerTool(
        actor,
        createToolDefinition({
          name: TEST_TOOL_NAME,
          description: 'Search the web for information',
          type: 'mcp',
          config: { endpoint: 'https://api.search.com' },
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
          },
        })
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(TEST_TOOL_ID);
        expect(result.data.name).toBe(TEST_TOOL_NAME);
        expect(result.data.type).toBe('mcp');
        expect(result.data.status).toBe('active');
      }
      expect(mockAuditService.log).toHaveBeenCalled();
    });

    it('should register tool with all optional fields', async () => {
      const actor = createAdminActor();
      mockDb.getToolByName.mockResolvedValue(null);
      mockDb.createTool.mockResolvedValue(mockTool);

      const result = await toolService.registerTool(
        actor,
        createToolDefinition({
          name: TEST_TOOL_NAME,
          outputSchema: {
            type: 'object',
            properties: { results: { type: 'array' } },
          },
          requiresPermission: 'tool:web_search',
          estimatedCost: { tokens: 100, latencyMs: 500 },
        })
      );

      expect(result.success).toBe(true);
    });

    it('should register local tool type', async () => {
      const actor = createAdminActor();
      mockDb.getToolByName.mockResolvedValue(null);
      mockDb.createTool.mockResolvedValue(mockLocalTool);

      const result = await toolService.registerTool(
        actor,
        createToolDefinition({
          name: 'calculator',
          type: 'local',
        })
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('local');
      }
    });

    it('should register n8n tool type', async () => {
      const actor = createAdminActor();
      mockDb.getToolByName.mockResolvedValue(null);
      mockDb.createTool.mockResolvedValue(mockN8nTool);

      const result = await toolService.registerTool(
        actor,
        createToolDefinition({
          name: 'workflow_runner',
          type: 'n8n',
          config: { workflowId: 'wf-123' },
        })
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('n8n');
      }
    });

    it('should return ALREADY_EXISTS for duplicate tool name', async () => {
      const actor = createAdminActor();
      mockDb.getToolByName.mockResolvedValue(mockTool);

      const result = await toolService.registerTool(
        actor,
        createToolDefinition({ name: TEST_TOOL_NAME })
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('ALREADY_EXISTS');
      }
    });

    it('should deny user without tool:manage permission', async () => {
      const actor = createTestActor(); // No permissions

      const result = await toolService.registerTool(
        actor,
        createToolDefinition()
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should deny AI_ACTOR from registering tools', async () => {
      const result = await toolService.registerTool(
        AI_ACTOR,
        createToolDefinition()
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow SYSTEM_ACTOR to register tools', async () => {
      mockDb.getToolByName.mockResolvedValue(null);
      mockDb.createTool.mockResolvedValue(mockTool);

      const result = await toolService.registerTool(
        SYSTEM_ACTOR,
        createToolDefinition()
      );

      expect(result.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // GET TOOL
  // ─────────────────────────────────────────────────────────────

  describe('getTool', () => {
    it('should get tool by ID', async () => {
      const actor = createTestActor();
      mockDb.getTool.mockResolvedValue(mockTool);

      const result = await toolService.getTool(actor, TEST_TOOL_ID);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(TEST_TOOL_ID);
        expect(result.data.name).toBe(TEST_TOOL_NAME);
      }
    });

    it('should return NOT_FOUND for non-existent tool', async () => {
      const actor = createTestActor();
      mockDb.getTool.mockResolvedValue(null);

      const result = await toolService.getTool(actor, 'non-existent-id');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should allow any authenticated user to get tool', async () => {
      const actor = createTestActor();
      mockDb.getTool.mockResolvedValue(mockTool);

      const result = await toolService.getTool(actor, TEST_TOOL_ID);

      expect(result.success).toBe(true);
    });

    it('should allow AI_ACTOR to get tool', async () => {
      mockDb.getTool.mockResolvedValue(mockTool);

      const result = await toolService.getTool(AI_ACTOR, TEST_TOOL_ID);

      expect(result.success).toBe(true);
    });

    it('should allow SYSTEM_ACTOR to get tool', async () => {
      mockDb.getTool.mockResolvedValue(mockTool);

      const result = await toolService.getTool(SYSTEM_ACTOR, TEST_TOOL_ID);

      expect(result.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // GET TOOL BY NAME
  // ─────────────────────────────────────────────────────────────

  describe('getToolByName', () => {
    it('should get tool by name', async () => {
      const actor = createTestActor();
      mockDb.getToolByName.mockResolvedValue(mockTool);

      const result = await toolService.getToolByName(actor, TEST_TOOL_NAME);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe(TEST_TOOL_NAME);
      }
    });

    it('should return NOT_FOUND for non-existent tool name', async () => {
      const actor = createTestActor();
      mockDb.getToolByName.mockResolvedValue(null);

      const result = await toolService.getToolByName(actor, 'non-existent');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should allow AI_ACTOR to get tool by name', async () => {
      mockDb.getToolByName.mockResolvedValue(mockTool);

      const result = await toolService.getToolByName(AI_ACTOR, TEST_TOOL_NAME);

      expect(result.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // LIST AVAILABLE TOOLS
  // ─────────────────────────────────────────────────────────────

  describe('listAvailableTools', () => {
    it('should list only active tools', async () => {
      const actor = createTestActor();
      mockDb.listTools.mockResolvedValue([mockTool, mockLocalTool]);

      const result = await toolService.listAvailableTools(actor);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(2);
        expect(result.data.every((t) => t.status === 'active')).toBe(true);
      }
      expect(mockDb.listTools).toHaveBeenCalledWith({ status: 'active' });
    });

    it('should return empty array when no tools available', async () => {
      const actor = createTestActor();
      mockDb.listTools.mockResolvedValue([]);

      const result = await toolService.listAvailableTools(actor);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(0);
      }
    });

    it('should allow any authenticated user to list tools', async () => {
      const actor = createTestActor();
      mockDb.listTools.mockResolvedValue([mockTool]);

      const result = await toolService.listAvailableTools(actor);

      expect(result.success).toBe(true);
    });

    it('should allow AI_ACTOR to list tools', async () => {
      mockDb.listTools.mockResolvedValue([mockTool]);

      const result = await toolService.listAvailableTools(AI_ACTOR);

      expect(result.success).toBe(true);
    });

    it('should allow SYSTEM_ACTOR to list tools', async () => {
      mockDb.listTools.mockResolvedValue([mockTool]);

      const result = await toolService.listAvailableTools(SYSTEM_ACTOR);

      expect(result.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // UPDATE TOOL
  // ─────────────────────────────────────────────────────────────

  describe('updateTool', () => {
    it('should update tool with admin permission', async () => {
      const actor = createAdminActor();
      const updatedTool = {
        ...mockTool,
        description: 'Updated description',
      };
      mockDb.getTool.mockResolvedValue(mockTool);
      mockDb.updateTool.mockResolvedValue(updatedTool);

      const result = await toolService.updateTool(actor, TEST_TOOL_ID, {
        description: 'Updated description',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.description).toBe('Updated description');
      }
      expect(mockAuditService.log).toHaveBeenCalled();
    });

    it('should update tool config', async () => {
      const actor = createAdminActor();
      const updatedTool = {
        ...mockTool,
        config: { endpoint: 'https://new-api.search.com' },
      };
      mockDb.getTool.mockResolvedValue(mockTool);
      mockDb.updateTool.mockResolvedValue(updatedTool);

      const result = await toolService.updateTool(actor, TEST_TOOL_ID, {
        config: { endpoint: 'https://new-api.search.com' },
      });

      expect(result.success).toBe(true);
    });

    it('should update tool inputSchema', async () => {
      const actor = createAdminActor();
      const newSchema = {
        type: 'object',
        properties: { q: { type: 'string' } },
      };
      const updatedTool = {
        ...mockTool,
        inputSchema: newSchema,
      };
      mockDb.getTool.mockResolvedValue(mockTool);
      mockDb.updateTool.mockResolvedValue(updatedTool);

      const result = await toolService.updateTool(actor, TEST_TOOL_ID, {
        inputSchema: newSchema,
      });

      expect(result.success).toBe(true);
    });

    it('should update requiresPermission to null', async () => {
      const actor = createAdminActor();
      const updatedTool = {
        ...mockTool,
        requiresPermission: null,
      };
      mockDb.getTool.mockResolvedValue(mockTool);
      mockDb.updateTool.mockResolvedValue(updatedTool);

      const result = await toolService.updateTool(actor, TEST_TOOL_ID, {
        requiresPermission: null,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.requiresPermission).toBeNull();
      }
    });

    it('should return NOT_FOUND for non-existent tool', async () => {
      const actor = createAdminActor();
      mockDb.getTool.mockResolvedValue(null);

      const result = await toolService.updateTool(actor, 'non-existent-id', {
        description: 'Updated',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should deny user without tool:manage permission', async () => {
      const actor = createTestActor();
      mockDb.getTool.mockResolvedValue(mockTool);

      const result = await toolService.updateTool(actor, TEST_TOOL_ID, {
        description: 'Updated',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should deny AI_ACTOR from updating tools', async () => {
      mockDb.getTool.mockResolvedValue(mockTool);

      const result = await toolService.updateTool(AI_ACTOR, TEST_TOOL_ID, {
        description: 'Updated',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow SYSTEM_ACTOR to update tools', async () => {
      mockDb.getTool.mockResolvedValue(mockTool);
      mockDb.updateTool.mockResolvedValue({
        ...mockTool,
        description: 'Updated',
      });

      const result = await toolService.updateTool(SYSTEM_ACTOR, TEST_TOOL_ID, {
        description: 'Updated',
      });

      expect(result.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // DISABLE TOOL
  // ─────────────────────────────────────────────────────────────

  describe('disableTool', () => {
    it('should disable tool with admin permission', async () => {
      const actor = createAdminActor();
      mockDb.getTool.mockResolvedValue(mockTool);
      mockDb.updateToolStatus.mockResolvedValue({
        ...mockTool,
        status: 'disabled',
      });

      const result = await toolService.disableTool(
        actor,
        TEST_TOOL_ID,
        'No longer needed'
      );

      expect(result.success).toBe(true);
      expect(mockDb.updateToolStatus).toHaveBeenCalledWith(
        TEST_TOOL_ID,
        'disabled'
      );
      expect(mockAuditService.log).toHaveBeenCalled();
    });

    it('should return NOT_FOUND for non-existent tool', async () => {
      const actor = createAdminActor();
      mockDb.getTool.mockResolvedValue(null);

      const result = await toolService.disableTool(
        actor,
        'non-existent-id',
        'reason'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should return INVALID_STATE for already disabled tool', async () => {
      const actor = createAdminActor();
      mockDb.getTool.mockResolvedValue(mockDisabledTool);

      const result = await toolService.disableTool(
        actor,
        mockDisabledTool.id,
        'Already disabled'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_STATE');
      }
    });

    it('should deny user without tool:manage permission', async () => {
      const actor = createTestActor();
      mockDb.getTool.mockResolvedValue(mockTool);

      const result = await toolService.disableTool(
        actor,
        TEST_TOOL_ID,
        'reason'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should deny AI_ACTOR from disabling tools', async () => {
      mockDb.getTool.mockResolvedValue(mockTool);

      const result = await toolService.disableTool(
        AI_ACTOR,
        TEST_TOOL_ID,
        'reason'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow SYSTEM_ACTOR to disable tools', async () => {
      mockDb.getTool.mockResolvedValue(mockTool);
      mockDb.updateToolStatus.mockResolvedValue({
        ...mockTool,
        status: 'disabled',
      });

      const result = await toolService.disableTool(
        SYSTEM_ACTOR,
        TEST_TOOL_ID,
        'System maintenance'
      );

      expect(result.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // CAN INVOKE TOOL
  // ─────────────────────────────────────────────────────────────

  describe('canInvokeTool', () => {
    it('should allow invocation for tool without permission requirement', async () => {
      const actor = createTestActor();
      mockDb.getToolByName.mockResolvedValue(mockLocalTool); // No requiresPermission

      const result = await toolService.canInvokeTool(actor, mockLocalTool.name);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.allowed).toBe(true);
      }
    });

    it('should allow invocation when user has required permission', async () => {
      const actor = createTestActor({
        permissions: ['tool:web_search'],
      });
      mockDb.getToolByName.mockResolvedValue(mockTool);

      const result = await toolService.canInvokeTool(actor, TEST_TOOL_NAME);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.allowed).toBe(true);
      }
    });

    it('should deny invocation when user lacks required permission', async () => {
      const actor = createTestActor(); // No permissions
      mockDb.getToolByName.mockResolvedValue(mockTool);

      const result = await toolService.canInvokeTool(actor, TEST_TOOL_NAME);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.allowed).toBe(false);
        expect(result.data.reason).toContain('permission');
      }
    });

    it('should deny invocation when subscription usage limit exceeded', async () => {
      const actor = createTestActor({
        permissions: ['tool:web_search'],
      });
      mockDb.getToolByName.mockResolvedValue(mockTool);
      mockSubscriptionService.checkUsageLimit.mockResolvedValue({
        success: true,
        data: { allowed: false, reason: 'Usage limit exceeded' },
      });

      const result = await toolService.canInvokeTool(actor, TEST_TOOL_NAME);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.allowed).toBe(false);
        expect(result.data.reason).toContain('limit');
      }
    });

    it('should deny invocation for disabled tool', async () => {
      const actor = createTestActor();
      mockDb.getToolByName.mockResolvedValue(mockDisabledTool);

      const result = await toolService.canInvokeTool(
        actor,
        mockDisabledTool.name
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.allowed).toBe(false);
        expect(result.data.reason).toContain('disabled');
      }
    });

    it('should return NOT_FOUND for non-existent tool', async () => {
      const actor = createTestActor();
      mockDb.getToolByName.mockResolvedValue(null);

      const result = await toolService.canInvokeTool(actor, 'non-existent');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should allow AI_ACTOR to invoke tools (with permission check)', async () => {
      mockDb.getToolByName.mockResolvedValue(mockLocalTool);

      const result = await toolService.canInvokeTool(
        AI_ACTOR,
        mockLocalTool.name
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.allowed).toBe(true);
      }
    });

    it('should allow SYSTEM_ACTOR to invoke any tool', async () => {
      mockDb.getToolByName.mockResolvedValue(mockTool);

      const result = await toolService.canInvokeTool(
        SYSTEM_ACTOR,
        TEST_TOOL_NAME
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.allowed).toBe(true);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // LOG INVOCATION START
  // ─────────────────────────────────────────────────────────────

  describe('logInvocationStart', () => {
    it('should log invocation start for user', async () => {
      const actor = createTestActor();
      mockDb.getTool.mockResolvedValue(mockTool);
      mockDb.createInvocation.mockResolvedValue(mockInvocation);

      const result = await toolService.logInvocationStart(actor, {
        toolId: TEST_TOOL_ID,
        chatId: TEST_CHAT_ID,
        input: { query: 'test search' },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.invocationId).toBe(TEST_INVOCATION_ID);
      }
      expect(mockDb.createInvocation).toHaveBeenCalledWith({
        toolId: TEST_TOOL_ID,
        userId: TEST_USER_ID,
        chatId: TEST_CHAT_ID,
        input: { query: 'test search' },
        requestId: TEST_REQUEST_ID,
      });
    });

    it('should log invocation without chatId', async () => {
      const actor = createTestActor();
      const invocationWithoutChat = { ...mockInvocation, chatId: null };
      mockDb.getTool.mockResolvedValue(mockTool);
      mockDb.createInvocation.mockResolvedValue(invocationWithoutChat);

      const result = await toolService.logInvocationStart(actor, {
        toolId: TEST_TOOL_ID,
        input: { query: 'test search' },
      });

      expect(result.success).toBe(true);
    });

    it('should return NOT_FOUND for non-existent tool', async () => {
      const actor = createTestActor();
      mockDb.getTool.mockResolvedValue(null);

      const result = await toolService.logInvocationStart(actor, {
        toolId: 'non-existent-id',
        input: {},
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should allow AI_ACTOR to log invocation start', async () => {
      mockDb.getTool.mockResolvedValue(mockTool);
      mockDb.createInvocation.mockResolvedValue(mockInvocation);

      const result = await toolService.logInvocationStart(AI_ACTOR, {
        toolId: TEST_TOOL_ID,
        input: { query: 'AI query' },
      });

      expect(result.success).toBe(true);
    });

    it('should allow SYSTEM_ACTOR to log invocation start', async () => {
      mockDb.getTool.mockResolvedValue(mockTool);
      mockDb.createInvocation.mockResolvedValue(mockInvocation);

      const result = await toolService.logInvocationStart(SYSTEM_ACTOR, {
        toolId: TEST_TOOL_ID,
        input: { query: 'System query' },
      });

      expect(result.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // LOG INVOCATION COMPLETE
  // ─────────────────────────────────────────────────────────────

  describe('logInvocationComplete', () => {
    it('should log successful invocation completion', async () => {
      const actor = createTestActor();
      mockDb.getInvocation.mockResolvedValue(mockInvocation);
      mockDb.completeInvocation.mockResolvedValue(mockCompletedInvocation);

      const result = await toolService.logInvocationComplete(
        actor,
        TEST_INVOCATION_ID,
        {
          status: 'success',
          output: { results: [{ title: 'Result 1' }] },
          actualCost: { tokens: 150, latencyMs: 1000 },
        }
      );

      expect(result.success).toBe(true);
      expect(mockDb.completeInvocation).toHaveBeenCalledWith(
        TEST_INVOCATION_ID,
        expect.objectContaining({
          status: 'success',
          output: { results: [{ title: 'Result 1' }] },
        })
      );
    });

    it('should log failed invocation completion', async () => {
      const actor = createTestActor();
      mockDb.getInvocation.mockResolvedValue(mockInvocation);
      mockDb.completeInvocation.mockResolvedValue(mockFailedInvocation);

      const result = await toolService.logInvocationComplete(
        actor,
        TEST_INVOCATION_ID,
        {
          status: 'failure',
          errorMessage: 'Connection timeout',
        }
      );

      expect(result.success).toBe(true);
      expect(mockDb.completeInvocation).toHaveBeenCalledWith(
        TEST_INVOCATION_ID,
        expect.objectContaining({
          status: 'failure',
          errorMessage: 'Connection timeout',
        })
      );
    });

    it('should return NOT_FOUND for non-existent invocation', async () => {
      const actor = createTestActor();
      mockDb.getInvocation.mockResolvedValue(null);

      const result = await toolService.logInvocationComplete(
        actor,
        'non-existent-id',
        { status: 'success' }
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should return INVALID_STATE for already completed invocation', async () => {
      const actor = createTestActor();
      mockDb.getInvocation.mockResolvedValue(mockCompletedInvocation);

      const result = await toolService.logInvocationComplete(
        actor,
        mockCompletedInvocation.id,
        { status: 'success' }
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_STATE');
      }
    });

    it('should deny completion by different user', async () => {
      const actor = createTestActor({ userId: TEST_OTHER_USER_ID });
      mockDb.getInvocation.mockResolvedValue(mockInvocation);

      const result = await toolService.logInvocationComplete(
        actor,
        TEST_INVOCATION_ID,
        { status: 'success' }
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow AI_ACTOR to complete invocations', async () => {
      const aiInvocation = { ...mockInvocation, userId: 'ai' };
      mockDb.getInvocation.mockResolvedValue(aiInvocation);
      mockDb.completeInvocation.mockResolvedValue({
        ...mockCompletedInvocation,
        userId: 'ai',
      });

      const result = await toolService.logInvocationComplete(
        AI_ACTOR,
        TEST_INVOCATION_ID,
        { status: 'success' }
      );

      expect(result.success).toBe(true);
    });

    it('should allow SYSTEM_ACTOR to complete any invocation', async () => {
      mockDb.getInvocation.mockResolvedValue(mockInvocation);
      mockDb.completeInvocation.mockResolvedValue(mockCompletedInvocation);

      const result = await toolService.logInvocationComplete(
        SYSTEM_ACTOR,
        TEST_INVOCATION_ID,
        { status: 'success' }
      );

      expect(result.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // GET INVOCATION HISTORY
  // ─────────────────────────────────────────────────────────────

  describe('getInvocationHistory', () => {
    it('should list invocations for admin user', async () => {
      const actor = createAdminActor();
      mockDb.listInvocations.mockResolvedValue({
        items: [mockCompletedInvocation, mockFailedInvocation],
        hasMore: false,
      });

      const result = await toolService.getInvocationHistory(actor, {
        limit: 20,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.items).toHaveLength(2);
      }
    });

    it('should filter by userId', async () => {
      const actor = createAdminActor();
      mockDb.listInvocations.mockResolvedValue({
        items: [mockCompletedInvocation],
        hasMore: false,
      });

      const result = await toolService.getInvocationHistory(actor, {
        userId: TEST_USER_ID,
        limit: 20,
      });

      expect(result.success).toBe(true);
      expect(mockDb.listInvocations).toHaveBeenCalledWith(
        expect.objectContaining({ userId: TEST_USER_ID })
      );
    });

    it('should filter by toolId', async () => {
      const actor = createAdminActor();
      mockDb.listInvocations.mockResolvedValue({
        items: [mockCompletedInvocation],
        hasMore: false,
      });

      const result = await toolService.getInvocationHistory(actor, {
        toolId: TEST_TOOL_ID,
        limit: 20,
      });

      expect(result.success).toBe(true);
      expect(mockDb.listInvocations).toHaveBeenCalledWith(
        expect.objectContaining({ toolId: TEST_TOOL_ID })
      );
    });

    it('should filter by status', async () => {
      const actor = createAdminActor();
      mockDb.listInvocations.mockResolvedValue({
        items: [mockFailedInvocation],
        hasMore: false,
      });

      const result = await toolService.getInvocationHistory(actor, {
        status: 'failure',
        limit: 20,
      });

      expect(result.success).toBe(true);
      expect(mockDb.listInvocations).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failure' })
      );
    });

    it('should support pagination', async () => {
      const actor = createAdminActor();
      mockDb.listInvocations.mockResolvedValue({
        items: [mockCompletedInvocation],
        hasMore: true,
        nextCursor: 'next-cursor-123',
      });

      const result = await toolService.getInvocationHistory(actor, {
        limit: 5,
        cursor: 'cursor-123',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.hasMore).toBe(true);
      }
    });

    it('should restrict regular user to their own invocations', async () => {
      const actor = createTestActor();
      mockDb.listInvocations.mockResolvedValue({
        items: [mockCompletedInvocation],
        hasMore: false,
      });

      const result = await toolService.getInvocationHistory(actor, {
        limit: 20,
      });

      expect(result.success).toBe(true);
      // Should force userId filter to actor's userId
      expect(mockDb.listInvocations).toHaveBeenCalledWith(
        expect.objectContaining({ userId: TEST_USER_ID })
      );
    });

    it('should deny regular user from viewing other user invocations', async () => {
      const actor = createTestActor();

      const result = await toolService.getInvocationHistory(actor, {
        userId: TEST_OTHER_USER_ID,
        limit: 20,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow admin to view any user invocations', async () => {
      const actor = createAdminActor();
      mockDb.listInvocations.mockResolvedValue({
        items: [],
        hasMore: false,
      });

      const result = await toolService.getInvocationHistory(actor, {
        userId: TEST_OTHER_USER_ID,
        limit: 20,
      });

      expect(result.success).toBe(true);
    });

    it('should allow SYSTEM_ACTOR to view all invocations', async () => {
      mockDb.listInvocations.mockResolvedValue({
        items: [mockCompletedInvocation, mockFailedInvocation],
        hasMore: false,
      });

      const result = await toolService.getInvocationHistory(SYSTEM_ACTOR, {
        limit: 20,
      });

      expect(result.success).toBe(true);
    });
  });
});
