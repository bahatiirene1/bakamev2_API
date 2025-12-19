-- Migration: 012_prompt_domain.sql
-- Purpose: Create system_prompts and prompt_versions tables for PromptService
-- Reference: docs/stage-2-service-layer.md Section 3.6
--
-- This migration creates:
-- 1. system_prompts table - System prompts with governance workflow
-- 2. prompt_versions table - Version history for prompts
--
-- Relationships:
-- - system_prompts.author_id → users.id (TEXT)
-- - system_prompts.reviewer_id → users.id (nullable)
-- - prompt_versions.prompt_id → system_prompts.id
-- - prompt_versions.author_id → users.id

-- ============================================================================
-- SYSTEM_PROMPTS TABLE
-- ============================================================================
-- System prompts with governance workflow

CREATE TABLE IF NOT EXISTS system_prompts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Content
    name            TEXT NOT NULL,
    description     TEXT,
    content         TEXT NOT NULL,

    -- Governance workflow status
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'pending_review', 'approved', 'active', 'deprecated')),

    -- Ownership and review
    author_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reviewer_id     TEXT REFERENCES users(id) ON DELETE SET NULL,

    -- Versioning
    version         INTEGER NOT NULL DEFAULT 1,

    -- Default prompt flag (only one can be active default at a time)
    is_default      BOOLEAN NOT NULL DEFAULT false,

    -- Activation timestamp
    activated_at    TIMESTAMPTZ,

    -- Timestamps
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- PROMPT_VERSIONS TABLE
-- ============================================================================
-- Version history for prompts (immutable snapshots)

CREATE TABLE IF NOT EXISTS prompt_versions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Reference to system prompt
    prompt_id       UUID NOT NULL REFERENCES system_prompts(id) ON DELETE CASCADE,

    -- Version info
    version         INTEGER NOT NULL,

    -- Snapshot of content at this version
    name            TEXT NOT NULL,
    content         TEXT NOT NULL,

    -- Who created this version
    author_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Timestamp
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Unique constraint: one version number per prompt
    UNIQUE(prompt_id, version)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- system_prompts indexes
CREATE INDEX IF NOT EXISTS idx_system_prompts_status
    ON system_prompts(status);

CREATE INDEX IF NOT EXISTS idx_system_prompts_author
    ON system_prompts(author_id);

CREATE INDEX IF NOT EXISTS idx_system_prompts_default
    ON system_prompts(is_default)
    WHERE is_default = true;

CREATE INDEX IF NOT EXISTS idx_system_prompts_active
    ON system_prompts(activated_at DESC)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_system_prompts_created
    ON system_prompts(created_at DESC);

-- prompt_versions indexes
CREATE INDEX IF NOT EXISTS idx_prompt_versions_prompt
    ON prompt_versions(prompt_id, version DESC);

-- ============================================================================
-- PARTIAL UNIQUE INDEX FOR DEFAULT PROMPT
-- ============================================================================
-- Ensure only one prompt can be the default at a time

CREATE UNIQUE INDEX IF NOT EXISTS idx_system_prompts_single_default
    ON system_prompts(is_default)
    WHERE is_default = true;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Auto-update updated_at for system_prompts
CREATE OR REPLACE FUNCTION update_system_prompts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_system_prompts_updated_at
    BEFORE UPDATE ON system_prompts
    FOR EACH ROW
    EXECUTE FUNCTION update_system_prompts_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE system_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_versions ENABLE ROW LEVEL SECURITY;

-- system_prompts: Anyone can view active prompts
CREATE POLICY "Anyone can view active prompts"
    ON system_prompts
    FOR SELECT
    USING (status = 'active');

-- system_prompts: Anyone can view approved prompts
CREATE POLICY "Anyone can view approved prompts"
    ON system_prompts
    FOR SELECT
    USING (status = 'approved');

-- system_prompts: Authors can view their own prompts
CREATE POLICY "Authors can view own prompts"
    ON system_prompts
    FOR SELECT
    USING (auth.uid()::text = author_id);

-- system_prompts: Authors can update their draft prompts
CREATE POLICY "Authors can update own draft prompts"
    ON system_prompts
    FOR UPDATE
    USING (auth.uid()::text = author_id AND status = 'draft');

-- prompt_versions: Follow same visibility as parent prompt
CREATE POLICY "Anyone can view active prompt versions"
    ON prompt_versions
    FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM system_prompts sp
        WHERE sp.id = prompt_id AND sp.status = 'active'
    ));

CREATE POLICY "Authors can view own prompt versions"
    ON prompt_versions
    FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM system_prompts sp
        WHERE sp.id = prompt_id AND sp.author_id = auth.uid()::text
    ));

-- ============================================================================
-- PERMISSIONS
-- ============================================================================

-- Add prompt permissions if they don't exist
INSERT INTO permissions (code, description, category)
VALUES
    ('prompt:read', 'Read active and approved prompts', 'prompt'),
    ('prompt:write', 'Create and edit prompts', 'prompt'),
    ('prompt:review', 'Review and approve prompts', 'prompt'),
    ('prompt:activate', 'Activate and deprecate prompts', 'prompt')
ON CONFLICT (code) DO NOTHING;

-- Grant prompt:read to user role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'user' AND p.code = 'prompt:read'
ON CONFLICT DO NOTHING;

-- Grant all prompt permissions to admin role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'admin' AND p.code IN ('prompt:read', 'prompt:write', 'prompt:review', 'prompt:activate')
ON CONFLICT DO NOTHING;

-- Grant all prompt permissions to super_admin role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'super_admin' AND p.code IN ('prompt:read', 'prompt:write', 'prompt:review', 'prompt:activate')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE system_prompts IS 'System prompts with governance workflow (draft → pending_review → approved → active → deprecated)';
COMMENT ON COLUMN system_prompts.status IS 'Governance workflow status: draft, pending_review, approved, active, deprecated';
COMMENT ON COLUMN system_prompts.reviewer_id IS 'User who approved/rejected the prompt';
COMMENT ON COLUMN system_prompts.version IS 'Current version number, incremented on content updates';
COMMENT ON COLUMN system_prompts.is_default IS 'Whether this is the default active prompt (only one can be true)';
COMMENT ON COLUMN system_prompts.activated_at IS 'When the prompt was activated (made default)';

COMMENT ON TABLE prompt_versions IS 'Immutable version history snapshots for system prompts';
COMMENT ON COLUMN prompt_versions.version IS 'Version number (matches system_prompts.version at time of snapshot)';
