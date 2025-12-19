/**
 * ApprovalService Implementation
 * Phase 2: TDD - GREEN phase
 *
 * Reference: docs/stage-2-service-layer.md Section 3.11
 *
 * SCOPE: Governance approval workflow management
 *
 * Owns: approval_requests table
 *
 * GUARDRAILS:
 * - Any user can create approval requests (for resources they own)
 * - Listing pending requires 'knowledge:review' or 'prompt:review' permission
 * - Approve/Reject requires appropriate review permission
 * - Cancel requires requester to be the actor
 * - AI_ACTOR cannot approve/reject (governance is human-only)
 * - SYSTEM_ACTOR can perform any action
 *
 * Dependencies: AuditService
 */

import type {
  ActorContext,
  ApprovalRequest,
  ApprovalStatus,
  CreateApprovalRequestParams,
  ListPendingRequestsParams,
  Result,
  AuditEvent,
} from '@/types/index.js';
import { success, failure } from '@/types/index.js';

/**
 * Paginated result for listing requests
 */
export interface PaginatedApprovalRequests {
  items: ApprovalRequest[];
  nextCursor?: string;
  hasMore: boolean;
}

/**
 * Parameters for listing pending requests with pagination
 */
export interface ListPendingParams extends ListPendingRequestsParams {
  limit: number;
  cursor?: string;
}

/**
 * Database abstraction interface for ApprovalService
 */
export interface ApprovalServiceDb {
  createRequest: (
    requesterId: string,
    params: CreateApprovalRequestParams
  ) => Promise<ApprovalRequest>;
  getRequest: (requestId: string) => Promise<ApprovalRequest | null>;
  listPendingRequests: (params: {
    limit: number;
    cursor?: string;
    resourceType?: string;
    status?: string;
  }) => Promise<PaginatedApprovalRequests>;
  updateRequestStatus: (
    requestId: string,
    status: ApprovalStatus,
    reviewerId: string | null,
    notes?: string
  ) => Promise<ApprovalRequest>;
}

/**
 * Minimal AuditService interface
 */
export interface ApprovalServiceAudit {
  log: (actor: ActorContext, event: AuditEvent) => Promise<Result<void>>;
}

/**
 * ApprovalService interface
 */
export interface ApprovalService {
  createRequest(
    actor: ActorContext,
    params: CreateApprovalRequestParams
  ): Promise<Result<ApprovalRequest>>;
  getRequest(
    actor: ActorContext,
    requestId: string
  ): Promise<Result<ApprovalRequest>>;
  listPendingRequests(
    actor: ActorContext,
    params: ListPendingParams
  ): Promise<Result<PaginatedApprovalRequests>>;
  approve(
    actor: ActorContext,
    requestId: string,
    notes?: string
  ): Promise<Result<void>>;
  reject(
    actor: ActorContext,
    requestId: string,
    notes: string
  ): Promise<Result<void>>;
  cancel(actor: ActorContext, requestId: string): Promise<Result<void>>;
}

/**
 * Create ApprovalService instance
 */
export function createApprovalService(deps: {
  db: ApprovalServiceDb;
  auditService: ApprovalServiceAudit;
}): ApprovalService {
  const { db, auditService } = deps;

  // ─────────────────────────────────────────────────────────────
  // HELPER FUNCTIONS
  // ─────────────────────────────────────────────────────────────

  function isSystemActor(actor: ActorContext): boolean {
    return actor.type === 'system';
  }

  function isAiActor(actor: ActorContext): boolean {
    return actor.type === 'ai';
  }

  function hasReviewPermission(actor: ActorContext): boolean {
    if (isSystemActor(actor)) {
      return true;
    }
    const permissions = actor.permissions ?? [];
    // Allow if user has specific review permissions OR wildcard/admin permissions
    return (
      permissions.includes('knowledge:review') ||
      permissions.includes('prompt:review') ||
      permissions.includes('*') ||
      permissions.some((p) => p.startsWith('admin:'))
    );
  }

  function canAccessRequest(
    actor: ActorContext,
    request: ApprovalRequest
  ): boolean {
    if (isSystemActor(actor)) {
      return true;
    }
    if (hasReviewPermission(actor)) {
      return true;
    }
    // Requester can always access their own request
    return actor.userId === request.requesterId;
  }

  function getActorUserIdRequired(actor: ActorContext): string {
    // For operations that require a real user ID (like creating a request)
    if (isSystemActor(actor)) {
      return 'system'; // System creates on behalf of system
    }
    return actor.userId ?? 'unknown';
  }

  function getActorUserIdForReview(actor: ActorContext): string | null {
    // For review operations where system actor should leave reviewer_id as null
    if (isSystemActor(actor)) {
      return null; // FK constraint requires null or valid user
    }
    return actor.userId ?? null;
  }

  // ─────────────────────────────────────────────────────────────
  // SERVICE IMPLEMENTATION
  // ─────────────────────────────────────────────────────────────

  return {
    async createRequest(
      actor: ActorContext,
      params: CreateApprovalRequestParams
    ): Promise<Result<ApprovalRequest>> {
      // AI_ACTOR cannot create requests (governance is human-only)
      if (isAiActor(actor)) {
        return failure(
          'PERMISSION_DENIED',
          'AI cannot create approval requests'
        );
      }

      const requesterId = getActorUserIdRequired(actor);
      const request = await db.createRequest(requesterId, params);

      await auditService.log(actor, {
        action: 'approval.request_created',
        resourceType: 'approval_request',
        resourceId: request.id,
        details: {
          targetResourceType: params.resourceType,
          targetResourceId: params.resourceId,
          requestedAction: params.action,
        },
      });

      return success(request);
    },

    async getRequest(
      actor: ActorContext,
      requestId: string
    ): Promise<Result<ApprovalRequest>> {
      const request = await db.getRequest(requestId);

      if (request === null) {
        return failure('NOT_FOUND', `Approval request not found: ${requestId}`);
      }

      if (!canAccessRequest(actor, request)) {
        return failure(
          'PERMISSION_DENIED',
          'Cannot access this approval request'
        );
      }

      return success(request);
    },

    async listPendingRequests(
      actor: ActorContext,
      params: ListPendingParams
    ): Promise<Result<PaginatedApprovalRequests>> {
      // Only reviewers and SYSTEM_ACTOR can list pending requests
      if (!hasReviewPermission(actor)) {
        return failure(
          'PERMISSION_DENIED',
          'Requires review permission to list pending requests'
        );
      }

      const dbParams: Parameters<typeof db.listPendingRequests>[0] = {
        limit: params.limit,
      };
      if (params.cursor !== undefined) {
        dbParams.cursor = params.cursor;
      }
      if (params.resourceType !== undefined) {
        dbParams.resourceType = params.resourceType;
      }
      if (params.status !== undefined) {
        dbParams.status = params.status;
      }
      const result = await db.listPendingRequests(dbParams);

      return success(result);
    },

    async approve(
      actor: ActorContext,
      requestId: string,
      notes?: string
    ): Promise<Result<void>> {
      // AI_ACTOR cannot approve (governance is human-only)
      if (isAiActor(actor)) {
        return failure('PERMISSION_DENIED', 'AI cannot approve requests');
      }

      // Must have review permission (unless SYSTEM_ACTOR)
      if (!hasReviewPermission(actor)) {
        return failure(
          'PERMISSION_DENIED',
          'Requires review permission to approve requests'
        );
      }

      const request = await db.getRequest(requestId);

      if (request === null) {
        return failure('NOT_FOUND', `Approval request not found: ${requestId}`);
      }

      // Check state - can only approve pending requests
      if (request.status !== 'pending') {
        return failure(
          'INVALID_STATE',
          `Cannot approve request in ${request.status} state`
        );
      }

      // Prevent self-approval (requester cannot approve their own request)
      // SYSTEM_ACTOR is exempt from this rule
      if (!isSystemActor(actor) && actor.userId === request.requesterId) {
        return failure('PERMISSION_DENIED', 'Cannot approve your own request');
      }

      const reviewerId = getActorUserIdForReview(actor);
      await db.updateRequestStatus(requestId, 'approved', reviewerId, notes);

      await auditService.log(actor, {
        action: 'approval.approved',
        resourceType: 'approval_request',
        resourceId: requestId,
        details: {
          targetResourceType: request.resourceType,
          targetResourceId: request.resourceId,
          requestedAction: request.action,
          notes,
        },
      });

      return success(undefined);
    },

    async reject(
      actor: ActorContext,
      requestId: string,
      notes: string
    ): Promise<Result<void>> {
      // AI_ACTOR cannot reject (governance is human-only)
      if (isAiActor(actor)) {
        return failure('PERMISSION_DENIED', 'AI cannot reject requests');
      }

      // Must have review permission (unless SYSTEM_ACTOR)
      if (!hasReviewPermission(actor)) {
        return failure(
          'PERMISSION_DENIED',
          'Requires review permission to reject requests'
        );
      }

      const request = await db.getRequest(requestId);

      if (request === null) {
        return failure('NOT_FOUND', `Approval request not found: ${requestId}`);
      }

      // Check state - can only reject pending requests
      if (request.status !== 'pending') {
        return failure(
          'INVALID_STATE',
          `Cannot reject request in ${request.status} state`
        );
      }

      const reviewerId = getActorUserIdForReview(actor);
      await db.updateRequestStatus(requestId, 'rejected', reviewerId, notes);

      await auditService.log(actor, {
        action: 'approval.rejected',
        resourceType: 'approval_request',
        resourceId: requestId,
        details: {
          targetResourceType: request.resourceType,
          targetResourceId: request.resourceId,
          requestedAction: request.action,
          notes,
        },
      });

      return success(undefined);
    },

    async cancel(
      actor: ActorContext,
      requestId: string
    ): Promise<Result<void>> {
      // AI_ACTOR cannot cancel (governance is human-only)
      if (isAiActor(actor)) {
        return failure('PERMISSION_DENIED', 'AI cannot cancel requests');
      }

      const request = await db.getRequest(requestId);

      if (request === null) {
        return failure('NOT_FOUND', `Approval request not found: ${requestId}`);
      }

      // Check state - can only cancel pending requests
      if (request.status !== 'pending') {
        return failure(
          'INVALID_STATE',
          `Cannot cancel request in ${request.status} state`
        );
      }

      // Only requester or SYSTEM_ACTOR can cancel
      if (!isSystemActor(actor) && actor.userId !== request.requesterId) {
        return failure(
          'PERMISSION_DENIED',
          'Only the requester can cancel the request'
        );
      }

      const reviewerId = getActorUserIdForReview(actor);
      await db.updateRequestStatus(requestId, 'canceled', reviewerId);

      await auditService.log(actor, {
        action: 'approval.canceled',
        resourceType: 'approval_request',
        resourceId: requestId,
        details: {
          targetResourceType: request.resourceType,
          targetResourceId: request.resourceId,
          requestedAction: request.action,
        },
      });

      return success(undefined);
    },
  };
}
