-- Migration: 005_memory_domain.sql
-- Purpose: Create memories and memory_vectors tables for MemoryService
-- Reference: docs/stage-1-database-governance.md Section 2.6
-- Reference: docs/stage-1-database-governance.md Section 9.2 (Memory Retention Policy)
--
-- SCOPE: Long-term user memory management
-- NOT IN SCOPE: Embedding generation (AI-agnostic)
--
-- Policy: Memory Retention
-- - Default retention: Indefinite
-- - Auto-archive: After 180 days of no access
-- - Auto-delete: Never
-- - User override: Always allowed

-- Memories table - long-term user memories
CREATE TABLE IF NOT EXISTS memories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content         TEXT NOT NULL,
    category        TEXT,
    source          TEXT NOT NULL DEFAULT 'conversation' CHECK (source IN ('conversation', 'user_input', 'system')),
    importance      INTEGER DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_accessed   TIMESTAMPTZ
);

-- Memory vectors table - embeddings for semantic search
-- NOTE: Embeddings are generated asynchronously (AI-agnostic principle)
CREATE TABLE IF NOT EXISTS memory_vectors (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_id       UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    embedding       vector(1536),  -- OpenAI ada-002 dimension, can be changed
    model           TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id);
CREATE INDEX IF NOT EXISTS idx_memories_user_status ON memories(user_id, status) WHERE status != 'deleted';
CREATE INDEX IF NOT EXISTS idx_memories_user_category ON memories(user_id, category) WHERE category IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_memories_last_accessed ON memories(last_accessed) WHERE last_accessed IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_memory_vectors_memory ON memory_vectors(memory_id);

-- Vector similarity search index (ivfflat for cosine similarity)
CREATE INDEX IF NOT EXISTS idx_memory_vectors_embedding ON memory_vectors
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- Auto-update timestamps for memories
DROP TRIGGER IF EXISTS memories_updated_at ON memories;
CREATE TRIGGER memories_updated_at
    BEFORE UPDATE ON memories
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- RLS Policies
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_vectors ENABLE ROW LEVEL SECURITY;

-- Memories: read own or with memory:read permission
CREATE POLICY memories_read_own ON memories
    FOR SELECT
    USING (
        user_id = auth.uid()::TEXT
        OR EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN role_permissions rp ON ur.role_id = rp.role_id
            JOIN permissions p ON rp.permission_id = p.id
            WHERE ur.user_id = auth.uid()::TEXT
            AND p.code = 'memory:read'
            AND (ur.expires_at IS NULL OR ur.expires_at > now())
        )
    );

-- Memories: insert own
CREATE POLICY memories_insert_own ON memories
    FOR INSERT
    WITH CHECK (user_id = auth.uid()::TEXT);

-- Memories: update own or with memory:manage permission
CREATE POLICY memories_update_own ON memories
    FOR UPDATE
    USING (
        user_id = auth.uid()::TEXT
        OR EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN role_permissions rp ON ur.role_id = rp.role_id
            JOIN permissions p ON rp.permission_id = p.id
            WHERE ur.user_id = auth.uid()::TEXT
            AND p.code = 'memory:write'
            AND (ur.expires_at IS NULL OR ur.expires_at > now())
        )
    );

-- Memory vectors: read via memory ownership
CREATE POLICY memory_vectors_read_via_memory ON memory_vectors
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM memories m
            WHERE m.id = memory_vectors.memory_id
            AND (
                m.user_id = auth.uid()::TEXT
                OR EXISTS (
                    SELECT 1 FROM user_roles ur
                    JOIN role_permissions rp ON ur.role_id = rp.role_id
                    JOIN permissions p ON rp.permission_id = p.id
                    WHERE ur.user_id = auth.uid()::TEXT
                    AND p.code = 'memory:read'
                    AND (ur.expires_at IS NULL OR ur.expires_at > now())
                )
            )
        )
    );

-- Memory vectors: insert via memory ownership (for embedding service)
CREATE POLICY memory_vectors_insert_via_memory ON memory_vectors
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM memories m
            WHERE m.id = memory_vectors.memory_id
            AND (
                m.user_id = auth.uid()::TEXT
                OR EXISTS (
                    SELECT 1 FROM user_roles ur
                    JOIN role_permissions rp ON ur.role_id = rp.role_id
                    JOIN permissions p ON rp.permission_id = p.id
                    WHERE ur.user_id = auth.uid()::TEXT
                    AND p.code = 'memory:write'
                    AND (ur.expires_at IS NULL OR ur.expires_at > now())
                )
            )
        )
    );

-- Memory vectors: delete via memory ownership (for re-embedding)
CREATE POLICY memory_vectors_delete_via_memory ON memory_vectors
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM memories m
            WHERE m.id = memory_vectors.memory_id
            AND (
                m.user_id = auth.uid()::TEXT
                OR EXISTS (
                    SELECT 1 FROM user_roles ur
                    JOIN role_permissions rp ON ur.role_id = rp.role_id
                    JOIN permissions p ON rp.permission_id = p.id
                    WHERE ur.user_id = auth.uid()::TEXT
                    AND p.code = 'memory:write'
                    AND (ur.expires_at IS NULL OR ur.expires_at > now())
                )
            )
        )
    );

-- Add memory permissions if not exists
INSERT INTO permissions (code, description, category)
VALUES
    ('memory:read', 'Read any user memory', 'memory'),
    ('memory:write', 'Write to memories', 'memory'),
    ('memory:delete', 'Delete memories', 'memory')
ON CONFLICT (code) DO NOTHING;

-- Grant memory permissions to admin role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'admin' AND p.code IN ('memory:read', 'memory:write', 'memory:delete')
ON CONFLICT DO NOTHING;

-- Grant memory permissions to super_admin role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'super_admin' AND p.code IN ('memory:read', 'memory:write', 'memory:delete')
ON CONFLICT DO NOTHING;

-- Grant basic memory permissions to user role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'user' AND p.code IN ('memory:read', 'memory:write', 'memory:delete')
ON CONFLICT DO NOTHING;
