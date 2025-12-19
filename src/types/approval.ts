/**
 * Approval Domain Types
 * Phase 2: TDD - Type definitions for ApprovalService
 *
 * Reference: docs/stage-2-service-layer.md Section 3.11
 *
 * SCOPE: Governance approval workflow management
 *
 * Owns: approval_requests table
 */

/**
 * Resource types that can require approval
 */
export type ApprovalResourceType = 'knowledge_item' | 'system_prompt';

/**
 * Actions that require approval
 */
export type ApprovalAction = 'publish' | 'activate' | 'deprecate';

/**
 * Approval request status
 */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'canceled';

/**
 * Approval request entity
 */
export interface ApprovalRequest {
  id: string;
  resourceType: ApprovalResourceType;
  resourceId: string;
  action: ApprovalAction;
  status: ApprovalStatus;
  requesterId: string;
  reviewerId: string | null;
  requestNotes: string | null;
  reviewNotes: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
}

/**
 * Parameters for creating an approval request
 */
export interface CreateApprovalRequestParams {
  resourceType: ApprovalResourceType;
  resourceId: string;
  action: ApprovalAction;
  notes?: string;
}

/**
 * Parameters for listing pending requests
 */
export interface ListPendingRequestsParams {
  resourceType?: ApprovalResourceType;
  status?: ApprovalStatus;
}
