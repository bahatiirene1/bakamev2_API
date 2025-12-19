-- Migration: 003_user_domain.sql
-- Purpose: Create users, profiles, and ai_preferences tables for UserService
-- Reference: docs/stage-2-service-layer.md Section 3.2
--
-- SCOPE: Profiles, AI preferences, account status
-- NOT IN SCOPE: Roles, permissions (handled by auth_domain)

-- Users table - identity anchor
-- Links to Supabase auth.users via id
CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,  -- Same as auth.users.id
    email           TEXT NOT NULL UNIQUE,
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ  -- Soft delete timestamp
);

-- Profiles table - presentation data only
CREATE TABLE IF NOT EXISTS profiles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    display_name    TEXT,
    avatar_url      TEXT,
    timezone        TEXT NOT NULL DEFAULT 'UTC',
    locale          TEXT NOT NULL DEFAULT 'en',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- AI preferences table - user's AI interaction settings
CREATE TABLE IF NOT EXISTS ai_preferences (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    response_length     TEXT NOT NULL DEFAULT 'balanced' CHECK (response_length IN ('concise', 'balanced', 'detailed')),
    formality           TEXT NOT NULL DEFAULT 'neutral' CHECK (formality IN ('casual', 'neutral', 'formal')),
    allow_memory        BOOLEAN NOT NULL DEFAULT true,
    allow_web_search    BOOLEAN NOT NULL DEFAULT false,
    custom_instructions TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status) WHERE status != 'deleted';
CREATE INDEX IF NOT EXISTS idx_profiles_user ON profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_preferences_user ON ai_preferences(user_id);

-- Auto-update timestamps
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing triggers if they exist
DROP TRIGGER IF EXISTS users_updated_at ON users;
DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
DROP TRIGGER IF EXISTS ai_preferences_updated_at ON ai_preferences;

-- Create triggers for updated_at
CREATE TRIGGER users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER ai_preferences_updated_at
    BEFORE UPDATE ON ai_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- RLS Policies (service role bypasses RLS)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_preferences ENABLE ROW LEVEL SECURITY;

-- Users: read own record or with user:read permission
CREATE POLICY users_read_own ON users
    FOR SELECT
    USING (
        id = auth.uid()::TEXT
        OR EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN role_permissions rp ON ur.role_id = rp.role_id
            JOIN permissions p ON rp.permission_id = p.id
            WHERE ur.user_id = auth.uid()::TEXT
            AND p.code = 'user:read'
            AND (ur.expires_at IS NULL OR ur.expires_at > now())
        )
    );

-- Profiles: read own or with user:read permission
CREATE POLICY profiles_read_own ON profiles
    FOR SELECT
    USING (
        user_id = auth.uid()::TEXT
        OR EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN role_permissions rp ON ur.role_id = rp.role_id
            JOIN permissions p ON rp.permission_id = p.id
            WHERE ur.user_id = auth.uid()::TEXT
            AND p.code = 'user:read'
            AND (ur.expires_at IS NULL OR ur.expires_at > now())
        )
    );

-- Profiles: update own or with user:update permission
CREATE POLICY profiles_update_own ON profiles
    FOR UPDATE
    USING (
        user_id = auth.uid()::TEXT
        OR EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN role_permissions rp ON ur.role_id = rp.role_id
            JOIN permissions p ON rp.permission_id = p.id
            WHERE ur.user_id = auth.uid()::TEXT
            AND p.code = 'user:update'
            AND (ur.expires_at IS NULL OR ur.expires_at > now())
        )
    );

-- AI preferences: same policies as profiles
CREATE POLICY ai_prefs_read_own ON ai_preferences
    FOR SELECT
    USING (
        user_id = auth.uid()::TEXT
        OR EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN role_permissions rp ON ur.role_id = rp.role_id
            JOIN permissions p ON rp.permission_id = p.id
            WHERE ur.user_id = auth.uid()::TEXT
            AND p.code = 'user:read'
            AND (ur.expires_at IS NULL OR ur.expires_at > now())
        )
    );

CREATE POLICY ai_prefs_update_own ON ai_preferences
    FOR UPDATE
    USING (
        user_id = auth.uid()::TEXT
        OR EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN role_permissions rp ON ur.role_id = rp.role_id
            JOIN permissions p ON rp.permission_id = p.id
            WHERE ur.user_id = auth.uid()::TEXT
            AND p.code = 'user:update'
            AND (ur.expires_at IS NULL OR ur.expires_at > now())
        )
    );

-- Add user:update permission if not exists
INSERT INTO permissions (code, description, category)
VALUES ('user:update', 'Update user profiles and preferences', 'user')
ON CONFLICT (code) DO NOTHING;

-- Grant user:update to admin role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'admin' AND p.code = 'user:update'
ON CONFLICT DO NOTHING;

-- Grant user:update to super_admin role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'super_admin' AND p.code = 'user:update'
ON CONFLICT DO NOTHING;
