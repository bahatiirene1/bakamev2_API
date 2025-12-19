-- Migration: 006_file_domain.sql
-- Purpose: Create files table for FileService
-- Reference: docs/stage-1-database-governance.md Section 2.7
-- Reference: docs/stage-2-service-layer.md Section 3.9
--
-- SCOPE: File upload and management (storage + metadata only)
-- NOT IN SCOPE: Orchestration, tools, content processing
--
-- Policy: File Storage Quotas via Entitlements
-- - Limits come from entitlements, not hardcoded
-- - max_file_size_mb, total_storage_mb, max_files_per_user
--
-- GUARDRAILS:
-- - Users can only access their own files
-- - AI_ACTOR cannot upload or delete (enforced in service layer)
-- - Soft delete pattern (status = 'deleted')

-- Files table - user file metadata
CREATE TABLE IF NOT EXISTS files (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename        TEXT NOT NULL,
    mime_type       TEXT NOT NULL,
    size_bytes      BIGINT NOT NULL CHECK (size_bytes > 0),
    storage_path    TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'active', 'deleted')),
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_files_user ON files(user_id);
CREATE INDEX IF NOT EXISTS idx_files_user_status ON files(user_id, status) WHERE status != 'deleted';
CREATE INDEX IF NOT EXISTS idx_files_user_created ON files(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_storage_path ON files(storage_path);

-- Auto-update timestamps
DROP TRIGGER IF EXISTS files_updated_at ON files;
CREATE TRIGGER files_updated_at
    BEFORE UPDATE ON files
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- RLS Policies
ALTER TABLE files ENABLE ROW LEVEL SECURITY;

-- Files: read own or with file:read permission
CREATE POLICY files_read_own ON files
    FOR SELECT
    USING (
        user_id = auth.uid()::TEXT
        OR EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN role_permissions rp ON ur.role_id = rp.role_id
            JOIN permissions p ON rp.permission_id = p.id
            WHERE ur.user_id = auth.uid()::TEXT
            AND p.code = 'file:read'
            AND (ur.expires_at IS NULL OR ur.expires_at > now())
        )
    );

-- Files: insert own
CREATE POLICY files_insert_own ON files
    FOR INSERT
    WITH CHECK (user_id = auth.uid()::TEXT);

-- Files: update own (for status changes, confirmations)
CREATE POLICY files_update_own ON files
    FOR UPDATE
    USING (user_id = auth.uid()::TEXT)
    WITH CHECK (user_id = auth.uid()::TEXT);

-- Files: delete own (soft delete - updates status)
-- Note: Actual deletion handled via status update, not DELETE
CREATE POLICY files_delete_own ON files
    FOR DELETE
    USING (user_id = auth.uid()::TEXT);

-- Service role bypass (for service account operations)
CREATE POLICY files_service_role ON files
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- Comments for documentation
COMMENT ON TABLE files IS 'User file metadata - storage + metadata only';
COMMENT ON COLUMN files.status IS 'File status: uploading (pending), active (confirmed), deleted (soft-deleted)';
COMMENT ON COLUMN files.storage_path IS 'Path in storage backend (e.g., uploads/{user_id}/{file_id})';
COMMENT ON COLUMN files.size_bytes IS 'File size in bytes - used for quota calculations';
COMMENT ON COLUMN files.metadata IS 'Additional file metadata (JSON)';
