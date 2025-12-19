-- Migration: Knowledge Categories
-- Description: Add dynamic knowledge categories management
-- Date: 2024-12-18

-- Knowledge categories table for organizing knowledge items
CREATE TABLE IF NOT EXISTS knowledge_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    color VARCHAR(20) DEFAULT '#6B7280', -- Default gray color
    icon VARCHAR(50), -- Optional icon identifier
    parent_id UUID REFERENCES knowledge_categories(id) ON DELETE SET NULL,
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_knowledge_categories_slug ON knowledge_categories(slug);
CREATE INDEX IF NOT EXISTS idx_knowledge_categories_parent ON knowledge_categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_categories_active ON knowledge_categories(is_active);
CREATE INDEX IF NOT EXISTS idx_knowledge_categories_sort ON knowledge_categories(sort_order);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_knowledge_categories_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_knowledge_categories_updated_at
    BEFORE UPDATE ON knowledge_categories
    FOR EACH ROW
    EXECUTE FUNCTION update_knowledge_categories_updated_at();

-- Insert default categories (matching the previously hardcoded ones)
INSERT INTO knowledge_categories (name, slug, description, color, sort_order) VALUES
    ('General', 'general', 'General information and guides', '#6B7280', 1),
    ('Technical Documentation', 'technical-docs', 'Technical documentation and API references', '#3B82F6', 2),
    ('Policies & Guidelines', 'policies', 'Company policies and guidelines', '#8B5CF6', 3),
    ('FAQ', 'faq', 'Frequently asked questions', '#10B981', 4),
    ('Tutorials', 'tutorials', 'Step-by-step tutorials and how-tos', '#F59E0B', 5),
    ('Announcements', 'announcements', 'Company announcements and news', '#EF4444', 6)
ON CONFLICT (slug) DO NOTHING;

-- Enable Row Level Security
ALTER TABLE knowledge_categories ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone authenticated can read active categories
CREATE POLICY "read_active_categories" ON knowledge_categories
    FOR SELECT
    USING (is_active = true);

-- Policy: Admin users can manage categories (insert, update, delete)
-- Note: This assumes admin check is done at application level via service role
CREATE POLICY "manage_categories" ON knowledge_categories
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- Add foreign key to knowledge_items to reference categories (optional, keeps backward compatibility)
-- We'll keep the category field as a string but also add a reference
ALTER TABLE knowledge_items
ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES knowledge_categories(id) ON DELETE SET NULL;

-- Create index for category_id
CREATE INDEX IF NOT EXISTS idx_knowledge_items_category_id ON knowledge_items(category_id);

-- Update existing knowledge items to link to categories based on their category slug
UPDATE knowledge_items ki
SET category_id = kc.id
FROM knowledge_categories kc
WHERE ki.category = kc.slug AND ki.category_id IS NULL;

COMMENT ON TABLE knowledge_categories IS 'Dynamic knowledge categories for organizing knowledge base content';
COMMENT ON COLUMN knowledge_categories.slug IS 'URL-friendly unique identifier';
COMMENT ON COLUMN knowledge_categories.color IS 'Hex color for UI display';
COMMENT ON COLUMN knowledge_categories.icon IS 'Icon identifier (e.g., heroicon name)';
COMMENT ON COLUMN knowledge_categories.parent_id IS 'Parent category for hierarchical organization';
