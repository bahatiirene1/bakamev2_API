-- Migration: 008_approval_domain
-- Purpose: Create approval workflow tables
-- Reference: docs/stage-1-database-governance.md Section 2.12
--
-- This migration creates:
-- 1. approval_requests table - Governance workflow for changes requiring review
--
-- Relationships:
-- - approval_requests.requester_id → users.id (TEXT)
-- - approval_requests.reviewer_id → users.id (TEXT, nullable until reviewed)

-- ============================================================================
-- APPROVAL_REQUESTS TABLE
-- ============================================================================
-- Approval requests for governed changes (knowledge_item publish, system_prompt activate, etc.)

CREATE TABLE IF NOT EXISTS approval_requests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- What needs approval
    resource_type   TEXT NOT NULL,                  -- 'knowledge_item', 'system_prompt'
    resource_id     UUID NOT NULL,
    action          TEXT NOT NULL,                  -- 'publish', 'activate', 'deprecate'

    -- Workflow state
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'canceled')),

    -- Participants (TEXT to match users.id type)
    requester_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reviewer_id     TEXT REFERENCES users(id) ON DELETE SET NULL,

    -- Notes
    request_notes   TEXT,                           -- Notes from requester
    review_notes    TEXT,                           -- Notes from reviewer

    -- Timestamps
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at     TIMESTAMPTZ,

    -- Constraints
    CONSTRAINT valid_resource_type CHECK (resource_type IN ('knowledge_item', 'system_prompt')),
    CONSTRAINT valid_action CHECK (action IN ('publish', 'activate', 'deprecate'))
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Index for listing pending requests (common query for reviewers)
CREATE INDEX IF NOT EXISTS idx_approval_requests_status
    ON approval_requests(status, created_at DESC);

-- Index for requester lookups (user checking their requests)
CREATE INDEX IF NOT EXISTS idx_approval_requests_requester
    ON approval_requests(requester_id, created_at DESC);

-- Index for resource lookups (checking if resource has pending approval)
CREATE INDEX IF NOT EXISTS idx_approval_requests_resource
    ON approval_requests(resource_type, resource_id, status);

-- Index for reviewer lookups
CREATE INDEX IF NOT EXISTS idx_approval_requests_reviewer
    ON approval_requests(reviewer_id, reviewed_at DESC)
    WHERE reviewer_id IS NOT NULL;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;

-- Requesters can view their own requests
CREATE POLICY "Users can view own requests"
    ON approval_requests
    FOR SELECT
    USING (auth.uid()::text = requester_id);

-- Reviewers can view all pending requests (needs role check in app)
-- Note: Full reviewer check is done in service layer
CREATE POLICY "Reviewers can view pending requests"
    ON approval_requests
    FOR SELECT
    USING (status = 'pending');

-- Users can create approval requests
CREATE POLICY "Users can create requests"
    ON approval_requests
    FOR INSERT
    WITH CHECK (auth.uid()::text = requester_id);

-- Service role can do anything (bypasses RLS)
-- This is implicit for service_role key

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE approval_requests IS 'Governance workflow for changes requiring review (knowledge publish, prompt activation, etc.)';
COMMENT ON COLUMN approval_requests.resource_type IS 'Type of resource requiring approval: knowledge_item or system_prompt';
COMMENT ON COLUMN approval_requests.resource_id IS 'UUID of the resource requiring approval';
COMMENT ON COLUMN approval_requests.action IS 'Action requiring approval: publish, activate, or deprecate';
COMMENT ON COLUMN approval_requests.status IS 'Workflow state: pending, approved, rejected, or canceled';
COMMENT ON COLUMN approval_requests.requester_id IS 'User who created the approval request';
COMMENT ON COLUMN approval_requests.reviewer_id IS 'User who reviewed (approved/rejected) the request';
COMMENT ON COLUMN approval_requests.request_notes IS 'Notes from requester explaining the change';
COMMENT ON COLUMN approval_requests.review_notes IS 'Notes from reviewer explaining the decision';
