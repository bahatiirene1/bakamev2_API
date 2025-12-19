/**
 * AuditService Database Adapter
 * Implements AuditServiceDb interface using Supabase
 *
 * Reference: docs/stage-1-database-governance.md Section 2.3
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  AuditLog,
  AuditQueryParams,
  PaginatedResult,
  PaginationParams,
} from '@/types/index.js';

import type { AuditServiceDb } from './audit.service.js';

/**
 * Database row type (from Stage 1 schema)
 */
interface AuditLogRow {
  id: string;
  timestamp: string;
  actor_id: string | null;
  actor_type: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  details: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  request_id: string | null;
}

/**
 * Map database row to AuditLog entity
 */
function mapRowToAuditLog(row: AuditLogRow): AuditLog {
  return {
    id: row.id,
    timestamp: new Date(row.timestamp),
    actorId: row.actor_id,
    actorType: row.actor_type as AuditLog['actorType'],
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    details: row.details,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    requestId: row.request_id,
  };
}

/**
 * Create AuditServiceDb implementation using Supabase
 */
export function createAuditServiceDb(supabase: SupabaseClient): AuditServiceDb {
  return {
    /**
     * Insert a single audit log
     */
    async insertLog(params: {
      actorId: string | null;
      actorType: string;
      action: string;
      resourceType: string;
      resourceId: string | null;
      details: Record<string, unknown>;
      ipAddress: string | null;
      userAgent: string | null;
      requestId: string | null;
    }): Promise<{ id: string }> {
      const { data, error } = await supabase
        .from('audit_logs')
        .insert({
          actor_id: params.actorId,
          actor_type: params.actorType,
          action: params.action,
          resource_type: params.resourceType,
          resource_id: params.resourceId,
          details: params.details,
          ip_address: params.ipAddress,
          user_agent: params.userAgent,
          request_id: params.requestId,
        })
        .select('id')
        .single();

      if (error !== null) {
        throw new Error(`Failed to insert audit log: ${error.message}`);
      }

      return { id: data.id as string };
    },

    /**
     * Insert multiple audit logs atomically
     */
    async insertLogsBatch(
      logs: Array<{
        actorId: string | null;
        actorType: string;
        action: string;
        resourceType: string;
        resourceId: string | null;
        details: Record<string, unknown>;
        ipAddress: string | null;
        userAgent: string | null;
        requestId: string | null;
      }>
    ): Promise<{ count: number }> {
      if (logs.length === 0) {
        return { count: 0 };
      }

      const insertData = logs.map((log) => ({
        actor_id: log.actorId,
        actor_type: log.actorType,
        action: log.action,
        resource_type: log.resourceType,
        resource_id: log.resourceId,
        details: log.details,
        ip_address: log.ipAddress,
        user_agent: log.userAgent,
        request_id: log.requestId,
      }));

      const { error, count } = await supabase
        .from('audit_logs')
        .insert(insertData, { count: 'exact' });

      if (error !== null) {
        throw new Error(`Failed to insert batch audit logs: ${error.message}`);
      }

      return { count: count ?? logs.length };
    },

    /**
     * Query audit logs with filters
     */
    async queryLogs(
      params: AuditQueryParams
    ): Promise<PaginatedResult<AuditLog>> {
      let query = supabase
        .from('audit_logs')
        .select('*', { count: 'exact' })
        .order('timestamp', { ascending: false });

      // Apply filters
      if (params.actorId !== undefined) {
        query = query.eq('actor_id', params.actorId);
      }
      if (params.actorType !== undefined) {
        query = query.eq('actor_type', params.actorType);
      }
      if (params.action !== undefined) {
        query = query.eq('action', params.action);
      }
      if (params.resourceType !== undefined) {
        query = query.eq('resource_type', params.resourceType);
      }
      if (params.resourceId !== undefined) {
        query = query.eq('resource_id', params.resourceId);
      }
      if (params.startDate !== undefined) {
        query = query.gte('timestamp', params.startDate.toISOString());
      }
      if (params.endDate !== undefined) {
        query = query.lte('timestamp', params.endDate.toISOString());
      }

      // Apply cursor-based pagination
      if (params.cursor !== undefined) {
        // Cursor is the timestamp of the last item
        query = query.lt('timestamp', params.cursor);
      }

      // Fetch one more than limit to determine hasMore
      const limit = params.limit;
      query = query.limit(limit + 1);

      const { data, error } = await query;

      if (error !== null) {
        throw new Error(`Failed to query audit logs: ${error.message}`);
      }

      const rows = (data ?? []) as AuditLogRow[];
      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit).map(mapRowToAuditLog);

      const result: PaginatedResult<AuditLog> = { items, hasMore };
      const lastItem = items[items.length - 1];
      if (hasMore && lastItem !== undefined) {
        result.nextCursor = lastItem.timestamp.toISOString();
      }
      return result;
    },

    /**
     * Get audit logs for a specific resource
     */
    async getLogsByResource(
      resourceType: string,
      resourceId: string
    ): Promise<AuditLog[]> {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
        .eq('resource_type', resourceType)
        .eq('resource_id', resourceId)
        .order('timestamp', { ascending: false });

      if (error !== null) {
        throw new Error(`Failed to get logs by resource: ${error.message}`);
      }

      return ((data ?? []) as AuditLogRow[]).map(mapRowToAuditLog);
    },

    /**
     * Get audit logs for a specific actor
     */
    async getLogsByActor(
      actorId: string,
      params: PaginationParams
    ): Promise<PaginatedResult<AuditLog>> {
      let query = supabase
        .from('audit_logs')
        .select('*', { count: 'exact' })
        .eq('actor_id', actorId)
        .order('timestamp', { ascending: false });

      // Apply cursor-based pagination
      if (params.cursor !== undefined) {
        query = query.lt('timestamp', params.cursor);
      }

      // Fetch one more than limit to determine hasMore
      const limit = params.limit;
      query = query.limit(limit + 1);

      const { data, error } = await query;

      if (error !== null) {
        throw new Error(`Failed to get logs by actor: ${error.message}`);
      }

      const rows = (data ?? []) as AuditLogRow[];
      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit).map(mapRowToAuditLog);

      const result: PaginatedResult<AuditLog> = { items, hasMore };
      const lastItem = items[items.length - 1];
      if (hasMore && lastItem !== undefined) {
        result.nextCursor = lastItem.timestamp.toISOString();
      }
      return result;
    },
  };
}
