-- Migration: 009_tool_domain
-- Purpose: Create tool registry and invocation logging tables
-- Reference: docs/stage-2-service-layer.md Section 3.7
--
-- This migration creates:
-- 1. tool_registry table - Tool definitions and configuration
-- 2. tool_invocation_logs table - Tool execution logs for cost tracking
--
-- Relationships:
-- - tool_invocation_logs.tool_id → tool_registry.id
-- - tool_invocation_logs.user_id → users.id (TEXT)
-- - tool_invocation_logs.chat_id → chats.id (nullable)

-- ============================================================================
-- TOOL_REGISTRY TABLE
-- ============================================================================
-- Registry of available tools (local, MCP, n8n)

CREATE TABLE IF NOT EXISTS tool_registry (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Tool identification
    name                TEXT NOT NULL UNIQUE,
    description         TEXT NOT NULL,

    -- Tool type and configuration
    type                TEXT NOT NULL CHECK (type IN ('local', 'mcp', 'n8n')),
    config              JSONB NOT NULL DEFAULT '{}',

    -- Schema definitions (JSON Schema format)
    input_schema        JSONB NOT NULL DEFAULT '{}',
    output_schema       JSONB,

    -- Status and access control
    status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'disabled', 'deprecated')),
    requires_permission TEXT,           -- Permission needed to invoke (e.g., 'tool:web_search')

    -- Cost estimation for quota management
    estimated_cost      JSONB,          -- { tokens?: number, latencyMs?: number, apiCost?: number }

    -- Timestamps
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- TOOL_INVOCATION_LOGS TABLE
-- ============================================================================
-- Logs of tool executions for auditing and cost tracking

CREATE TABLE IF NOT EXISTS tool_invocation_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Tool reference
    tool_id         UUID NOT NULL REFERENCES tool_registry(id) ON DELETE CASCADE,
    tool_name       TEXT NOT NULL,      -- Denormalized for query performance

    -- Context
    chat_id         UUID REFERENCES chats(id) ON DELETE SET NULL,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_id      TEXT,               -- Request correlation ID

    -- Input/Output
    input           JSONB NOT NULL DEFAULT '{}',
    output          JSONB,

    -- Execution status
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'success', 'failure')),
    error_message   TEXT,

    -- Timing
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ,
    duration_ms     INTEGER,

    -- Actual cost (filled after execution)
    actual_cost     JSONB               -- { tokens?: number, latencyMs?: number, apiCost?: number }
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- tool_registry indexes
CREATE INDEX IF NOT EXISTS idx_tool_registry_name
    ON tool_registry(name);

CREATE INDEX IF NOT EXISTS idx_tool_registry_status
    ON tool_registry(status);

CREATE INDEX IF NOT EXISTS idx_tool_registry_type
    ON tool_registry(type, status);

-- tool_invocation_logs indexes
CREATE INDEX IF NOT EXISTS idx_tool_invocation_logs_tool_id
    ON tool_invocation_logs(tool_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_tool_invocation_logs_user_id
    ON tool_invocation_logs(user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_tool_invocation_logs_chat_id
    ON tool_invocation_logs(chat_id, started_at DESC)
    WHERE chat_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tool_invocation_logs_status
    ON tool_invocation_logs(status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_tool_invocation_logs_request_id
    ON tool_invocation_logs(request_id)
    WHERE request_id IS NOT NULL;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Auto-update updated_at for tool_registry
CREATE OR REPLACE FUNCTION update_tool_registry_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_tool_registry_updated_at
    BEFORE UPDATE ON tool_registry
    FOR EACH ROW
    EXECUTE FUNCTION update_tool_registry_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE tool_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_invocation_logs ENABLE ROW LEVEL SECURITY;

-- tool_registry: Anyone can view active tools
CREATE POLICY "Anyone can view active tools"
    ON tool_registry
    FOR SELECT
    USING (status = 'active');

-- tool_registry: Only admins can manage tools (enforced in service layer)
-- Service role bypasses RLS

-- tool_invocation_logs: Users can view their own invocations
CREATE POLICY "Users can view own invocations"
    ON tool_invocation_logs
    FOR SELECT
    USING (auth.uid()::text = user_id);

-- tool_invocation_logs: Users can create invocations for themselves
CREATE POLICY "Users can create own invocations"
    ON tool_invocation_logs
    FOR INSERT
    WITH CHECK (auth.uid()::text = user_id);

-- tool_invocation_logs: Users can update their own pending invocations
CREATE POLICY "Users can update own pending invocations"
    ON tool_invocation_logs
    FOR UPDATE
    USING (auth.uid()::text = user_id AND status = 'pending');

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE tool_registry IS 'Registry of available tools (local, MCP, n8n) with configuration and schemas';
COMMENT ON COLUMN tool_registry.name IS 'Unique tool identifier (e.g., web_search, calculator)';
COMMENT ON COLUMN tool_registry.type IS 'Tool execution type: local (in-process), mcp (Model Context Protocol), n8n (workflow)';
COMMENT ON COLUMN tool_registry.config IS 'Tool-specific configuration (endpoints, credentials, etc.)';
COMMENT ON COLUMN tool_registry.input_schema IS 'JSON Schema for tool input validation';
COMMENT ON COLUMN tool_registry.output_schema IS 'JSON Schema for tool output (optional)';
COMMENT ON COLUMN tool_registry.requires_permission IS 'Permission required to invoke this tool';
COMMENT ON COLUMN tool_registry.estimated_cost IS 'Estimated cost per invocation for quota planning';

COMMENT ON TABLE tool_invocation_logs IS 'Log of tool executions for auditing, debugging, and cost tracking';
COMMENT ON COLUMN tool_invocation_logs.tool_name IS 'Denormalized tool name for query performance';
COMMENT ON COLUMN tool_invocation_logs.request_id IS 'Request correlation ID for tracing';
COMMENT ON COLUMN tool_invocation_logs.actual_cost IS 'Actual cost after execution (tokens, latency, API cost)';
