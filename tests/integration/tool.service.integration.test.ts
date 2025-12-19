/**
 * ToolService Integration Tests
 * Phase 2: Tests with real Supabase database
 *
 * These tests require:
 * - SUPABASE_URL environment variable
 * - SUPABASE_SERVICE_KEY environment variable
 * - Database with tool_registry and tool_invocation_logs tables
 *
 * Tests are skipped if credentials are not available.
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

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import {
  createToolService,
  createToolServiceDb,
  createAuditService,
  createAuditServiceDb,
  createUserService,
  createUserServiceDb,
} from '@/services/index.js';
import type {
  ToolService,
  AuditService,
  UserService,
  ToolServiceSubscription,
} from '@/services/index.js';
import type { ActorContext, Result } from '@/types/index.js';
import { AI_ACTOR } from '@/types/index.js';

// Check if we have database credentials
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const HAS_CREDENTIALS =
  SUPABASE_URL !== undefined &&
  SUPABASE_URL !== '' &&
  SUPABASE_SERVICE_KEY !== undefined &&
  SUPABASE_SERVICE_KEY !== '';

// Test fixtures - use nanoid for unique test identifiers
const TEST_PREFIX = `tool_test_${nanoid(6)}`;

// Helper to create unique test IDs
function testId(prefix: string): string {
  return `${TEST_PREFIX}_${prefix}_${nanoid(6)}`;
}

// Helper to create test actor
function createTestActor(
  userId: string,
  overrides?: Partial<ActorContext>
): ActorContext {
  return {
    type: 'user',
    userId,
    requestId: testId('req'),
    permissions: [],
    ...overrides,
  };
}

// Helper to create admin actor with tool:manage permission
function createAdminActor(
  userId: string,
  overrides?: Partial<ActorContext>
): ActorContext {
  return {
    type: 'admin',
    userId,
    requestId: testId('req'),
    permissions: ['tool:manage'],
    ...overrides,
  };
}

// Mock SubscriptionService for integration tests
function createMockSubscriptionService(): ToolServiceSubscription {
  return {
    hasEntitlement: async (): Promise<Result<boolean>> => ({
      success: true,
      data: true,
    }),
    getEntitlementValue: async (): Promise<Result<null>> => ({
      success: true,
      data: null,
    }),
    checkUsageLimit: async (): Promise<
      Result<{ allowed: boolean; reason?: string }>
    > => ({
      success: true,
      data: { allowed: true },
    }),
  };
}

describe.skipIf(!HAS_CREDENTIALS)('ToolService Integration', () => {
  let supabase: SupabaseClient;
  let toolService: ToolService;
  let auditService: AuditService;
  let userService: UserService;

  // Track created resources for cleanup
  const createdUserIds: string[] = [];
  const createdToolIds: string[] = [];
  const createdInvocationIds: string[] = [];

  beforeAll(async () => {
    // Create Supabase client with service key (bypasses RLS)
    supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);

    // Create database adapters and services
    const auditDb = createAuditServiceDb(supabase);
    auditService = createAuditService({ db: auditDb });

    const userDb = createUserServiceDb(supabase);
    userService = createUserService({ db: userDb, auditService });

    const toolDb = createToolServiceDb(supabase);
    const mockSubscriptionService = createMockSubscriptionService();
    toolService = createToolService({
      db: toolDb,
      auditService,
      subscriptionService: mockSubscriptionService,
    });
  });

  afterAll(async () => {
    // Cleanup in reverse order

    // Delete invocations
    if (createdInvocationIds.length > 0) {
      await supabase
        .from('tool_invocation_logs')
        .delete()
        .in('id', createdInvocationIds);
    }

    // Delete tools
    if (createdToolIds.length > 0) {
      await supabase.from('tool_registry').delete().in('id', createdToolIds);
    }

    // Delete test users
    if (createdUserIds.length > 0) {
      await supabase.from('users').delete().in('id', createdUserIds);
    }
  });

  // Helper to create a test user
  async function createTestUser(): Promise<string> {
    const userId = testId('user');
    const email = `${userId}@test.example.com`;
    await userService.onUserSignup(
      { type: 'system', requestId: testId('req'), permissions: ['*'] },
      {
        authUserId: userId,
        email,
      }
    );
    createdUserIds.push(userId);
    return userId;
  }

  // ─────────────────────────────────────────────────────────────
  // REGISTER TOOL
  // ─────────────────────────────────────────────────────────────

  describe('registerTool', () => {
    it('should register a new tool in database', async () => {
      const userId = await createTestUser();
      const actor = createAdminActor(userId);
      const toolName = testId('search');

      const result = await toolService.registerTool(actor, {
        name: toolName,
        description: 'Search the web',
        type: 'mcp',
        config: { endpoint: 'https://api.search.com' },
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
        },
        requiresPermission: 'tool:web_search',
        estimatedCost: { tokens: 100, latencyMs: 500 },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        createdToolIds.push(result.data.id);
        expect(result.data.name).toBe(toolName);
        expect(result.data.description).toBe('Search the web');
        expect(result.data.type).toBe('mcp');
        expect(result.data.status).toBe('active');
        expect(result.data.requiresPermission).toBe('tool:web_search');
      }
    });

    it('should register local tool type', async () => {
      const userId = await createTestUser();
      const actor = createAdminActor(userId);
      const toolName = testId('calculator');

      const result = await toolService.registerTool(actor, {
        name: toolName,
        description: 'Basic calculator',
        type: 'local',
        config: {},
        inputSchema: { type: 'object' },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        createdToolIds.push(result.data.id);
        expect(result.data.type).toBe('local');
      }
    });

    it('should register n8n tool type', async () => {
      const userId = await createTestUser();
      const actor = createAdminActor(userId);
      const toolName = testId('workflow');

      const result = await toolService.registerTool(actor, {
        name: toolName,
        description: 'N8N workflow runner',
        type: 'n8n',
        config: { workflowId: 'wf-123' },
        inputSchema: { type: 'object' },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        createdToolIds.push(result.data.id);
        expect(result.data.type).toBe('n8n');
      }
    });

    it('should return ALREADY_EXISTS for duplicate tool name', async () => {
      const userId = await createTestUser();
      const actor = createAdminActor(userId);
      const toolName = testId('dupe');

      // Create first tool
      const firstResult = await toolService.registerTool(actor, {
        name: toolName,
        description: 'First tool',
        type: 'local',
        config: {},
        inputSchema: { type: 'object' },
      });

      expect(firstResult.success).toBe(true);
      if (firstResult.success) {
        createdToolIds.push(firstResult.data.id);
      }

      // Try to create duplicate
      const dupeResult = await toolService.registerTool(actor, {
        name: toolName,
        description: 'Duplicate tool',
        type: 'local',
        config: {},
        inputSchema: { type: 'object' },
      });

      expect(dupeResult.success).toBe(false);
      if (!dupeResult.success) {
        expect(dupeResult.error.code).toBe('ALREADY_EXISTS');
      }
    });

    it('should deny user without tool:manage permission', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId); // No permissions

      const result = await toolService.registerTool(actor, {
        name: testId('denied'),
        description: 'Should fail',
        type: 'local',
        config: {},
        inputSchema: { type: 'object' },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should deny AI_ACTOR from registering tools', async () => {
      const result = await toolService.registerTool(AI_ACTOR, {
        name: testId('ai_tool'),
        description: 'Should fail',
        type: 'local',
        config: {},
        inputSchema: { type: 'object' },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // GET TOOL
  // ─────────────────────────────────────────────────────────────

  describe('getTool', () => {
    it('should get tool by ID', async () => {
      const userId = await createTestUser();
      const adminActor = createAdminActor(userId);
      const userActor = createTestActor(userId);
      const toolName = testId('gettool');

      // Create tool
      const createResult = await toolService.registerTool(adminActor, {
        name: toolName,
        description: 'Test tool',
        type: 'local',
        config: {},
        inputSchema: { type: 'object' },
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdToolIds.push(createResult.data.id);

      // Get tool (any user can get tools)
      const getResult = await toolService.getTool(
        userActor,
        createResult.data.id
      );

      expect(getResult.success).toBe(true);
      if (getResult.success) {
        expect(getResult.data.id).toBe(createResult.data.id);
        expect(getResult.data.name).toBe(toolName);
      }
    });

    it('should return NOT_FOUND for non-existent tool', async () => {
      const userId = await createTestUser();
      const actor = createTestActor(userId);
      const nonExistentId = crypto.randomUUID();

      const result = await toolService.getTool(actor, nonExistentId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // GET TOOL BY NAME
  // ─────────────────────────────────────────────────────────────

  describe('getToolByName', () => {
    it('should get tool by name', async () => {
      const userId = await createTestUser();
      const adminActor = createAdminActor(userId);
      const userActor = createTestActor(userId);
      const toolName = testId('byname');

      // Create tool
      const createResult = await toolService.registerTool(adminActor, {
        name: toolName,
        description: 'Test tool',
        type: 'local',
        config: {},
        inputSchema: { type: 'object' },
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdToolIds.push(createResult.data.id);

      // Get tool by name
      const getResult = await toolService.getToolByName(userActor, toolName);

      expect(getResult.success).toBe(true);
      if (getResult.success) {
        expect(getResult.data.name).toBe(toolName);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // LIST AVAILABLE TOOLS
  // ─────────────────────────────────────────────────────────────

  describe('listAvailableTools', () => {
    it('should list only active tools', async () => {
      const userId = await createTestUser();
      const adminActor = createAdminActor(userId);
      const userActor = createTestActor(userId);
      const toolName = testId('listactive');

      // Create an active tool
      const createResult = await toolService.registerTool(adminActor, {
        name: toolName,
        description: 'Active tool',
        type: 'local',
        config: {},
        inputSchema: { type: 'object' },
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdToolIds.push(createResult.data.id);

      // List tools
      const listResult = await toolService.listAvailableTools(userActor);

      expect(listResult.success).toBe(true);
      if (listResult.success) {
        // Should contain our tool
        const foundTool = listResult.data.find((t) => t.name === toolName);
        expect(foundTool).toBeDefined();
        expect(foundTool?.status).toBe('active');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // UPDATE TOOL
  // ─────────────────────────────────────────────────────────────

  describe('updateTool', () => {
    it('should update tool description', async () => {
      const userId = await createTestUser();
      const actor = createAdminActor(userId);
      const toolName = testId('update');

      // Create tool
      const createResult = await toolService.registerTool(actor, {
        name: toolName,
        description: 'Original description',
        type: 'local',
        config: {},
        inputSchema: { type: 'object' },
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdToolIds.push(createResult.data.id);

      // Update description
      const updateResult = await toolService.updateTool(
        actor,
        createResult.data.id,
        { description: 'Updated description' }
      );

      expect(updateResult.success).toBe(true);
      if (updateResult.success) {
        expect(updateResult.data.description).toBe('Updated description');
      }
    });

    it('should deny AI_ACTOR from updating tools', async () => {
      const userId = await createTestUser();
      const adminActor = createAdminActor(userId);
      const toolName = testId('aiupdate');

      // Create tool
      const createResult = await toolService.registerTool(adminActor, {
        name: toolName,
        description: 'Test tool',
        type: 'local',
        config: {},
        inputSchema: { type: 'object' },
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdToolIds.push(createResult.data.id);

      // Try to update as AI
      const updateResult = await toolService.updateTool(
        AI_ACTOR,
        createResult.data.id,
        { description: 'AI update' }
      );

      expect(updateResult.success).toBe(false);
      if (!updateResult.success) {
        expect(updateResult.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // DISABLE TOOL
  // ─────────────────────────────────────────────────────────────

  describe('disableTool', () => {
    it('should disable an active tool', async () => {
      const userId = await createTestUser();
      const actor = createAdminActor(userId);
      const toolName = testId('disable');

      // Create tool
      const createResult = await toolService.registerTool(actor, {
        name: toolName,
        description: 'To be disabled',
        type: 'local',
        config: {},
        inputSchema: { type: 'object' },
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdToolIds.push(createResult.data.id);

      // Disable tool
      const disableResult = await toolService.disableTool(
        actor,
        createResult.data.id,
        'No longer needed'
      );

      expect(disableResult.success).toBe(true);

      // Verify it's disabled
      const getResult = await toolService.getTool(actor, createResult.data.id);

      expect(getResult.success).toBe(true);
      if (getResult.success) {
        expect(getResult.data.status).toBe('disabled');
      }
    });

    it('should return INVALID_STATE for already disabled tool', async () => {
      const userId = await createTestUser();
      const actor = createAdminActor(userId);
      const toolName = testId('alreadydisabled');

      // Create and disable tool
      const createResult = await toolService.registerTool(actor, {
        name: toolName,
        description: 'To be disabled twice',
        type: 'local',
        config: {},
        inputSchema: { type: 'object' },
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdToolIds.push(createResult.data.id);

      await toolService.disableTool(
        actor,
        createResult.data.id,
        'First disable'
      );

      // Try to disable again
      const secondDisable = await toolService.disableTool(
        actor,
        createResult.data.id,
        'Second disable'
      );

      expect(secondDisable.success).toBe(false);
      if (!secondDisable.success) {
        expect(secondDisable.error.code).toBe('INVALID_STATE');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // CAN INVOKE TOOL
  // ─────────────────────────────────────────────────────────────

  describe('canInvokeTool', () => {
    it('should allow invocation for tool without permission requirement', async () => {
      const userId = await createTestUser();
      const adminActor = createAdminActor(userId);
      const userActor = createTestActor(userId);
      const toolName = testId('noperm');

      // Create tool without requiresPermission
      const createResult = await toolService.registerTool(adminActor, {
        name: toolName,
        description: 'No permission required',
        type: 'local',
        config: {},
        inputSchema: { type: 'object' },
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdToolIds.push(createResult.data.id);

      // Check if user can invoke
      const canInvoke = await toolService.canInvokeTool(userActor, toolName);

      expect(canInvoke.success).toBe(true);
      if (canInvoke.success) {
        expect(canInvoke.data.allowed).toBe(true);
      }
    });

    it('should deny invocation for disabled tool', async () => {
      const userId = await createTestUser();
      const adminActor = createAdminActor(userId);
      const userActor = createTestActor(userId);
      const toolName = testId('disabledinvoke');

      // Create and disable tool
      const createResult = await toolService.registerTool(adminActor, {
        name: toolName,
        description: 'To be disabled',
        type: 'local',
        config: {},
        inputSchema: { type: 'object' },
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdToolIds.push(createResult.data.id);

      await toolService.disableTool(
        adminActor,
        createResult.data.id,
        'Disabled for test'
      );

      // Check if user can invoke
      const canInvoke = await toolService.canInvokeTool(userActor, toolName);

      expect(canInvoke.success).toBe(true);
      if (canInvoke.success) {
        expect(canInvoke.data.allowed).toBe(false);
        expect(canInvoke.data.reason).toContain('disabled');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // INVOCATION LOGGING
  // ─────────────────────────────────────────────────────────────

  describe('logInvocationStart', () => {
    it('should log invocation start', async () => {
      const userId = await createTestUser();
      const adminActor = createAdminActor(userId);
      const userActor = createTestActor(userId);
      const toolName = testId('invstart');

      // Create tool
      const createResult = await toolService.registerTool(adminActor, {
        name: toolName,
        description: 'Invocation test',
        type: 'local',
        config: {},
        inputSchema: { type: 'object' },
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdToolIds.push(createResult.data.id);

      // Log invocation start
      const startResult = await toolService.logInvocationStart(userActor, {
        toolId: createResult.data.id,
        input: { query: 'test search' },
      });

      expect(startResult.success).toBe(true);
      if (startResult.success) {
        createdInvocationIds.push(startResult.data.invocationId);
        expect(startResult.data.invocationId).toBeDefined();
      }
    });

    it('should allow AI_ACTOR to log invocation', async () => {
      const userId = await createTestUser();
      const adminActor = createAdminActor(userId);
      const toolName = testId('ai_invoke');

      // Create tool
      const createResult = await toolService.registerTool(adminActor, {
        name: toolName,
        description: 'AI invocation test',
        type: 'local',
        config: {},
        inputSchema: { type: 'object' },
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdToolIds.push(createResult.data.id);

      // AI_ACTOR should be able to log invocations
      // Requires 'ai' user to exist in database (migration 010_system_actors.sql)
      const startResult = await toolService.logInvocationStart(AI_ACTOR, {
        toolId: createResult.data.id,
        input: { query: 'AI initiated search' },
      });

      expect(startResult.success).toBe(true);
      if (startResult.success) {
        createdInvocationIds.push(startResult.data.invocationId);
        expect(startResult.data.invocationId).toBeDefined();
      }
    });
  });

  describe('logInvocationComplete', () => {
    it('should log successful invocation completion', async () => {
      const userId = await createTestUser();
      const adminActor = createAdminActor(userId);
      const userActor = createTestActor(userId);
      const toolName = testId('invcomplete');

      // Create tool
      const createResult = await toolService.registerTool(adminActor, {
        name: toolName,
        description: 'Completion test',
        type: 'local',
        config: {},
        inputSchema: { type: 'object' },
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdToolIds.push(createResult.data.id);

      // Log invocation start
      const startResult = await toolService.logInvocationStart(userActor, {
        toolId: createResult.data.id,
        input: { query: 'test' },
      });

      expect(startResult.success).toBe(true);
      if (!startResult.success) {
        return;
      }
      createdInvocationIds.push(startResult.data.invocationId);

      // Complete invocation
      const completeResult = await toolService.logInvocationComplete(
        userActor,
        startResult.data.invocationId,
        {
          status: 'success',
          output: { results: ['result1', 'result2'] },
          actualCost: { tokens: 150, latencyMs: 1000 },
        }
      );

      expect(completeResult.success).toBe(true);
    });

    it('should log failed invocation', async () => {
      const userId = await createTestUser();
      const adminActor = createAdminActor(userId);
      const userActor = createTestActor(userId);
      const toolName = testId('invfail');

      // Create tool
      const createResult = await toolService.registerTool(adminActor, {
        name: toolName,
        description: 'Failure test',
        type: 'local',
        config: {},
        inputSchema: { type: 'object' },
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdToolIds.push(createResult.data.id);

      // Log invocation start
      const startResult = await toolService.logInvocationStart(userActor, {
        toolId: createResult.data.id,
        input: { query: 'test' },
      });

      expect(startResult.success).toBe(true);
      if (!startResult.success) {
        return;
      }
      createdInvocationIds.push(startResult.data.invocationId);

      // Complete with failure
      const completeResult = await toolService.logInvocationComplete(
        userActor,
        startResult.data.invocationId,
        {
          status: 'failure',
          errorMessage: 'Connection timeout',
        }
      );

      expect(completeResult.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // GET INVOCATION HISTORY
  // ─────────────────────────────────────────────────────────────

  describe('getInvocationHistory', () => {
    it('should list invocations for admin', async () => {
      const userId = await createTestUser();
      const adminActor = createAdminActor(userId);
      const toolName = testId('invhistory');

      // Create tool
      const createResult = await toolService.registerTool(adminActor, {
        name: toolName,
        description: 'History test',
        type: 'local',
        config: {},
        inputSchema: { type: 'object' },
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdToolIds.push(createResult.data.id);

      // Log an invocation
      const startResult = await toolService.logInvocationStart(adminActor, {
        toolId: createResult.data.id,
        input: { query: 'history test' },
      });

      expect(startResult.success).toBe(true);
      if (!startResult.success) {
        return;
      }
      createdInvocationIds.push(startResult.data.invocationId);

      // Get history
      const historyResult = await toolService.getInvocationHistory(adminActor, {
        limit: 20,
      });

      expect(historyResult.success).toBe(true);
      if (historyResult.success) {
        expect(historyResult.data.items.length).toBeGreaterThan(0);
      }
    });

    it('should restrict regular user to their own invocations', async () => {
      const userId1 = await createTestUser();
      const userId2 = await createTestUser();
      const adminActor = createAdminActor(userId1);
      const userActor1 = createTestActor(userId1);
      const userActor2 = createTestActor(userId2);
      const toolName = testId('restrict');

      // Create tool
      const createResult = await toolService.registerTool(adminActor, {
        name: toolName,
        description: 'Restriction test',
        type: 'local',
        config: {},
        inputSchema: { type: 'object' },
      });

      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdToolIds.push(createResult.data.id);

      // User1 logs an invocation
      const startResult = await toolService.logInvocationStart(userActor1, {
        toolId: createResult.data.id,
        input: { query: 'user1 query' },
      });

      expect(startResult.success).toBe(true);
      if (!startResult.success) {
        return;
      }
      createdInvocationIds.push(startResult.data.invocationId);

      // User2 tries to view user1's invocations
      const historyResult = await toolService.getInvocationHistory(userActor2, {
        userId: userId1,
        limit: 20,
      });

      expect(historyResult.success).toBe(false);
      if (!historyResult.success) {
        expect(historyResult.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });
});
