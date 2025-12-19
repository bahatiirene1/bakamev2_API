-- Migration: 011_knowledge_domain.sql
-- Purpose: Create knowledge items and versions tables for KnowledgeService
-- Reference: docs/stage-2-service-layer.md Section 3.5
--
-- This migration creates:
-- 1. knowledge_items table - Knowledge base articles with governance workflow
-- 2. knowledge_versions table - Version history for knowledge items
--
-- Relationships:
-- - knowledge_items.author_id → users.id (TEXT)
-- - knowledge_items.reviewer_id → users.id (nullable)
-- - knowledge_versions.item_id → knowledge_items.id
-- - knowledge_versions.author_id → users.id

-- ============================================================================
-- KNOWLEDGE_ITEMS TABLE
-- ============================================================================
-- Knowledge base articles with governance workflow

CREATE TABLE IF NOT EXISTS knowledge_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Content
    title           TEXT NOT NULL,
    content         TEXT NOT NULL,
    category        TEXT,

    -- Governance workflow status
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'pending_review', 'approved', 'published', 'archived')),

    -- Ownership and review
    author_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reviewer_id     TEXT REFERENCES users(id) ON DELETE SET NULL,

    -- Publishing
    published_at    TIMESTAMPTZ,

    -- Versioning
    version         INTEGER NOT NULL DEFAULT 1,

    -- Extensible metadata
    metadata        JSONB NOT NULL DEFAULT '{}',

    -- Timestamps
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- KNOWLEDGE_VERSIONS TABLE
-- ============================================================================
-- Version history for knowledge items (immutable snapshots)

CREATE TABLE IF NOT EXISTS knowledge_versions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Reference to knowledge item
    item_id         UUID NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,

    -- Version info
    version         INTEGER NOT NULL,

    -- Snapshot of content at this version
    title           TEXT NOT NULL,
    content         TEXT NOT NULL,

    -- Who created this version
    author_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Timestamp
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Unique constraint: one version number per item
    UNIQUE(item_id, version)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- knowledge_items indexes
CREATE INDEX IF NOT EXISTS idx_knowledge_items_status
    ON knowledge_items(status);

CREATE INDEX IF NOT EXISTS idx_knowledge_items_author
    ON knowledge_items(author_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_items_category
    ON knowledge_items(category)
    WHERE category IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_knowledge_items_published
    ON knowledge_items(published_at DESC)
    WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_knowledge_items_created
    ON knowledge_items(created_at DESC);

-- knowledge_versions indexes
CREATE INDEX IF NOT EXISTS idx_knowledge_versions_item
    ON knowledge_versions(item_id, version DESC);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Auto-update updated_at for knowledge_items
CREATE OR REPLACE FUNCTION update_knowledge_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_knowledge_items_updated_at
    BEFORE UPDATE ON knowledge_items
    FOR EACH ROW
    EXECUTE FUNCTION update_knowledge_items_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE knowledge_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_versions ENABLE ROW LEVEL SECURITY;

-- knowledge_items: Anyone can view published items
CREATE POLICY "Anyone can view published knowledge items"
    ON knowledge_items
    FOR SELECT
    USING (status = 'published');

-- knowledge_items: Authors can view their own items
CREATE POLICY "Authors can view own knowledge items"
    ON knowledge_items
    FOR SELECT
    USING (auth.uid()::text = author_id);

-- knowledge_items: Authors can update their draft items
CREATE POLICY "Authors can update own draft items"
    ON knowledge_items
    FOR UPDATE
    USING (auth.uid()::text = author_id AND status IN ('draft', 'pending_review'));

-- knowledge_versions: Follow same visibility as parent item
CREATE POLICY "Anyone can view published item versions"
    ON knowledge_versions
    FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM knowledge_items ki
        WHERE ki.id = item_id AND ki.status = 'published'
    ));

CREATE POLICY "Authors can view own item versions"
    ON knowledge_versions
    FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM knowledge_items ki
        WHERE ki.id = item_id AND ki.author_id = auth.uid()::text
    ));

-- ============================================================================
-- PERMISSIONS
-- ============================================================================

-- Add knowledge permissions if they don't exist
INSERT INTO permissions (code, description, category)
VALUES
    ('knowledge:read', 'Read published knowledge items', 'knowledge'),
    ('knowledge:write', 'Create and edit knowledge items', 'knowledge'),
    ('knowledge:review', 'Review and approve knowledge items', 'knowledge'),
    ('knowledge:publish', 'Publish approved knowledge items', 'knowledge')
ON CONFLICT (code) DO NOTHING;

-- Grant knowledge:read to user role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'user' AND p.code = 'knowledge:read'
ON CONFLICT DO NOTHING;

-- Grant knowledge:write to user role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'user' AND p.code = 'knowledge:write'
ON CONFLICT DO NOTHING;

-- Grant all knowledge permissions to admin role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'admin' AND p.code IN ('knowledge:read', 'knowledge:write', 'knowledge:review', 'knowledge:publish')
ON CONFLICT DO NOTHING;

-- Grant all knowledge permissions to super_admin role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'super_admin' AND p.code IN ('knowledge:read', 'knowledge:write', 'knowledge:review', 'knowledge:publish')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE knowledge_items IS 'Knowledge base articles with governance workflow (draft → pending_review → approved → published → archived)';
COMMENT ON COLUMN knowledge_items.status IS 'Governance workflow status: draft, pending_review, approved, published, archived';
COMMENT ON COLUMN knowledge_items.reviewer_id IS 'User who approved/rejected the item';
COMMENT ON COLUMN knowledge_items.version IS 'Current version number, incremented on content updates';
COMMENT ON COLUMN knowledge_items.metadata IS 'Extensible metadata (source, tags, priority, etc.)';

COMMENT ON TABLE knowledge_versions IS 'Immutable version history snapshots for knowledge items';
COMMENT ON COLUMN knowledge_versions.version IS 'Version number (matches knowledge_items.version at time of snapshot)';
