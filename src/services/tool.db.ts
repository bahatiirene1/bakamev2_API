/**
 * ToolService Database Adapter
 * Implements ToolServiceDb interface using Supabase
 *
 * Reference: docs/stage-2-service-layer.md Section 3.7
 *
 * SCOPE: Tool registry and invocation logging
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  Tool,
  ToolDefinition,
  ToolUpdate,
  ToolInvocation,
  ToolType,
  ToolStatus,
  InvocationStatus,
  ToolCost,
  ListInvocationsParams,
  PaginationParams,
  PaginatedResult,
} from '@/types/index.js';

import type { ToolServiceDb } from './tool.service.js';

/**
 * Database row type for tool_registry
 */
interface ToolRow {
  id: string;
  name: string;
  description: string;
  type: string;
  config: Record<string, unknown>;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown> | null;
  status: string;
  requires_permission: string | null;
  estimated_cost: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

/**
 * Database row type for tool_invocation_logs
 */
interface InvocationRow {
  id: string;
  tool_id: string;
  tool_name: string;
  chat_id: string | null;
  user_id: string;
  request_id: string | null;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  status: string;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  actual_cost: Record<string, unknown> | null;
}

/**
 * Map database row to Tool entity
 */
function mapRowToTool(row: ToolRow): Tool {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as ToolType,
    config: row.config,
    inputSchema: row.input_schema,
    outputSchema: row.output_schema,
    status: row.status as ToolStatus,
    requiresPermission: row.requires_permission,
    estimatedCost: row.estimated_cost as ToolCost | null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Map database row to ToolInvocation entity
 */
function mapRowToInvocation(row: InvocationRow): ToolInvocation {
  return {
    id: row.id,
    toolId: row.tool_id,
    toolName: row.tool_name,
    chatId: row.chat_id,
    userId: row.user_id,
    requestId: row.request_id,
    input: row.input,
    output: row.output,
    status: row.status as InvocationStatus,
    errorMessage: row.error_message,
    startedAt: new Date(row.started_at),
    completedAt: row.completed_at !== null ? new Date(row.completed_at) : null,
    durationMs: row.duration_ms,
    actualCost: row.actual_cost as ToolCost | null,
  };
}

/**
 * Create ToolServiceDb implementation using Supabase
 */
export function createToolServiceDb(supabase: SupabaseClient): ToolServiceDb {
  return {
    /**
     * Create a new tool
     */
    async createTool(params: ToolDefinition): Promise<Tool> {
      const insertData: Record<string, unknown> = {
        name: params.name,
        description: params.description,
        type: params.type,
        config: params.config,
        input_schema: params.inputSchema,
        status: 'active',
      };

      if (params.outputSchema !== undefined) {
        insertData.output_schema = params.outputSchema;
      }
      if (params.requiresPermission !== undefined) {
        insertData.requires_permission = params.requiresPermission;
      }
      if (params.estimatedCost !== undefined) {
        insertData.estimated_cost = params.estimatedCost;
      }

      const { data, error } = await supabase
        .from('tool_registry')
        .insert(insertData)
        .select('*')
        .single();

      if (error !== null) {
        throw new Error(`Failed to create tool: ${error.message}`);
      }

      return mapRowToTool(data as ToolRow);
    },

    /**
     * Get tool by ID
     */
    async getTool(toolId: string): Promise<Tool | null> {
      const { data, error } = await supabase
        .from('tool_registry')
        .select('*')
        .eq('id', toolId)
        .single();

      if (error !== null) {
        if (error.code === 'PGRST116') {
          return null; // Not found
        }
        throw new Error(`Failed to get tool: ${error.message}`);
      }

      return mapRowToTool(data as ToolRow);
    },

    /**
     * Get tool by name
     */
    async getToolByName(name: string): Promise<Tool | null> {
      const { data, error } = await supabase
        .from('tool_registry')
        .select('*')
        .eq('name', name)
        .single();

      if (error !== null) {
        if (error.code === 'PGRST116') {
          return null; // Not found
        }
        throw new Error(`Failed to get tool by name: ${error.message}`);
      }

      return mapRowToTool(data as ToolRow);
    },

    /**
     * List tools by status
     */
    async listTools(params: { status?: string }): Promise<Tool[]> {
      let query = supabase.from('tool_registry').select('*');

      if (params.status !== undefined) {
        query = query.eq('status', params.status);
      }

      query = query.order('name', { ascending: true });

      const { data, error } = await query;

      if (error !== null) {
        throw new Error(`Failed to list tools: ${error.message}`);
      }

      return (data as ToolRow[]).map(mapRowToTool);
    },

    /**
     * Update tool
     */
    async updateTool(toolId: string, updates: ToolUpdate): Promise<Tool> {
      const updateData: Record<string, unknown> = {};

      if (updates.description !== undefined) {
        updateData.description = updates.description;
      }
      if (updates.config !== undefined) {
        updateData.config = updates.config;
      }
      if (updates.inputSchema !== undefined) {
        updateData.input_schema = updates.inputSchema;
      }
      if (updates.outputSchema !== undefined) {
        updateData.output_schema = updates.outputSchema;
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'requiresPermission')) {
        updateData.requires_permission = updates.requiresPermission;
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'estimatedCost')) {
        updateData.estimated_cost = updates.estimatedCost;
      }

      const { data, error } = await supabase
        .from('tool_registry')
        .update(updateData)
        .eq('id', toolId)
        .select('*')
        .single();

      if (error !== null) {
        throw new Error(`Failed to update tool: ${error.message}`);
      }

      return mapRowToTool(data as ToolRow);
    },

    /**
     * Update tool status
     */
    async updateToolStatus(
      toolId: string,
      status: 'active' | 'disabled' | 'deprecated'
    ): Promise<Tool> {
      const { data, error } = await supabase
        .from('tool_registry')
        .update({ status })
        .eq('id', toolId)
        .select('*')
        .single();

      if (error !== null) {
        throw new Error(`Failed to update tool status: ${error.message}`);
      }

      return mapRowToTool(data as ToolRow);
    },

    /**
     * Create invocation log
     */
    async createInvocation(params: {
      toolId: string;
      userId: string;
      chatId?: string;
      input: Record<string, unknown>;
      requestId?: string;
    }): Promise<ToolInvocation> {
      // First get the tool name
      const { data: toolData, error: toolError } = await supabase
        .from('tool_registry')
        .select('name')
        .eq('id', params.toolId)
        .single();

      if (toolError !== null) {
        throw new Error(
          `Failed to get tool for invocation: ${toolError.message}`
        );
      }

      const insertData: Record<string, unknown> = {
        tool_id: params.toolId,
        tool_name: (toolData as { name: string }).name,
        user_id: params.userId,
        input: params.input,
        status: 'pending',
      };

      if (params.chatId !== undefined) {
        insertData.chat_id = params.chatId;
      }
      if (params.requestId !== undefined) {
        insertData.request_id = params.requestId;
      }

      const { data, error } = await supabase
        .from('tool_invocation_logs')
        .insert(insertData)
        .select('*')
        .single();

      if (error !== null) {
        throw new Error(`Failed to create invocation: ${error.message}`);
      }

      return mapRowToInvocation(data as InvocationRow);
    },

    /**
     * Get invocation by ID
     */
    async getInvocation(invocationId: string): Promise<ToolInvocation | null> {
      const { data, error } = await supabase
        .from('tool_invocation_logs')
        .select('*')
        .eq('id', invocationId)
        .single();

      if (error !== null) {
        if (error.code === 'PGRST116') {
          return null; // Not found
        }
        throw new Error(`Failed to get invocation: ${error.message}`);
      }

      return mapRowToInvocation(data as InvocationRow);
    },

    /**
     * Complete invocation
     */
    async completeInvocation(
      invocationId: string,
      result: {
        status: 'success' | 'failure';
        output?: Record<string, unknown>;
        errorMessage?: string;
        durationMs: number;
        actualCost?: Record<string, unknown>;
      }
    ): Promise<ToolInvocation> {
      const updateData: Record<string, unknown> = {
        status: result.status,
        completed_at: new Date().toISOString(),
        duration_ms: result.durationMs,
      };

      if (result.output !== undefined) {
        updateData.output = result.output;
      }
      if (result.errorMessage !== undefined) {
        updateData.error_message = result.errorMessage;
      }
      if (result.actualCost !== undefined) {
        updateData.actual_cost = result.actualCost;
      }

      const { data, error } = await supabase
        .from('tool_invocation_logs')
        .update(updateData)
        .eq('id', invocationId)
        .select('*')
        .single();

      if (error !== null) {
        throw new Error(`Failed to complete invocation: ${error.message}`);
      }

      return mapRowToInvocation(data as InvocationRow);
    },

    /**
     * List invocations with pagination
     */
    async listInvocations(
      params: ListInvocationsParams & PaginationParams
    ): Promise<PaginatedResult<ToolInvocation>> {
      let query = supabase
        .from('tool_invocation_logs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(params.limit);

      if (params.userId !== undefined) {
        query = query.eq('user_id', params.userId);
      }
      if (params.toolId !== undefined) {
        query = query.eq('tool_id', params.toolId);
      }
      if (params.status !== undefined) {
        query = query.eq('status', params.status);
      }
      if (params.cursor !== undefined) {
        query = query.lt('started_at', params.cursor);
      }

      const { data, error } = await query;

      if (error !== null) {
        throw new Error(`Failed to list invocations: ${error.message}`);
      }

      const rows = data as InvocationRow[];
      const items = rows.map(mapRowToInvocation);
      const hasMore = items.length === params.limit;

      const result: PaginatedResult<ToolInvocation> = {
        items,
        hasMore,
      };

      const lastItem = rows[rows.length - 1];
      if (hasMore && lastItem !== undefined) {
        result.nextCursor = lastItem.started_at;
      }

      return result;
    },
  };
}
