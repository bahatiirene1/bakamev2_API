-- Migration: 014_knowledge_vectors.sql
-- Purpose: Add vector embeddings for knowledge items (RAG)
-- Reference: docs/stage-2-service-layer.md Section 3.5
--
-- This migration creates:
-- 1. knowledge_vectors table - embeddings for semantic search
--
-- Follows same pattern as 005_memory_domain.sql memory_vectors
-- NOTE: Embeddings are generated asynchronously (AI-agnostic principle)

-- ============================================================================
-- KNOWLEDGE_VECTORS TABLE
-- ============================================================================
-- Stores embeddings for published knowledge items

CREATE TABLE IF NOT EXISTS knowledge_vectors (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Reference to knowledge item
    item_id         UUID NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,

    -- Chunk information (knowledge items may be chunked)
    chunk_index     INTEGER NOT NULL DEFAULT 0,
    chunk_content   TEXT NOT NULL,

    -- Vector embedding
    embedding       vector(1536),  -- OpenAI text-embedding-3-small default dimension
    model           TEXT NOT NULL,

    -- Timestamps
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Unique constraint: one embedding per chunk per item
    UNIQUE(item_id, chunk_index)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Foreign key lookup
CREATE INDEX IF NOT EXISTS idx_knowledge_vectors_item
    ON knowledge_vectors(item_id);

-- Vector similarity search index (ivfflat for cosine similarity)
-- Note: lists=100 is good for up to ~100k vectors, adjust for scale
CREATE INDEX IF NOT EXISTS idx_knowledge_vectors_embedding
    ON knowledge_vectors
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE knowledge_vectors ENABLE ROW LEVEL SECURITY;

-- Knowledge vectors: read via knowledge item ownership (published items only)
CREATE POLICY "Anyone can read vectors for published items"
    ON knowledge_vectors
    FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM knowledge_items ki
        WHERE ki.id = item_id AND ki.status = 'published'
    ));

-- Knowledge vectors: authors can read vectors for their own items
CREATE POLICY "Authors can read vectors for own items"
    ON knowledge_vectors
    FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM knowledge_items ki
        WHERE ki.id = item_id AND ki.author_id = auth.uid()::text
    ));

-- Knowledge vectors: insert via knowledge item ownership (for embedding service)
CREATE POLICY "Authors can insert vectors for own items"
    ON knowledge_vectors
    FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM knowledge_items ki
        WHERE ki.id = item_id AND ki.author_id = auth.uid()::text
    ));

-- Knowledge vectors: system can insert for any item (via service role)
-- Note: Service role bypasses RLS, this is for documentation

-- Knowledge vectors: delete via knowledge item ownership (for re-embedding)
CREATE POLICY "Authors can delete vectors for own items"
    ON knowledge_vectors
    FOR DELETE
    USING (EXISTS (
        SELECT 1 FROM knowledge_items ki
        WHERE ki.id = item_id AND ki.author_id = auth.uid()::text
    ));

-- ============================================================================
-- FUNCTION: Search knowledge by vector similarity
-- ============================================================================
-- This function performs cosine similarity search on knowledge vectors

CREATE OR REPLACE FUNCTION search_knowledge_vectors(
    query_embedding vector(1536),
    match_threshold FLOAT DEFAULT 0.7,
    match_count INT DEFAULT 5,
    filter_categories TEXT[] DEFAULT NULL
)
RETURNS TABLE (
    item_id UUID,
    chunk_index INTEGER,
    chunk_content TEXT,
    similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        kv.item_id,
        kv.chunk_index,
        kv.chunk_content,
        1 - (kv.embedding <=> query_embedding) AS similarity
    FROM knowledge_vectors kv
    JOIN knowledge_items ki ON ki.id = kv.item_id
    WHERE ki.status = 'published'
    AND (filter_categories IS NULL OR ki.category = ANY(filter_categories))
    AND 1 - (kv.embedding <=> query_embedding) > match_threshold
    ORDER BY kv.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- ============================================================================
-- FUNCTION: Search memory by vector similarity
-- ============================================================================
-- Similar function for memories (if not already exists)

CREATE OR REPLACE FUNCTION search_memory_vectors(
    p_user_id TEXT,
    query_embedding vector(1536),
    match_threshold FLOAT DEFAULT 0.7,
    match_count INT DEFAULT 10
)
RETURNS TABLE (
    memory_id UUID,
    content TEXT,
    category TEXT,
    importance INTEGER,
    similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        m.id AS memory_id,
        m.content,
        m.category,
        m.importance,
        1 - (mv.embedding <=> query_embedding) AS similarity
    FROM memory_vectors mv
    JOIN memories m ON m.id = mv.memory_id
    WHERE m.user_id = p_user_id
    AND m.status = 'active'
    AND 1 - (mv.embedding <=> query_embedding) > match_threshold
    ORDER BY mv.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE knowledge_vectors IS 'Vector embeddings for knowledge items, enabling semantic search (RAG)';
COMMENT ON COLUMN knowledge_vectors.item_id IS 'Reference to the knowledge item';
COMMENT ON COLUMN knowledge_vectors.chunk_index IS 'Index of this chunk (0 for single-chunk items)';
COMMENT ON COLUMN knowledge_vectors.chunk_content IS 'Text content of this chunk';
COMMENT ON COLUMN knowledge_vectors.embedding IS 'Vector embedding (1536 dimensions for text-embedding-3-small)';
COMMENT ON COLUMN knowledge_vectors.model IS 'Model used to generate embedding';

COMMENT ON FUNCTION search_knowledge_vectors IS 'Semantic search over published knowledge items using cosine similarity';
COMMENT ON FUNCTION search_memory_vectors IS 'Semantic search over user memories using cosine similarity';
