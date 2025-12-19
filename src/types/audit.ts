/**
 * Audit Types
 * Types for the AuditService
 *
 * Reference: docs/stage-2-service-layer.md Section 3.10
 */

import type { PaginationParams } from './pagination.js';

/**
 * Actor types for audit logging
 */
export type AuditActorType = 'user' | 'admin' | 'system' | 'ai';

/**
 * Event to be logged to the audit system
 * Used as input to AuditService.log()
 */
export interface AuditEvent {
  action: string; // e.g., 'knowledge:publish', 'role:assign'
  resourceType: string; // e.g., 'knowledge_item', 'user'
  resourceId?: string; // ID of affected resource
  details?: Record<string, unknown>; // Action-specific data
}

/**
 * Full audit log record (from database)
 */
export interface AuditLog {
  id: string;
  timestamp: Date;
  actorId: string | null; // NULL for system actions
  actorType: AuditActorType;
  action: string;
  resourceType: string;
  resourceId: string | null;
  details: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
}

/**
 * Parameters for querying audit logs
 */
export interface AuditQueryParams extends PaginationParams {
  actorId?: string;
  actorType?: AuditActorType;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  startDate?: Date;
  endDate?: Date;
}
