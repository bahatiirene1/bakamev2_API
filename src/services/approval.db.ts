/**
 * ApprovalService Database Adapter
 * Implements ApprovalServiceDb interface using Supabase
 *
 * Reference: docs/stage-2-service-layer.md Section 3.11
 *
 * SCOPE: Governance approval workflow management
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  ApprovalRequest,
  ApprovalStatus,
  ApprovalResourceType,
  ApprovalAction,
  CreateApprovalRequestParams,
} from '@/types/index.js';

import type {
  ApprovalServiceDb,
  PaginatedApprovalRequests,
} from './approval.service.js';

/**
 * Database row type for approval_requests
 */
interface ApprovalRequestRow {
  id: string;
  resource_type: string;
  resource_id: string;
  action: string;
  status: string;
  requester_id: string;
  reviewer_id: string | null;
  request_notes: string | null;
  review_notes: string | null;
  created_at: string;
  reviewed_at: string | null;
}

/**
 * Map database row to ApprovalRequest entity
 */
function mapRowToApprovalRequest(row: ApprovalRequestRow): ApprovalRequest {
  return {
    id: row.id,
    resourceType: row.resource_type as ApprovalResourceType,
    resourceId: row.resource_id,
    action: row.action as ApprovalAction,
    status: row.status as ApprovalStatus,
    requesterId: row.requester_id,
    reviewerId: row.reviewer_id,
    requestNotes: row.request_notes,
    reviewNotes: row.review_notes,
    createdAt: new Date(row.created_at),
    reviewedAt: row.reviewed_at !== null ? new Date(row.reviewed_at) : null,
  };
}

/**
 * Create ApprovalServiceDb implementation using Supabase
 */
export function createApprovalServiceDb(
  supabase: SupabaseClient
): ApprovalServiceDb {
  return {
    /**
     * Create a new approval request
     */
    async createRequest(
      requesterId: string,
      params: CreateApprovalRequestParams
    ): Promise<ApprovalRequest> {
      const insertData: Record<string, unknown> = {
        requester_id: requesterId,
        resource_type: params.resourceType,
        resource_id: params.resourceId,
        action: params.action,
        status: 'pending',
      };

      if (params.notes !== undefined) {
        insertData.request_notes = params.notes;
      }

      const { data, error } = await supabase
        .from('approval_requests')
        .insert(insertData)
        .select('*')
        .single();

      if (error !== null) {
        throw new Error(`Failed to create approval request: ${error.message}`);
      }

      return mapRowToApprovalRequest(data as ApprovalRequestRow);
    },

    /**
     * Get approval request by ID
     */
    async getRequest(requestId: string): Promise<ApprovalRequest | null> {
      const { data, error } = await supabase
        .from('approval_requests')
        .select('*')
        .eq('id', requestId)
        .single();

      if (error !== null) {
        if (error.code === 'PGRST116') {
          return null; // Not found
        }
        throw new Error(`Failed to get approval request: ${error.message}`);
      }

      return mapRowToApprovalRequest(data as ApprovalRequestRow);
    },

    /**
     * List approval requests with pagination and optional filters
     */
    async listPendingRequests(params: {
      limit: number;
      cursor?: string;
      resourceType?: string;
      status?: string;
    }): Promise<PaginatedApprovalRequests> {
      let query = supabase
        .from('approval_requests')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(params.limit + 1); // Fetch one extra to check if there are more

      // Filter by status if provided, otherwise default to pending
      if (params.status !== undefined) {
        query = query.eq('status', params.status);
      } else {
        query = query.eq('status', 'pending');
      }

      if (params.resourceType !== undefined) {
        query = query.eq('resource_type', params.resourceType);
      }

      if (params.cursor !== undefined) {
        // Cursor is the created_at timestamp of the last item
        query = query.lt('created_at', params.cursor);
      }

      const { data, error } = await query;

      if (error !== null) {
        throw new Error(
          `Failed to list pending approval requests: ${error.message}`
        );
      }

      const rows = data as ApprovalRequestRow[];
      const hasMore = rows.length > params.limit;
      const items = hasMore ? rows.slice(0, params.limit) : rows;

      const result: PaginatedApprovalRequests = {
        items: items.map(mapRowToApprovalRequest),
        hasMore,
      };

      const lastItem = items[items.length - 1];
      if (hasMore && lastItem !== undefined) {
        // Use the created_at of the last item as the cursor
        result.nextCursor = lastItem.created_at;
      }

      return result;
    },

    /**
     * Update approval request status
     */
    async updateRequestStatus(
      requestId: string,
      status: ApprovalStatus,
      reviewerId: string | null,
      notes?: string
    ): Promise<ApprovalRequest> {
      const updateData: Record<string, unknown> = {
        status,
        reviewed_at: new Date().toISOString(),
      };

      // Only set reviewer_id if provided (null means system action)
      if (reviewerId !== null) {
        updateData.reviewer_id = reviewerId;
      }

      if (notes !== undefined) {
        updateData.review_notes = notes;
      }

      const { data, error } = await supabase
        .from('approval_requests')
        .update(updateData)
        .eq('id', requestId)
        .select('*')
        .single();

      if (error !== null) {
        throw new Error(
          `Failed to update approval request status: ${error.message}`
        );
      }

      return mapRowToApprovalRequest(data as ApprovalRequestRow);
    },
  };
}
