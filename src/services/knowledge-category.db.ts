/**
 * Knowledge Category Database Adapter
 * Supabase implementation for category CRUD operations
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  KnowledgeCategory,
  KnowledgeCategoryWithCount,
  CreateKnowledgeCategoryParams,
  UpdateKnowledgeCategoryParams,
} from '../types/knowledge-category.js';

/**
 * Database row type (snake_case)
 */
interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  color: string;
  icon: string | null;
  parent_id: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

/**
 * Convert database row to domain entity
 */
function rowToCategory(row: CategoryRow): KnowledgeCategory {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    color: row.color,
    icon: row.icon,
    parentId: row.parent_id,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    createdBy: row.created_by,
  };
}

/**
 * Generate slug from name
 */
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export class KnowledgeCategoryDbAdapter {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Create a new category
   */
  async create(
    params: CreateKnowledgeCategoryParams,
    createdBy?: string
  ): Promise<KnowledgeCategory> {
    const slug =
      params.slug !== null && params.slug !== undefined && params.slug !== ''
        ? params.slug
        : generateSlug(params.name);

    const { data, error } = await this.supabase
      .from('knowledge_categories')
      .insert({
        name: params.name,
        slug,
        description: params.description ?? null,
        color: params.color ?? '#6B7280',
        icon: params.icon ?? null,
        parent_id: params.parentId ?? null,
        sort_order: params.sortOrder ?? 0,
        created_by: createdBy ?? null,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create category: ${error.message}`);
    }

    return rowToCategory(data as CategoryRow);
  }

  /**
   * Get category by ID
   */
  async getById(id: string): Promise<KnowledgeCategory | null> {
    const { data, error } = await this.supabase
      .from('knowledge_categories')
      .select()
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      } // Not found
      throw new Error(`Failed to get category: ${error.message}`);
    }

    return rowToCategory(data as CategoryRow);
  }

  /**
   * Get category by slug
   */
  async getBySlug(slug: string): Promise<KnowledgeCategory | null> {
    const { data, error } = await this.supabase
      .from('knowledge_categories')
      .select()
      .eq('slug', slug)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      } // Not found
      throw new Error(`Failed to get category: ${error.message}`);
    }

    return rowToCategory(data as CategoryRow);
  }

  /**
   * List all categories (with optional filter for active only)
   */
  async list(activeOnly = true): Promise<KnowledgeCategory[]> {
    let query = this.supabase
      .from('knowledge_categories')
      .select()
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (activeOnly) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to list categories: ${error.message}`);
    }

    return (data as CategoryRow[]).map(rowToCategory);
  }

  /**
   * List categories with item counts
   */
  async listWithCounts(
    activeOnly = true
  ): Promise<KnowledgeCategoryWithCount[]> {
    // First get categories
    const categories = await this.list(activeOnly);

    // Then get counts for each category
    const { data: counts, error } = await this.supabase
      .from('knowledge_items')
      .select('category_id')
      .not('category_id', 'is', null);

    if (error) {
      throw new Error(`Failed to get category counts: ${error.message}`);
    }

    // Count items per category
    const countMap = new Map<string, number>();
    for (const item of counts ?? []) {
      const categoryId = item.category_id as string;
      countMap.set(categoryId, (countMap.get(categoryId) ?? 0) + 1);
    }

    return categories.map((cat) => ({
      ...cat,
      itemCount: countMap.get(cat.id) ?? 0,
    }));
  }

  /**
   * Update a category
   */
  async update(
    id: string,
    params: UpdateKnowledgeCategoryParams
  ): Promise<KnowledgeCategory> {
    const updateData: Record<string, unknown> = {};

    if (params.name !== undefined) {
      updateData.name = params.name;
    }
    if (params.slug !== undefined) {
      updateData.slug = params.slug;
    }
    if (params.description !== undefined) {
      updateData.description = params.description;
    }
    if (params.color !== undefined) {
      updateData.color = params.color;
    }
    if (params.icon !== undefined) {
      updateData.icon = params.icon;
    }
    if (params.parentId !== undefined) {
      updateData.parent_id = params.parentId;
    }
    if (params.sortOrder !== undefined) {
      updateData.sort_order = params.sortOrder;
    }
    if (params.isActive !== undefined) {
      updateData.is_active = params.isActive;
    }

    const { data, error } = await this.supabase
      .from('knowledge_categories')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update category: ${error.message}`);
    }

    return rowToCategory(data as CategoryRow);
  }

  /**
   * Delete a category (soft delete by setting is_active = false)
   */
  async softDelete(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('knowledge_categories')
      .update({ is_active: false })
      .eq('id', id);

    if (error) {
      throw new Error(`Failed to delete category: ${error.message}`);
    }
  }

  /**
   * Hard delete a category (only if no items use it)
   */
  async hardDelete(id: string): Promise<void> {
    // First check if any items use this category
    const { count, error: countError } = await this.supabase
      .from('knowledge_items')
      .select('id', { count: 'exact', head: true })
      .eq('category_id', id);

    if (countError) {
      throw new Error(`Failed to check category usage: ${countError.message}`);
    }

    if (count !== null && count > 0) {
      throw new Error(
        `Cannot delete category: ${count} knowledge items still use it`
      );
    }

    const { error } = await this.supabase
      .from('knowledge_categories')
      .delete()
      .eq('id', id);

    if (error) {
      throw new Error(`Failed to delete category: ${error.message}`);
    }
  }

  /**
   * Reorder categories
   */
  async reorder(categoryIds: string[]): Promise<void> {
    // Update sort_order for each category based on position in array
    for (let i = 0; i < categoryIds.length; i++) {
      const { error } = await this.supabase
        .from('knowledge_categories')
        .update({ sort_order: i + 1 })
        .eq('id', categoryIds[i]);

      if (error) {
        throw new Error(`Failed to reorder categories: ${error.message}`);
      }
    }
  }
}
