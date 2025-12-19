/**
 * Knowledge Upload Routes
 * Endpoints for uploading documents to create knowledge items
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { Hono } from 'hono';
import type { Context } from 'hono';

import {
  parseDocument,
  isSupportedDocumentType,
  SUPPORTED_DOCUMENT_TYPES,
} from '../../services/document-parser.service.js';
import type { ActorContext } from '../../types/index.js';

// Max file size for direct upload (10MB)
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;

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
 * Create knowledge upload routes
 */
export function createKnowledgeUploadRoutes(supabase: SupabaseClient): Hono {
  const app = new Hono();

  // ─────────────────────────────────────────────────────────────
  // GET SUPPORTED TYPES
  // ─────────────────────────────────────────────────────────────

  /**
   * GET /knowledge/upload/supported-types
   * Get list of supported document types for upload
   */
  app.get('/knowledge/upload/supported-types', (c) => {
    const requestId = getRequestId(c);

    return c.json({
      data: {
        mimeTypes: SUPPORTED_DOCUMENT_TYPES,
        extensions: ['.pdf', '.docx', '.doc', '.txt', '.md', '.csv'],
        maxSizeBytes: MAX_UPLOAD_SIZE,
      },
      meta: { requestId },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // PARSE DOCUMENT
  // ─────────────────────────────────────────────────────────────

  /**
   * POST /knowledge/upload/parse
   * Upload and parse a document, returning extracted text
   * This is a preview endpoint - doesn't create a knowledge item
   */
  app.post('/knowledge/upload/parse', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);

    // Check if actor is authenticated
    if (!actor.userId) {
      return c.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
            requestId,
          },
        },
        401
      );
    }

    try {
      // Parse multipart form data
      const formData = await c.req.formData();
      const file = formData.get('file');

      if (!file || !(file instanceof File)) {
        return c.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'No file provided',
              requestId,
            },
          },
          400
        );
      }

      // Check file size
      if (file.size > MAX_UPLOAD_SIZE) {
        return c.json(
          {
            error: {
              code: 'FILE_TOO_LARGE',
              message: `File exceeds maximum size of ${MAX_UPLOAD_SIZE / 1024 / 1024}MB`,
              requestId,
            },
          },
          413
        );
      }

      // Check mime type
      if (!isSupportedDocumentType(file.type)) {
        return c.json(
          {
            error: {
              code: 'UNSUPPORTED_TYPE',
              message: `File type ${file.type} is not supported`,
              requestId,
            },
          },
          415
        );
      }

      // Read file buffer
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Parse document
      const parsed = await parseDocument(buffer, file.type);

      return c.json({
        data: {
          filename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          text: parsed.text,
          metadata: parsed.metadata,
          parseTime: parsed.parseTime,
        },
        meta: { requestId },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      return c.json(
        {
          error: {
            code: 'PARSE_ERROR',
            message,
            requestId,
          },
        },
        500
      );
    }
  });

  // ─────────────────────────────────────────────────────────────
  // UPLOAD AND CREATE KNOWLEDGE ITEM
  // ─────────────────────────────────────────────────────────────

  /**
   * POST /knowledge/upload
   * Upload a document and create a knowledge item from it
   */
  app.post('/knowledge/upload', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);

    // Check if actor is authenticated
    if (!actor.userId) {
      return c.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
            requestId,
          },
        },
        401
      );
    }

    try {
      // Parse multipart form data
      const formData = await c.req.formData();
      const file = formData.get('file');
      const title = formData.get('title');
      const category = formData.get('category');

      if (!file || !(file instanceof File)) {
        return c.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'No file provided',
              requestId,
            },
          },
          400
        );
      }

      // Check file size
      if (file.size > MAX_UPLOAD_SIZE) {
        return c.json(
          {
            error: {
              code: 'FILE_TOO_LARGE',
              message: `File exceeds maximum size of ${MAX_UPLOAD_SIZE / 1024 / 1024}MB`,
              requestId,
            },
          },
          413
        );
      }

      // Check mime type
      if (!isSupportedDocumentType(file.type)) {
        return c.json(
          {
            error: {
              code: 'UNSUPPORTED_TYPE',
              message: `File type ${file.type} is not supported`,
              requestId,
            },
          },
          415
        );
      }

      // Read file buffer
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Parse document
      const parsed = await parseDocument(buffer, file.type);

      // Use provided title or generate from filename
      const itemTitle =
        typeof title === 'string' && title.trim()
          ? title.trim()
          : file.name.replace(/\.[^/.]+$/, ''); // Remove extension

      // Create knowledge item
      const { data: knowledgeItem, error: insertError } = await supabase
        .from('knowledge_items')
        .insert({
          title: itemTitle,
          content: parsed.text,
          category:
            typeof category === 'string' && category !== '' ? category : null,
          metadata: {
            sourceType: 'document',
            originalFilename: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
            ...parsed.metadata,
          },
          status: 'draft',
          author_id: actor.userId,
          version: 1,
        })
        .select()
        .single();

      if (insertError) {
        throw new Error(
          `Failed to create knowledge item: ${insertError.message}`
        );
      }

      return c.json(
        {
          data: {
            id: knowledgeItem.id,
            title: knowledgeItem.title,
            category: knowledgeItem.category,
            status: knowledgeItem.status,
            contentLength: parsed.text.length,
            wordCount: parsed.metadata.wordCount,
            sourceFile: {
              filename: file.name,
              mimeType: file.type,
              sizeBytes: file.size,
            },
            createdAt: knowledgeItem.created_at,
          },
          meta: { requestId },
        },
        201
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      return c.json(
        {
          error: {
            code: 'UPLOAD_ERROR',
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
