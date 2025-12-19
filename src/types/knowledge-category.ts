/**
 * Knowledge Category Types
 * Dynamic categories for organizing knowledge items
 */

/**
 * Knowledge category entity
 */
export interface KnowledgeCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  color: string;
  icon: string | null;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

/**
 * Parameters for creating a category
 */
export interface CreateKnowledgeCategoryParams {
  name: string;
  slug?: string; // Auto-generated from name if not provided
  description?: string;
  color?: string;
  icon?: string;
  parentId?: string;
  sortOrder?: number;
}

/**
 * Parameters for updating a category
 */
export interface UpdateKnowledgeCategoryParams {
  name?: string;
  slug?: string;
  description?: string;
  color?: string;
  icon?: string;
  parentId?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

/**
 * Category with item count (for list views)
 */
export interface KnowledgeCategoryWithCount extends KnowledgeCategory {
  itemCount: number;
}
