/**
 * Knowledge Categories Routes
 * Admin endpoints for managing knowledge categories
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { Hono } from 'hono';
import type { Context } from 'hono';

import { KnowledgeCategoryDbAdapter } from '../../services/knowledge-category.db.js';
import type { ActorContext } from '../../types/index.js';

/**
 * Helper to get actor from context
 */
function getActor(c: Context): ActorContext {
  return c.get('actor');
}

/**
 * Helper to get request ID from context
 */
function getRequestId(c: Context): string {
  return c.get('requestId') || getActor(c).requestId;
}

/**
 * Create knowledge categories routes
 */
export function createKnowledgeCategoriesRoutes(
  supabase: SupabaseClient
): Hono {
  const app = new Hono();
  const categoryDb = new KnowledgeCategoryDbAdapter(supabase);

  // ─────────────────────────────────────────────────────────────
  // LIST CATEGORIES
  // ─────────────────────────────────────────────────────────────

  /**
   * GET /knowledge-categories
   * List all knowledge categories
   */
  app.get('/knowledge-categories', async (c) => {
    const requestId = getRequestId(c);
    const includeInactive = c.req.query('includeInactive') === 'true';
    const withCounts = c.req.query('withCounts') === 'true';

    try {
      const categories = withCounts
        ? await categoryDb.listWithCounts(!includeInactive)
        : await categoryDb.list(!includeInactive);

      return c.json({
        data: categories.map((cat) => ({
          id: cat.id,
          name: cat.name,
          slug: cat.slug,
          description: cat.description,
          color: cat.color,
          icon: cat.icon,
          parentId: cat.parentId,
          sortOrder: cat.sortOrder,
          isActive: cat.isActive,
          createdAt: cat.createdAt.toISOString(),
          updatedAt: cat.updatedAt.toISOString(),
          ...('itemCount' in cat ? { itemCount: cat.itemCount } : {}),
        })),
        meta: { requestId },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message,
            requestId,
          },
        },
        500
      );
    }
  });

  // ─────────────────────────────────────────────────────────────
  // GET SINGLE CATEGORY
  // ─────────────────────────────────────────────────────────────

  /**
   * GET /knowledge-categories/:id
   * Get a single category by ID
   */
  app.get('/knowledge-categories/:id', async (c) => {
    const requestId = getRequestId(c);
    const categoryId = c.req.param('id');

    try {
      const category = await categoryDb.getById(categoryId);

      if (!category) {
        return c.json(
          {
            error: {
              code: 'NOT_FOUND',
              message: 'Category not found',
              requestId,
            },
          },
          404
        );
      }

      return c.json({
        data: {
          id: category.id,
          name: category.name,
          slug: category.slug,
          description: category.description,
          color: category.color,
          icon: category.icon,
          parentId: category.parentId,
          sortOrder: category.sortOrder,
          isActive: category.isActive,
          createdAt: category.createdAt.toISOString(),
          updatedAt: category.updatedAt.toISOString(),
        },
        meta: { requestId },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message,
            requestId,
          },
        },
        500
      );
    }
  });

  // ─────────────────────────────────────────────────────────────
  // CREATE CATEGORY
  // ─────────────────────────────────────────────────────────────

  /**
   * POST /knowledge-categories
   * Create a new category
   */
  app.post('/knowledge-categories', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);

    let body: {
      name?: string;
      slug?: string;
      description?: string;
      color?: string;
      icon?: string;
      parentId?: string;
      sortOrder?: number;
    } = {};

    try {
      body = await c.req.json();
    } catch {
      body = {};
    }

    // Validate required fields
    if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'name is required',
            requestId,
          },
        },
        400
      );
    }

    try {
      // Build params object, only including defined values
      const createParams: Parameters<typeof categoryDb.create>[0] = {
        name: body.name.trim(),
      };
      if (body.slug) {
        createParams.slug = body.slug.trim();
      }
      if (body.description) {
        createParams.description = body.description.trim();
      }
      if (body.color) {
        createParams.color = body.color;
      }
      if (body.icon) {
        createParams.icon = body.icon;
      }
      if (body.parentId) {
        createParams.parentId = body.parentId;
      }
      if (body.sortOrder !== undefined) {
        createParams.sortOrder = body.sortOrder;
      }

      const category = await categoryDb.create(
        createParams,
        actor.type === 'user' ? actor.userId : undefined
      );

      return c.json(
        {
          data: {
            id: category.id,
            name: category.name,
            slug: category.slug,
            description: category.description,
            color: category.color,
            icon: category.icon,
            parentId: category.parentId,
            sortOrder: category.sortOrder,
            isActive: category.isActive,
            createdAt: category.createdAt.toISOString(),
            updatedAt: category.updatedAt.toISOString(),
          },
          meta: { requestId },
        },
        201
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      // Check for duplicate slug error
      if (message.includes('duplicate') || message.includes('unique')) {
        return c.json(
          {
            error: {
              code: 'DUPLICATE_ERROR',
              message: 'A category with this slug already exists',
              requestId,
            },
          },
          409
        );
      }

      return c.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message,
            requestId,
          },
        },
        500
      );
    }
  });

  // ─────────────────────────────────────────────────────────────
  // UPDATE CATEGORY
  // ─────────────────────────────────────────────────────────────

  /**
   * PATCH /knowledge-categories/:id
   * Update a category
   */
  app.patch('/knowledge-categories/:id', async (c) => {
    const requestId = getRequestId(c);
    const categoryId = c.req.param('id');

    let body: {
      name?: string;
      slug?: string;
      description?: string;
      color?: string;
      icon?: string;
      parentId?: string | null;
      sortOrder?: number;
      isActive?: boolean;
    } = {};

    try {
      body = await c.req.json();
    } catch {
      body = {};
    }

    try {
      // Check if category exists
      const existing = await categoryDb.getById(categoryId);
      if (!existing) {
        return c.json(
          {
            error: {
              code: 'NOT_FOUND',
              message: 'Category not found',
              requestId,
            },
          },
          404
        );
      }

      // Build update params, only including defined values
      const updateParams: Parameters<typeof categoryDb.update>[1] = {};
      if (body.name !== undefined) {
        updateParams.name = body.name.trim();
      }
      if (body.slug !== undefined) {
        updateParams.slug = body.slug.trim();
      }
      if (body.description !== undefined) {
        updateParams.description = body.description.trim();
      }
      if (body.color !== undefined) {
        updateParams.color = body.color;
      }
      if (body.icon !== undefined) {
        updateParams.icon = body.icon;
      }
      if (body.parentId !== undefined) {
        updateParams.parentId = body.parentId;
      }
      if (body.sortOrder !== undefined) {
        updateParams.sortOrder = body.sortOrder;
      }
      if (body.isActive !== undefined) {
        updateParams.isActive = body.isActive;
      }

      const category = await categoryDb.update(categoryId, updateParams);

      return c.json({
        data: {
          id: category.id,
          name: category.name,
          slug: category.slug,
          description: category.description,
          color: category.color,
          icon: category.icon,
          parentId: category.parentId,
          sortOrder: category.sortOrder,
          isActive: category.isActive,
          createdAt: category.createdAt.toISOString(),
          updatedAt: category.updatedAt.toISOString(),
        },
        meta: { requestId },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      if (message.includes('duplicate') || message.includes('unique')) {
        return c.json(
          {
            error: {
              code: 'DUPLICATE_ERROR',
              message: 'A category with this slug already exists',
              requestId,
            },
          },
          409
        );
      }

      return c.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message,
            requestId,
          },
        },
        500
      );
    }
  });

  // ─────────────────────────────────────────────────────────────
  // DELETE CATEGORY
  // ─────────────────────────────────────────────────────────────

  /**
   * DELETE /knowledge-categories/:id
   * Delete a category (soft delete by default, hard delete with ?hard=true)
   */
  app.delete('/knowledge-categories/:id', async (c) => {
    const requestId = getRequestId(c);
    const categoryId = c.req.param('id');
    const hardDelete = c.req.query('hard') === 'true';

    try {
      // Check if category exists
      const existing = await categoryDb.getById(categoryId);
      if (!existing) {
        return c.json(
          {
            error: {
              code: 'NOT_FOUND',
              message: 'Category not found',
              requestId,
            },
          },
          404
        );
      }

      if (hardDelete) {
        await categoryDb.hardDelete(categoryId);
      } else {
        await categoryDb.softDelete(categoryId);
      }

      return c.json({
        data: { success: true },
        meta: { requestId },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      // Check if category is in use
      if (message.includes('knowledge items still use it')) {
        return c.json(
          {
            error: {
              code: 'CATEGORY_IN_USE',
              message,
              requestId,
            },
          },
          409
        );
      }

      return c.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message,
            requestId,
          },
        },
        500
      );
    }
  });

  // ─────────────────────────────────────────────────────────────
  // REORDER CATEGORIES
  // ─────────────────────────────────────────────────────────────

  /**
   * POST /knowledge-categories/reorder
   * Reorder categories by providing an array of category IDs
   */
  app.post('/knowledge-categories/reorder', async (c) => {
    const requestId = getRequestId(c);

    let body: { categoryIds?: string[] } = {};

    try {
      body = await c.req.json();
    } catch {
      body = {};
    }

    if (!body.categoryIds || !Array.isArray(body.categoryIds)) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'categoryIds array is required',
            requestId,
          },
        },
        400
      );
    }

    try {
      await categoryDb.reorder(body.categoryIds);

      return c.json({
        data: { success: true },
        meta: { requestId },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message,
            requestId,
          },
        },
        500
      );
    }
  });

  return app;
}
