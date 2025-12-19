/**
 * ToolService Implementation
 * Phase 2: TDD - RED phase (stub only)
 *
 * Reference: docs/stage-2-service-layer.md Section 3.7
 *
 * SCOPE: Tool registry and invocation logging
 *
 * Owns: tool_registry, tool_invocation_logs
 *
 * GUARDRAILS:
 * - registerTool, updateTool, disableTool require 'tool:manage' permission
 * - canInvokeTool checks tool permission + subscription entitlements
 * - AI_ACTOR can invoke tools but not manage them
 * - SYSTEM_ACTOR can perform any operation
 * - Invocation logging records all tool executions for cost tracking
 *
 * Dependencies: AuditService, SubscriptionService
 */

import type {
  ActorContext,
  Tool,
  ToolDefinition,
  ToolUpdate,
  ToolInvocation,
  LogInvocationStartParams,
  InvocationStartResult,
  LogInvocationCompleteParams,
  ListInvocationsParams,
  CanInvokeResult,
  PaginationParams,
  PaginatedResult,
  Result,
  AuditEvent,
  EntitlementValue,
} from '@/types/index.js';
import { success, failure } from '@/types/index.js';

/**
 * Database abstraction interface for ToolService
 */
export interface ToolServiceDb {
  createTool: (params: ToolDefinition) => Promise<Tool>;
  getTool: (toolId: string) => Promise<Tool | null>;
  getToolByName: (name: string) => Promise<Tool | null>;
  listTools: (params: { status?: string }) => Promise<Tool[]>;
  updateTool: (toolId: string, updates: ToolUpdate) => Promise<Tool>;
  updateToolStatus: (
    toolId: string,
    status: 'active' | 'disabled' | 'deprecated'
  ) => Promise<Tool>;
  createInvocation: (params: {
    toolId: string;
    userId: string;
    chatId?: string;
    input: Record<string, unknown>;
    requestId?: string;
  }) => Promise<ToolInvocation>;
  getInvocation: (invocationId: string) => Promise<ToolInvocation | null>;
  completeInvocation: (
    invocationId: string,
    result: {
      status: 'success' | 'failure';
      output?: Record<string, unknown>;
      errorMessage?: string;
      durationMs: number;
      actualCost?: Record<string, unknown>;
    }
  ) => Promise<ToolInvocation>;
  listInvocations: (
    params: ListInvocationsParams & PaginationParams
  ) => Promise<PaginatedResult<ToolInvocation>>;
}

/**
 * Minimal AuditService interface
 */
export interface ToolServiceAudit {
  log: (actor: ActorContext, event: AuditEvent) => Promise<Result<void>>;
}

/**
 * Minimal SubscriptionService interface for entitlement checks
 */
export interface ToolServiceSubscription {
  hasEntitlement: (
    actor: ActorContext,
    userId: string,
    featureCode: string
  ) => Promise<Result<boolean>>;
  getEntitlementValue: (
    actor: ActorContext,
    userId: string,
    featureCode: string
  ) => Promise<Result<EntitlementValue | null>>;
  checkUsageLimit: (
    actor: ActorContext,
    userId: string,
    featureCode: string
  ) => Promise<Result<{ allowed: boolean; reason?: string }>>;
}

/**
 * ToolService interface
 */
export interface ToolService {
  // Tool Registry
  registerTool(
    actor: ActorContext,
    params: ToolDefinition
  ): Promise<Result<Tool>>;
  getTool(actor: ActorContext, toolId: string): Promise<Result<Tool>>;
  getToolByName(actor: ActorContext, name: string): Promise<Result<Tool>>;
  listAvailableTools(actor: ActorContext): Promise<Result<Tool[]>>;
  updateTool(
    actor: ActorContext,
    toolId: string,
    updates: ToolUpdate
  ): Promise<Result<Tool>>;
  disableTool(
    actor: ActorContext,
    toolId: string,
    reason: string
  ): Promise<Result<void>>;

  // Invocation Logging
  canInvokeTool(
    actor: ActorContext,
    toolName: string
  ): Promise<Result<CanInvokeResult>>;
  logInvocationStart(
    actor: ActorContext,
    params: LogInvocationStartParams
  ): Promise<Result<InvocationStartResult>>;
  logInvocationComplete(
    actor: ActorContext,
    invocationId: string,
    result: LogInvocationCompleteParams
  ): Promise<Result<void>>;
  getInvocationHistory(
    actor: ActorContext,
    params: ListInvocationsParams & PaginationParams
  ): Promise<Result<PaginatedResult<ToolInvocation>>>;
}

/**
 * Create ToolService instance
 */
export function createToolService(deps: {
  db: ToolServiceDb;
  auditService: ToolServiceAudit;
  subscriptionService: ToolServiceSubscription;
}): ToolService {
  const { db, auditService, subscriptionService } = deps;

  // ─────────────────────────────────────────────────────────────
  // HELPER FUNCTIONS
  // ─────────────────────────────────────────────────────────────

  function isSystemActor(actor: ActorContext): boolean {
    return actor.type === 'system';
  }

  function isAiActor(actor: ActorContext): boolean {
    return actor.type === 'ai';
  }

  function hasManagePermission(actor: ActorContext): boolean {
    if (isSystemActor(actor)) {
      return true;
    }
    const permissions = actor.permissions ?? [];
    return permissions.includes('tool:manage');
  }

  function hasPermission(actor: ActorContext, permission: string): boolean {
    if (isSystemActor(actor)) {
      return true;
    }
    const permissions = actor.permissions ?? [];
    return permissions.includes(permission);
  }

  function getActorUserId(actor: ActorContext): string {
    if (isSystemActor(actor)) {
      return 'system';
    }
    if (isAiActor(actor)) {
      return 'ai';
    }
    return actor.userId ?? 'unknown';
  }

  function getActorRequestId(actor: ActorContext): string | undefined {
    if (isSystemActor(actor) || isAiActor(actor)) {
      return undefined;
    }
    return actor.requestId;
  }

  // ─────────────────────────────────────────────────────────────
  // SERVICE IMPLEMENTATION
  // ─────────────────────────────────────────────────────────────

  return {
    // ─────────────────────────────────────────────────────────────
    // TOOL REGISTRY
    // ─────────────────────────────────────────────────────────────

    async registerTool(
      actor: ActorContext,
      params: ToolDefinition
    ): Promise<Result<Tool>> {
      // AI_ACTOR cannot register tools
      if (isAiActor(actor)) {
        return failure('PERMISSION_DENIED', 'AI cannot register tools');
      }

      // Must have tool:manage permission (unless SYSTEM_ACTOR)
      if (!hasManagePermission(actor)) {
        return failure(
          'PERMISSION_DENIED',
          'Requires tool:manage permission to register tools'
        );
      }

      // Check for duplicate name
      const existingTool = await db.getToolByName(params.name);
      if (existingTool !== null) {
        return failure(
          'ALREADY_EXISTS',
          `Tool with name '${params.name}' already exists`
        );
      }

      const tool = await db.createTool(params);

      await auditService.log(actor, {
        action: 'tool.registered',
        resourceType: 'tool',
        resourceId: tool.id,
        details: {
          name: tool.name,
          type: tool.type,
        },
      });

      return success(tool);
    },

    async getTool(_actor: ActorContext, toolId: string): Promise<Result<Tool>> {
      const tool = await db.getTool(toolId);

      if (tool === null) {
        return failure('NOT_FOUND', `Tool not found: ${toolId}`);
      }

      return success(tool);
    },

    async getToolByName(
      _actor: ActorContext,
      name: string
    ): Promise<Result<Tool>> {
      const tool = await db.getToolByName(name);

      if (tool === null) {
        return failure('NOT_FOUND', `Tool not found: ${name}`);
      }

      return success(tool);
    },

    async listAvailableTools(_actor: ActorContext): Promise<Result<Tool[]>> {
      const tools = await db.listTools({ status: 'active' });
      return success(tools);
    },

    async updateTool(
      actor: ActorContext,
      toolId: string,
      updates: ToolUpdate
    ): Promise<Result<Tool>> {
      // AI_ACTOR cannot update tools
      if (isAiActor(actor)) {
        return failure('PERMISSION_DENIED', 'AI cannot update tools');
      }

      // Must have tool:manage permission (unless SYSTEM_ACTOR)
      if (!hasManagePermission(actor)) {
        return failure(
          'PERMISSION_DENIED',
          'Requires tool:manage permission to update tools'
        );
      }

      // Check tool exists
      const existingTool = await db.getTool(toolId);
      if (existingTool === null) {
        return failure('NOT_FOUND', `Tool not found: ${toolId}`);
      }

      const updatedTool = await db.updateTool(toolId, updates);

      await auditService.log(actor, {
        action: 'tool.updated',
        resourceType: 'tool',
        resourceId: toolId,
        details: {
          updates: Object.keys(updates),
        },
      });

      return success(updatedTool);
    },

    async disableTool(
      actor: ActorContext,
      toolId: string,
      reason: string
    ): Promise<Result<void>> {
      // AI_ACTOR cannot disable tools
      if (isAiActor(actor)) {
        return failure('PERMISSION_DENIED', 'AI cannot disable tools');
      }

      // Must have tool:manage permission (unless SYSTEM_ACTOR)
      if (!hasManagePermission(actor)) {
        return failure(
          'PERMISSION_DENIED',
          'Requires tool:manage permission to disable tools'
        );
      }

      // Check tool exists
      const existingTool = await db.getTool(toolId);
      if (existingTool === null) {
        return failure('NOT_FOUND', `Tool not found: ${toolId}`);
      }

      // Check tool is not already disabled
      if (existingTool.status === 'disabled') {
        return failure('INVALID_STATE', 'Tool is already disabled');
      }

      await db.updateToolStatus(toolId, 'disabled');

      await auditService.log(actor, {
        action: 'tool.disabled',
        resourceType: 'tool',
        resourceId: toolId,
        details: {
          reason,
        },
      });

      return success(undefined);
    },

    // ─────────────────────────────────────────────────────────────
    // INVOCATION LOGGING
    // ─────────────────────────────────────────────────────────────

    async canInvokeTool(
      actor: ActorContext,
      toolName: string
    ): Promise<Result<CanInvokeResult>> {
      // Get the tool
      const tool = await db.getToolByName(toolName);
      if (tool === null) {
        return failure('NOT_FOUND', `Tool not found: ${toolName}`);
      }

      // SYSTEM_ACTOR can invoke any tool
      if (isSystemActor(actor)) {
        return success({ allowed: true });
      }

      // Check if tool is disabled
      if (tool.status === 'disabled') {
        return success({
          allowed: false,
          reason: 'Tool is disabled',
        });
      }

      // Check if tool requires permission
      if (tool.requiresPermission !== null) {
        if (!hasPermission(actor, tool.requiresPermission)) {
          return success({
            allowed: false,
            reason: `Missing required permission: ${tool.requiresPermission}`,
          });
        }
      }

      // Check subscription usage limits (for non-AI actors with userId)
      const userId = getActorUserId(actor);
      if (userId !== 'system' && userId !== 'ai' && userId !== 'unknown') {
        const usageLimitResult = await subscriptionService.checkUsageLimit(
          actor,
          userId,
          `tool:${toolName}`
        );

        if (usageLimitResult.success && !usageLimitResult.data.allowed) {
          return success({
            allowed: false,
            reason: usageLimitResult.data.reason ?? 'Usage limit exceeded',
          });
        }
      }

      return success({ allowed: true });
    },

    async logInvocationStart(
      actor: ActorContext,
      params: LogInvocationStartParams
    ): Promise<Result<InvocationStartResult>> {
      // Check tool exists
      const tool = await db.getTool(params.toolId);
      if (tool === null) {
        return failure('NOT_FOUND', `Tool not found: ${params.toolId}`);
      }

      const userId = getActorUserId(actor);
      const requestId = getActorRequestId(actor);

      const invocationParams: Parameters<typeof db.createInvocation>[0] = {
        toolId: params.toolId,
        userId,
        input: params.input,
      };
      if (params.chatId !== undefined) {
        invocationParams.chatId = params.chatId;
      }
      if (requestId !== undefined) {
        invocationParams.requestId = requestId;
      }

      const invocation = await db.createInvocation(invocationParams);

      return success({ invocationId: invocation.id });
    },

    async logInvocationComplete(
      actor: ActorContext,
      invocationId: string,
      result: LogInvocationCompleteParams
    ): Promise<Result<void>> {
      // Get the invocation
      const invocation = await db.getInvocation(invocationId);
      if (invocation === null) {
        return failure('NOT_FOUND', `Invocation not found: ${invocationId}`);
      }

      // Check invocation is not already completed
      if (invocation.status !== 'pending') {
        return failure(
          'INVALID_STATE',
          `Invocation is already ${invocation.status}`
        );
      }

      // Check actor owns the invocation (unless SYSTEM_ACTOR)
      if (!isSystemActor(actor)) {
        const actorUserId = getActorUserId(actor);
        if (invocation.userId !== actorUserId) {
          return failure(
            'PERMISSION_DENIED',
            'Cannot complete invocation owned by another user'
          );
        }
      }

      // Calculate duration
      const now = new Date();
      const durationMs = now.getTime() - invocation.startedAt.getTime();

      const completeParams: Parameters<typeof db.completeInvocation>[1] = {
        status: result.status,
        durationMs,
      };
      if (result.output !== undefined) {
        completeParams.output = result.output;
      }
      if (result.errorMessage !== undefined) {
        completeParams.errorMessage = result.errorMessage;
      }
      if (result.actualCost !== undefined) {
        completeParams.actualCost = result.actualCost as unknown as Record<
          string,
          unknown
        >;
      }

      await db.completeInvocation(invocationId, completeParams);

      return success(undefined);
    },

    async getInvocationHistory(
      actor: ActorContext,
      params: ListInvocationsParams & PaginationParams
    ): Promise<Result<PaginatedResult<ToolInvocation>>> {
      // SYSTEM_ACTOR can view all invocations
      if (isSystemActor(actor)) {
        const result = await db.listInvocations(params);
        return success(result);
      }

      // Admins with tool:manage can view all invocations
      if (hasManagePermission(actor)) {
        const result = await db.listInvocations(params);
        return success(result);
      }

      // Regular users can only view their own invocations
      const actorUserId = getActorUserId(actor);

      // If user is trying to filter by a different userId, deny
      if (params.userId !== undefined && params.userId !== actorUserId) {
        return failure(
          'PERMISSION_DENIED',
          'Cannot view invocations for other users'
        );
      }

      // Force userId filter to actor's userId
      const restrictedParams = {
        ...params,
        userId: actorUserId,
      };

      const result = await db.listInvocations(restrictedParams);
      return success(result);
    },
  };
}
