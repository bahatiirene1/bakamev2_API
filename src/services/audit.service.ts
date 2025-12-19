/**
 * AuditService Implementation
 * Phase 2: TDD - GREEN phase
 *
 * Reference: docs/stage-2-service-layer.md Section 3.10
 *
 * Purpose: Immutable audit logging.
 * Owns: audit_logs
 * Dependencies: None (lowest level service)
 */

import type {
  ActorContext,
  AuditEvent,
  AuditLog,
  AuditQueryParams,
  PaginatedResult,
  PaginationParams,
  Result,
} from '@/types/index.js';
import { success, failure, normalizePaginationParams } from '@/types/index.js';

/**
 * Database abstraction interface for AuditService
 * Allows mocking in tests
 */
export interface AuditServiceDb {
  insertLog: (params: {
    actorId: string | null;
    actorType: string;
    action: string;
    resourceType: string;
    resourceId: string | null;
    details: Record<string, unknown>;
    ipAddress: string | null;
    userAgent: string | null;
    requestId: string | null;
  }) => Promise<{ id: string }>;

  insertLogsBatch: (
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
  ) => Promise<{ count: number }>;

  queryLogs: (params: AuditQueryParams) => Promise<PaginatedResult<AuditLog>>;

  getLogsByResource: (
    resourceType: string,
    resourceId: string
  ) => Promise<AuditLog[]>;

  getLogsByActor: (
    actorId: string,
    params: PaginationParams
  ) => Promise<PaginatedResult<AuditLog>>;
}

/**
 * AuditService interface
 */
export interface AuditService {
  log(actor: ActorContext, event: AuditEvent): Promise<Result<void>>;
  logBatch(actor: ActorContext, events: AuditEvent[]): Promise<Result<void>>;
  queryLogs(
    actor: ActorContext,
    params: AuditQueryParams
  ): Promise<Result<PaginatedResult<AuditLog>>>;
  getResourceHistory(
    actor: ActorContext,
    resourceType: string,
    resourceId: string
  ): Promise<Result<AuditLog[]>>;
  getActorHistory(
    actor: ActorContext,
    targetActorId: string,
    params: PaginationParams
  ): Promise<Result<PaginatedResult<AuditLog>>>;
}

/**
 * Check if actor has wildcard permission (system actor)
 */
function hasWildcardPermission(actor: ActorContext): boolean {
  return actor.permissions.includes('*');
}

/**
 * Check if actor can read audit logs
 */
function canReadAuditLogs(actor: ActorContext): boolean {
  return (
    hasWildcardPermission(actor) || actor.permissions.includes('audit:read')
  );
}

/**
 * Build log entry from actor and event
 */
function buildLogEntry(
  actor: ActorContext,
  event: AuditEvent
): {
  actorId: string | null;
  actorType: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  details: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
} {
  return {
    actorId: actor.userId ?? null,
    actorType: actor.type,
    action: event.action,
    resourceType: event.resourceType,
    resourceId: event.resourceId ?? null,
    details: event.details ?? {},
    ipAddress: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
    requestId: actor.requestId ?? null,
  };
}

/**
 * Create AuditService instance
 */
export function createAuditService(deps: { db: AuditServiceDb }): AuditService {
  const { db } = deps;

  return {
    /**
     * Log an audit event
     * This is the ONLY way to write to audit_logs
     * No permission check - all services can log
     */
    async log(actor: ActorContext, event: AuditEvent): Promise<Result<void>> {
      try {
        const logEntry = buildLogEntry(actor, event);
        await db.insertLog(logEntry);
        return success(undefined);
      } catch {
        return failure('INTERNAL_ERROR', 'Failed to write audit log');
      }
    },

    /**
     * Log multiple events atomically
     * Used for batch operations
     */
    async logBatch(
      actor: ActorContext,
      events: AuditEvent[]
    ): Promise<Result<void>> {
      try {
        const logEntries = events.map((event) => buildLogEntry(actor, event));
        await db.insertLogsBatch(logEntries);
        return success(undefined);
      } catch {
        return failure('INTERNAL_ERROR', 'Failed to write batch audit logs');
      }
    },

    /**
     * Query audit logs
     * Requires: 'audit:read' permission
     */
    async queryLogs(
      actor: ActorContext,
      params: AuditQueryParams
    ): Promise<Result<PaginatedResult<AuditLog>>> {
      // Check permission
      if (!canReadAuditLogs(actor)) {
        return failure(
          'PERMISSION_DENIED',
          'Actor lacks audit:read permission'
        );
      }

      // Normalize pagination params
      const normalizedParams = {
        ...params,
        ...normalizePaginationParams(params),
      };

      const result = await db.queryLogs(normalizedParams);
      return success(result);
    },

    /**
     * Get audit logs for a specific resource
     * Requires: 'audit:read' permission
     */
    async getResourceHistory(
      actor: ActorContext,
      resourceType: string,
      resourceId: string
    ): Promise<Result<AuditLog[]>> {
      // Check permission
      if (!canReadAuditLogs(actor)) {
        return failure(
          'PERMISSION_DENIED',
          'Actor lacks audit:read permission'
        );
      }

      const logs = await db.getLogsByResource(resourceType, resourceId);
      return success(logs);
    },

    /**
     * Get audit logs for a specific actor
     * Requires: 'audit:read' permission
     */
    async getActorHistory(
      actor: ActorContext,
      targetActorId: string,
      params: PaginationParams
    ): Promise<Result<PaginatedResult<AuditLog>>> {
      // Check permission
      if (!canReadAuditLogs(actor)) {
        return failure(
          'PERMISSION_DENIED',
          'Actor lacks audit:read permission'
        );
      }

      // Normalize pagination params
      const normalizedParams = normalizePaginationParams(params);

      const result = await db.getLogsByActor(targetActorId, normalizedParams);
      return success(result);
    },
  };
}
