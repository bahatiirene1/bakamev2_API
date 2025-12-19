-- AuthService Domain Tables
-- Stage 1: Database & Governance Layer

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Permissions are atomic capabilities
CREATE TABLE IF NOT EXISTS permissions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            TEXT NOT NULL UNIQUE,  -- e.g., 'knowledge:publish'
    description     TEXT NOT NULL,
    category        TEXT NOT NULL,         -- e.g., 'knowledge', 'admin', 'chat'
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Roles are named collections of permissions
CREATE TABLE IF NOT EXISTS roles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL UNIQUE,  -- e.g., 'editor', 'reviewer', 'auditor'
    description     TEXT NOT NULL,
    is_system       BOOLEAN NOT NULL DEFAULT false, -- system roles can't be deleted
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Many-to-many: roles have permissions
CREATE TABLE IF NOT EXISTS role_permissions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id         UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id   UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(role_id, permission_id)
);

-- Many-to-many: users have roles
-- Note: user_id is TEXT for flexibility (not FK to auth.users for testing)
CREATE TABLE IF NOT EXISTS user_roles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT NOT NULL,  -- Using TEXT for testing flexibility
    role_id         UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    granted_by      TEXT,           -- who assigned this role
    granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ,    -- optional expiration
    UNIQUE(user_id, role_id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);

-- Seed default permissions
INSERT INTO permissions (code, description, category) VALUES
    ('chat:read', 'Read chat messages', 'chat'),
    ('chat:write', 'Write chat messages', 'chat'),
    ('memory:read', 'Read memories', 'memory'),
    ('memory:write', 'Write memories', 'memory'),
    ('memory:delete', 'Delete memories', 'memory'),
    ('knowledge:read', 'Read knowledge items', 'knowledge'),
    ('knowledge:write', 'Write knowledge items', 'knowledge'),
    ('knowledge:publish', 'Publish knowledge items', 'knowledge'),
    ('knowledge:review', 'Review knowledge items', 'knowledge'),
    ('prompt:read', 'Read system prompts', 'prompt'),
    ('prompt:write', 'Write system prompts', 'prompt'),
    ('prompt:activate', 'Activate system prompts', 'prompt'),
    ('prompt:review', 'Review system prompts', 'prompt'),
    ('tool:invoke', 'Invoke tools', 'tool'),
    ('tool:manage', 'Manage tools', 'tool'),
    ('user:read', 'Read user information', 'user'),
    ('user:manage', 'Manage users', 'user'),
    ('role:assign', 'Assign roles to users', 'role'),
    ('audit:read', 'Read audit logs', 'audit'),
    ('billing:manage', 'Manage billing', 'billing')
ON CONFLICT (code) DO NOTHING;

-- Seed default roles
INSERT INTO roles (name, description, is_system) VALUES
    ('user', 'Standard user role', true),
    ('editor', 'Content editor role', true),
    ('reviewer', 'Content reviewer role', true),
    ('admin', 'Administrator role', true),
    ('auditor', 'Audit log viewer role', true),
    ('super_admin', 'Super administrator role', true)
ON CONFLICT (name) DO NOTHING;

-- Link permissions to roles
-- User role: chat:*, memory:*, tool:invoke
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'user' AND p.code IN ('chat:read', 'chat:write', 'memory:read', 'memory:write', 'tool:invoke')
ON CONFLICT DO NOTHING;

-- Editor role: user + knowledge:write, prompt:write
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'editor' AND p.code IN ('chat:read', 'chat:write', 'memory:read', 'memory:write', 'tool:invoke', 'knowledge:read', 'knowledge:write', 'prompt:read', 'prompt:write')
ON CONFLICT DO NOTHING;

-- Reviewer role: editor + knowledge:review, prompt:review
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'reviewer' AND p.code IN ('chat:read', 'chat:write', 'memory:read', 'memory:write', 'tool:invoke', 'knowledge:read', 'knowledge:write', 'knowledge:review', 'prompt:read', 'prompt:write', 'prompt:review')
ON CONFLICT DO NOTHING;

-- Admin role: reviewer + knowledge:publish, prompt:activate, user:manage, role:assign
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'admin' AND p.code IN ('chat:read', 'chat:write', 'memory:read', 'memory:write', 'memory:delete', 'tool:invoke', 'knowledge:read', 'knowledge:write', 'knowledge:review', 'knowledge:publish', 'prompt:read', 'prompt:write', 'prompt:review', 'prompt:activate', 'user:read', 'user:manage', 'role:assign')
ON CONFLICT DO NOTHING;

-- Auditor role: audit:read (read-only)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'auditor' AND p.code = 'audit:read'
ON CONFLICT DO NOTHING;

-- Super admin role: ALL permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'super_admin'
ON CONFLICT DO NOTHING;
