/**
 * File Upload Routes
 * API endpoints for file management
 */

import { Hono } from 'hono';
import type { Context } from 'hono';

import type { FileService } from '../../services/file.service.js';
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
 * Create file routes
 */
export function createFileRoutes(deps: { fileService: FileService }): Hono {
  const { fileService } = deps;
  const app = new Hono();

  // ─────────────────────────────────────────────────────────────
  // INITIATE UPLOAD
  // ─────────────────────────────────────────────────────────────

  /**
   * POST /files/initiate
   * Request a signed URL for file upload
   */
  app.post('/files/initiate', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);

    let body: {
      filename?: string;
      mimeType?: string;
      sizeBytes?: number;
    } = {};

    try {
      body = await c.req.json();
    } catch {
      body = {};
    }

    // Validate required fields
    if (!body.filename || typeof body.filename !== 'string') {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'filename is required',
            requestId,
          },
        },
        400
      );
    }

    if (!body.mimeType || typeof body.mimeType !== 'string') {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'mimeType is required',
            requestId,
          },
        },
        400
      );
    }

    if (typeof body.sizeBytes !== 'number' || body.sizeBytes <= 0) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'sizeBytes must be a positive number',
            requestId,
          },
        },
        400
      );
    }

    const result = await fileService.initiateUpload(actor, {
      filename: body.filename,
      mimeType: body.mimeType,
      sizeBytes: body.sizeBytes,
    });

    if (!result.success) {
      const statusCode =
        result.error.code === 'PERMISSION_DENIED'
          ? 403
          : result.error.code === 'QUOTA_EXCEEDED' ||
              result.error.code === 'FILE_TOO_LARGE'
            ? 413
            : 400;

      return c.json(
        {
          error: {
            code: result.error.code,
            message: result.error.message,
            requestId,
          },
        },
        statusCode
      );
    }

    return c.json(
      {
        data: {
          fileId: result.data.fileId,
          uploadUrl: result.data.uploadUrl,
          expiresAt: result.data.expiresAt.toISOString(),
        },
        meta: { requestId },
      },
      201
    );
  });

  // ─────────────────────────────────────────────────────────────
  // CONFIRM UPLOAD
  // ─────────────────────────────────────────────────────────────

  /**
   * POST /files/:id/confirm
   * Confirm that file upload is complete
   */
  app.post('/files/:id/confirm', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);
    const fileId = c.req.param('id');

    const result = await fileService.confirmUpload(actor, fileId);

    if (!result.success) {
      const statusCode =
        result.error.code === 'NOT_FOUND'
          ? 404
          : result.error.code === 'PERMISSION_DENIED'
            ? 403
            : 400;

      return c.json(
        {
          error: {
            code: result.error.code,
            message: result.error.message,
            requestId,
          },
        },
        statusCode
      );
    }

    return c.json({
      data: {
        id: result.data.id,
        filename: result.data.filename,
        mimeType: result.data.mimeType,
        sizeBytes: result.data.sizeBytes,
        status: result.data.status,
        createdAt: result.data.createdAt.toISOString(),
      },
      meta: { requestId },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // GET FILE
  // ─────────────────────────────────────────────────────────────

  /**
   * GET /files/:id
   * Get file metadata
   */
  app.get('/files/:id', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);
    const fileId = c.req.param('id');

    const result = await fileService.getFile(actor, fileId);

    if (!result.success) {
      const statusCode =
        result.error.code === 'NOT_FOUND'
          ? 404
          : result.error.code === 'PERMISSION_DENIED'
            ? 403
            : 400;

      return c.json(
        {
          error: {
            code: result.error.code,
            message: result.error.message,
            requestId,
          },
        },
        statusCode
      );
    }

    return c.json({
      data: {
        id: result.data.id,
        filename: result.data.filename,
        mimeType: result.data.mimeType,
        sizeBytes: result.data.sizeBytes,
        status: result.data.status,
        createdAt: result.data.createdAt.toISOString(),
        deletedAt: result.data.deletedAt?.toISOString() ?? null,
      },
      meta: { requestId },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // GET DOWNLOAD URL
  // ─────────────────────────────────────────────────────────────

  /**
   * GET /files/:id/download-url
   * Get a signed URL for downloading the file
   */
  app.get('/files/:id/download-url', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);
    const fileId = c.req.param('id');

    const result = await fileService.getDownloadUrl(actor, fileId);

    if (!result.success) {
      const statusCode =
        result.error.code === 'NOT_FOUND'
          ? 404
          : result.error.code === 'PERMISSION_DENIED'
            ? 403
            : 400;

      return c.json(
        {
          error: {
            code: result.error.code,
            message: result.error.message,
            requestId,
          },
        },
        statusCode
      );
    }

    return c.json({
      data: {
        url: result.data.url,
        expiresAt: result.data.expiresAt.toISOString(),
      },
      meta: { requestId },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // LIST FILES
  // ─────────────────────────────────────────────────────────────

  /**
   * GET /files
   * List files for the current user
   */
  app.get('/files', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);

    if (!actor.userId) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'User ID is required',
            requestId,
          },
        },
        400
      );
    }

    const cursor = c.req.query('cursor');
    const limit = parseInt(c.req.query('limit') ?? '20', 10);
    const status = c.req.query('status') as 'active' | 'deleted' | undefined;

    const listParams: {
      limit: number;
      cursor?: string;
      status?: 'active' | 'deleted';
    } = {
      limit: Math.min(limit, 100),
    };
    if (cursor) {
      listParams.cursor = cursor;
    }
    if (status) {
      listParams.status = status;
    }

    const result = await fileService.listFiles(actor, actor.userId, listParams);

    if (!result.success) {
      return c.json(
        {
          error: {
            code: result.error.code,
            message: result.error.message,
            requestId,
          },
        },
        400
      );
    }

    return c.json({
      data: {
        items: result.data.items.map((file) => ({
          id: file.id,
          filename: file.filename,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          status: file.status,
          createdAt: file.createdAt.toISOString(),
        })),
        nextCursor: result.data.nextCursor,
        hasMore: result.data.hasMore,
      },
      meta: { requestId },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // DELETE FILE
  // ─────────────────────────────────────────────────────────────

  /**
   * DELETE /files/:id
   * Soft delete a file
   */
  app.delete('/files/:id', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);
    const fileId = c.req.param('id');

    const result = await fileService.deleteFile(actor, fileId);

    if (!result.success) {
      const statusCode =
        result.error.code === 'NOT_FOUND'
          ? 404
          : result.error.code === 'PERMISSION_DENIED'
            ? 403
            : 400;

      return c.json(
        {
          error: {
            code: result.error.code,
            message: result.error.message,
            requestId,
          },
        },
        statusCode
      );
    }

    return c.json({
      data: { success: true },
      meta: { requestId },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // STORAGE USAGE
  // ─────────────────────────────────────────────────────────────

  /**
   * GET /storage-usage
   * Get storage usage for the current user
   */
  app.get('/storage-usage', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);

    if (!actor.userId) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'User ID is required',
            requestId,
          },
        },
        400
      );
    }

    const result = await fileService.getStorageUsage(actor, actor.userId);

    if (!result.success) {
      return c.json(
        {
          error: {
            code: result.error.code,
            message: result.error.message,
            requestId,
          },
        },
        400
      );
    }

    return c.json({
      data: {
        usedBytes: result.data.usedBytes,
        limitBytes: result.data.limitBytes,
        fileCount: result.data.fileCount,
      },
      meta: { requestId },
    });
  });

  return app;
}
