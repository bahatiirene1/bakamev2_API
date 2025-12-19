-- Migration: 002_audit_domain.sql
-- Purpose: Create audit_logs table for immutable audit logging
-- Reference: docs/stage-1-database-governance.md Section 2.3

-- Immutable audit log - NEVER updated or deleted
CREATE TABLE IF NOT EXISTS audit_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_id        TEXT,  -- User ID (TEXT to match user_roles.user_id pattern)
    actor_type      TEXT NOT NULL CHECK (actor_type IN ('user', 'admin', 'system', 'ai')),
    action          TEXT NOT NULL,              -- e.g., 'knowledge:publish', 'role:assign'
    resource_type   TEXT NOT NULL,              -- e.g., 'knowledge_item', 'user'
    resource_id     TEXT,                       -- ID of affected resource
    details         JSONB NOT NULL DEFAULT '{}',-- action-specific data
    ip_address      INET,
    user_agent      TEXT,
    request_id      TEXT                        -- correlation ID for tracing
);

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);

-- Prevent updates and deletes (immutability)
CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Audit logs are immutable and cannot be modified or deleted';
END;
$$ LANGUAGE plpgsql;

-- Drop existing triggers if they exist
DROP TRIGGER IF EXISTS audit_log_no_update ON audit_logs;
DROP TRIGGER IF EXISTS audit_log_no_delete ON audit_logs;

-- Create triggers to enforce immutability
CREATE TRIGGER audit_log_no_update
    BEFORE UPDATE ON audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION prevent_audit_log_modification();

CREATE TRIGGER audit_log_no_delete
    BEFORE DELETE ON audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION prevent_audit_log_modification();

-- Grant permissions (service role bypasses RLS)
-- RLS: Auditors can read, no one can write directly (only service)
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Only users with audit:read permission can view logs via direct access
-- Note: Service role bypasses RLS, so this is for defense-in-depth
CREATE POLICY audit_logs_read_policy ON audit_logs
    FOR SELECT
    USING (
        -- Check if user has audit:read permission via their roles
        EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN role_permissions rp ON ur.role_id = rp.role_id
            JOIN permissions p ON rp.permission_id = p.id
            WHERE ur.user_id = auth.uid()::TEXT
            AND p.code = 'audit:read'
            AND (ur.expires_at IS NULL OR ur.expires_at > now())
        )
    );

-- Policy: No direct inserts (service role bypasses this)
CREATE POLICY audit_logs_no_insert_policy ON audit_logs
    FOR INSERT
    WITH CHECK (false);
