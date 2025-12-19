-- Migration: 004_chat_domain.sql
-- Purpose: Create chats and messages tables for ChatService
-- Reference: docs/stage-1-database-governance.md Section 2.4
--
-- SCOPE: Conversation management (persistence-only)
-- NOT IN SCOPE: AI orchestration, prompt construction
--
-- CRITICAL: Messages are IMMUTABLE (append-only)

-- Chats table - conversation container
CREATE TABLE IF NOT EXISTS chats (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title           TEXT,
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);

-- Messages table - individual turns in a chat
-- IMMUTABLE: No UPDATE or DELETE allowed on content
CREATE TABLE IF NOT EXISTS messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id         UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
    content         TEXT NOT NULL,
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_chats_user ON chats(user_id);
CREATE INDEX IF NOT EXISTS idx_chats_user_status ON chats(user_id, status) WHERE status != 'deleted';
CREATE INDEX IF NOT EXISTS idx_chats_updated ON chats(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);

-- Auto-update timestamps for chats
DROP TRIGGER IF EXISTS chats_updated_at ON chats;
CREATE TRIGGER chats_updated_at
    BEFORE UPDATE ON chats
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- RLS Policies
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Chats: read own or with chat:read permission
CREATE POLICY chats_read_own ON chats
    FOR SELECT
    USING (
        user_id = auth.uid()::TEXT
        OR EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN role_permissions rp ON ur.role_id = rp.role_id
            JOIN permissions p ON rp.permission_id = p.id
            WHERE ur.user_id = auth.uid()::TEXT
            AND p.code = 'chat:read'
            AND (ur.expires_at IS NULL OR ur.expires_at > now())
        )
    );

-- Chats: insert own
CREATE POLICY chats_insert_own ON chats
    FOR INSERT
    WITH CHECK (user_id = auth.uid()::TEXT);

-- Chats: update own or with chat:manage permission
CREATE POLICY chats_update_own ON chats
    FOR UPDATE
    USING (
        user_id = auth.uid()::TEXT
        OR EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN role_permissions rp ON ur.role_id = rp.role_id
            JOIN permissions p ON rp.permission_id = p.id
            WHERE ur.user_id = auth.uid()::TEXT
            AND p.code = 'chat:manage'
            AND (ur.expires_at IS NULL OR ur.expires_at > now())
        )
    );

-- Messages: read via chat ownership
CREATE POLICY messages_read_via_chat ON messages
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM chats c
            WHERE c.id = messages.chat_id
            AND (
                c.user_id = auth.uid()::TEXT
                OR EXISTS (
                    SELECT 1 FROM user_roles ur
                    JOIN role_permissions rp ON ur.role_id = rp.role_id
                    JOIN permissions p ON rp.permission_id = p.id
                    WHERE ur.user_id = auth.uid()::TEXT
                    AND p.code = 'chat:read'
                    AND (ur.expires_at IS NULL OR ur.expires_at > now())
                )
            )
        )
    );

-- Messages: insert via chat ownership
CREATE POLICY messages_insert_via_chat ON messages
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM chats c
            WHERE c.id = messages.chat_id
            AND (
                c.user_id = auth.uid()::TEXT
                OR EXISTS (
                    SELECT 1 FROM user_roles ur
                    JOIN role_permissions rp ON ur.role_id = rp.role_id
                    JOIN permissions p ON rp.permission_id = p.id
                    WHERE ur.user_id = auth.uid()::TEXT
                    AND p.code = 'chat:write'
                    AND (ur.expires_at IS NULL OR ur.expires_at > now())
                )
            )
        )
    );

-- Messages: update metadata only (for redaction)
-- Note: Content is immutable, only metadata can change
CREATE POLICY messages_update_metadata ON messages
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM chats c
            WHERE c.id = messages.chat_id
            AND (
                c.user_id = auth.uid()::TEXT
                OR EXISTS (
                    SELECT 1 FROM user_roles ur
                    JOIN role_permissions rp ON ur.role_id = rp.role_id
                    JOIN permissions p ON rp.permission_id = p.id
                    WHERE ur.user_id = auth.uid()::TEXT
                    AND p.code = 'chat:manage'
                    AND (ur.expires_at IS NULL OR ur.expires_at > now())
                )
            )
        )
    );

-- Add chat permissions if not exists
INSERT INTO permissions (code, description, category)
VALUES
    ('chat:read', 'Read any chat', 'chat'),
    ('chat:write', 'Write to chats', 'chat'),
    ('chat:manage', 'Manage chats (archive, redact)', 'chat')
ON CONFLICT (code) DO NOTHING;

-- Grant chat permissions to admin role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'admin' AND p.code IN ('chat:read', 'chat:write', 'chat:manage')
ON CONFLICT DO NOTHING;

-- Grant chat permissions to super_admin role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'super_admin' AND p.code IN ('chat:read', 'chat:write', 'chat:manage')
ON CONFLICT DO NOTHING;

-- Grant basic chat permissions to user role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'user' AND p.code IN ('chat:read', 'chat:write')
ON CONFLICT DO NOTHING;
