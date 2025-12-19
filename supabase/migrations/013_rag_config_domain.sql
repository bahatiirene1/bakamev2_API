-- Migration: 013_rag_config_domain.sql
-- Purpose: Create rag_configs table for admin-configurable RAG/Memory settings
-- Reference: docs/stage-4-ai-orchestrator.md Section 2.4 (Layer 4: Retrieved Context)
--
-- This migration creates:
-- 1. rag_configs table - Admin-configurable RAG parameters
--
-- Design Rationale:
-- - RAG settings (token budgets, retrieval limits, similarity thresholds) should be
--   configurable by admins without code changes
-- - Only one config can be active at a time (like system_prompts)
-- - Follows same governance pattern as system_prompts for consistency
-- - Enables A/B testing different retrieval strategies

-- ============================================================================
-- RAG_CONFIGS TABLE
-- ============================================================================
-- Configuration for RAG (Retrieval Augmented Generation) behavior

CREATE TABLE IF NOT EXISTS rag_configs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identity
    name            TEXT NOT NULL,
    description     TEXT,

    -- =========================================================================
    -- TOKEN BUDGETS
    -- How many tokens to allocate for each context layer
    -- =========================================================================
    memory_token_budget     INTEGER NOT NULL DEFAULT 2000
                            CHECK (memory_token_budget >= 0 AND memory_token_budget <= 32000),
    knowledge_token_budget  INTEGER NOT NULL DEFAULT 4000
                            CHECK (knowledge_token_budget >= 0 AND knowledge_token_budget <= 32000),
    conversation_token_budget INTEGER NOT NULL DEFAULT 4000
                            CHECK (conversation_token_budget >= 0 AND conversation_token_budget <= 32000),

    -- =========================================================================
    -- RETRIEVAL LIMITS
    -- How many items to retrieve from each source
    -- =========================================================================
    memory_limit            INTEGER NOT NULL DEFAULT 10
                            CHECK (memory_limit >= 1 AND memory_limit <= 100),
    knowledge_limit         INTEGER NOT NULL DEFAULT 5
                            CHECK (knowledge_limit >= 1 AND knowledge_limit <= 50),

    -- Minimum similarity threshold for retrieval (0.0 - 1.0)
    min_similarity          NUMERIC(3,2) NOT NULL DEFAULT 0.70
                            CHECK (min_similarity >= 0.0 AND min_similarity <= 1.0),

    -- =========================================================================
    -- RERANKING WEIGHTS
    -- How to score and order retrieved items (must sum to ~1.0)
    -- Final score = (importance * importance_weight) + (similarity * similarity_weight) + (recency * recency_weight)
    -- =========================================================================
    importance_weight       NUMERIC(3,2) NOT NULL DEFAULT 0.30
                            CHECK (importance_weight >= 0.0 AND importance_weight <= 1.0),
    similarity_weight       NUMERIC(3,2) NOT NULL DEFAULT 0.50
                            CHECK (similarity_weight >= 0.0 AND similarity_weight <= 1.0),
    recency_weight          NUMERIC(3,2) NOT NULL DEFAULT 0.20
                            CHECK (recency_weight >= 0.0 AND recency_weight <= 1.0),

    -- =========================================================================
    -- EMBEDDING CONFIGURATION
    -- Which model to use for generating embeddings
    -- =========================================================================
    embedding_model         TEXT NOT NULL DEFAULT 'text-embedding-3-small',
    embedding_dimensions    INTEGER NOT NULL DEFAULT 1536
                            CHECK (embedding_dimensions >= 256 AND embedding_dimensions <= 4096),

    -- =========================================================================
    -- MEMORY EXTRACTION SETTINGS
    -- Controls automatic memory extraction from conversations
    -- =========================================================================
    extraction_enabled      BOOLEAN NOT NULL DEFAULT true,
    extraction_prompt       TEXT,  -- Custom prompt for LLM-based extraction (null = use default)

    -- Categories for extracted memories
    memory_categories       JSONB NOT NULL DEFAULT '["preference", "fact", "event", "instruction"]'::jsonb,

    -- =========================================================================
    -- CONSOLIDATION SETTINGS
    -- Controls memory consolidation/deduplication behavior
    -- =========================================================================
    consolidation_enabled   BOOLEAN NOT NULL DEFAULT true,
    consolidation_threshold NUMERIC(3,2) NOT NULL DEFAULT 0.85
                            CHECK (consolidation_threshold >= 0.5 AND consolidation_threshold <= 1.0),

    -- =========================================================================
    -- STATUS & GOVERNANCE
    -- =========================================================================
    is_active               BOOLEAN NOT NULL DEFAULT false,

    -- Governance (simplified - no approval workflow, just admin-managed)
    author_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Timestamps
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    activated_at            TIMESTAMPTZ
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Only one active config at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_rag_configs_single_active
    ON rag_configs(is_active)
    WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_rag_configs_active
    ON rag_configs(activated_at DESC)
    WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_rag_configs_author
    ON rag_configs(author_id);

CREATE INDEX IF NOT EXISTS idx_rag_configs_created
    ON rag_configs(created_at DESC);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_rag_configs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_rag_configs_updated_at
    BEFORE UPDATE ON rag_configs
    FOR EACH ROW
    EXECUTE FUNCTION update_rag_configs_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE rag_configs ENABLE ROW LEVEL SECURITY;

-- Anyone with rag:read can view active config
CREATE POLICY "Anyone can view active rag config"
    ON rag_configs
    FOR SELECT
    USING (is_active = true);

-- Authors can view their own configs
CREATE POLICY "Authors can view own rag configs"
    ON rag_configs
    FOR SELECT
    USING (auth.uid()::text = author_id);

-- Only admins can insert/update (via service layer with service_role key)
-- No direct INSERT/UPDATE policies - all modifications go through service layer

-- ============================================================================
-- PERMISSIONS
-- ============================================================================

-- Add RAG config permissions
INSERT INTO permissions (code, description, category)
VALUES
    ('rag:read', 'Read RAG configurations', 'rag'),
    ('rag:write', 'Create and edit RAG configurations', 'rag'),
    ('rag:activate', 'Activate RAG configurations', 'rag')
ON CONFLICT (code) DO NOTHING;

-- Grant rag:read to user role (they can see active config)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'user' AND p.code = 'rag:read'
ON CONFLICT DO NOTHING;

-- Grant all RAG permissions to admin role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'admin' AND p.code IN ('rag:read', 'rag:write', 'rag:activate')
ON CONFLICT DO NOTHING;

-- Grant all RAG permissions to super_admin role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'super_admin' AND p.code IN ('rag:read', 'rag:write', 'rag:activate')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- DEFAULT CONFIG
-- ============================================================================
-- Insert a default RAG config that's immediately active
-- Uses SYSTEM_ACTOR_ID from 010_system_actors.sql

INSERT INTO rag_configs (
    name,
    description,
    is_active,
    activated_at,
    author_id
)
SELECT
    'default',
    'Default RAG configuration with balanced settings',
    true,
    now(),
    id
FROM users
WHERE id = '00000000-0000-0000-0000-000000000001'  -- SYSTEM_ACTOR_ID
ON CONFLICT DO NOTHING;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE rag_configs IS 'Admin-configurable RAG (Retrieval Augmented Generation) settings';
COMMENT ON COLUMN rag_configs.memory_token_budget IS 'Token budget for user memories in context';
COMMENT ON COLUMN rag_configs.knowledge_token_budget IS 'Token budget for knowledge base items in context';
COMMENT ON COLUMN rag_configs.conversation_token_budget IS 'Token budget for conversation history in context';
COMMENT ON COLUMN rag_configs.memory_limit IS 'Maximum number of memories to retrieve';
COMMENT ON COLUMN rag_configs.knowledge_limit IS 'Maximum number of knowledge items to retrieve';
COMMENT ON COLUMN rag_configs.min_similarity IS 'Minimum cosine similarity threshold (0.0-1.0)';
COMMENT ON COLUMN rag_configs.importance_weight IS 'Weight for memory importance in ranking';
COMMENT ON COLUMN rag_configs.similarity_weight IS 'Weight for similarity score in ranking';
COMMENT ON COLUMN rag_configs.recency_weight IS 'Weight for recency in ranking';
COMMENT ON COLUMN rag_configs.embedding_model IS 'OpenAI embedding model to use';
COMMENT ON COLUMN rag_configs.embedding_dimensions IS 'Vector dimensions for embeddings';
COMMENT ON COLUMN rag_configs.extraction_enabled IS 'Whether to auto-extract memories from conversations';
COMMENT ON COLUMN rag_configs.extraction_prompt IS 'Custom prompt for memory extraction (null = default)';
COMMENT ON COLUMN rag_configs.memory_categories IS 'JSON array of valid memory categories';
COMMENT ON COLUMN rag_configs.consolidation_enabled IS 'Whether to consolidate/dedupe similar memories';
COMMENT ON COLUMN rag_configs.consolidation_threshold IS 'Similarity threshold for consolidation (0.5-1.0)';
COMMENT ON COLUMN rag_configs.is_active IS 'Whether this config is currently active (only one can be true)';
