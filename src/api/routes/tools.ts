/**
 * Tool Routes
 * Endpoints for available tools discovery
 *
 * Reference: docs/stage-3b-expand-api.md Section 7
 */

import type { Context } from 'hono';
import { Hono } from 'hono';

import type { ActorContext, Result } from '@/types/index.js';

import { errorResponse } from '../utils/response.js';

/**
 * Tool definition (simplified for API)
 */
interface Tool {
  id: string;
  name: string;
  description: string;
  type: 'local' | 'mcp' | 'n8n';
  enabled: boolean;
  requiresPermission: string | null;
  inputSchema: Record<string, unknown>;
  rateLimit?: { maxPerHour: number };
}

/**
 * Tool service interface (minimal for routes)
 */
interface ToolServiceDep {
  listAvailableTools: (
    actor: ActorContext,
    params?: { type?: string; enabled?: boolean }
  ) => Promise<Result<Tool[]>>;
  getTool: (actor: ActorContext, toolId: string) => Promise<Result<Tool>>;
}

interface ToolRoutesDeps {
  toolService: ToolServiceDep;
}

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
 * Parse boolean query param
 */
function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value === 'true';
}

/**
 * Create tool routes
 */
export function createToolRoutes(deps: ToolRoutesDeps): Hono {
  const { toolService } = deps;
  const app = new Hono();

  /**
   * GET /tools
   * List available tools
   */
  app.get('/tools', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);

    const type = c.req.query('type');
    const enabled = parseBoolean(c.req.query('enabled'));

    const result = await toolService.listAvailableTools(actor, {
      ...(type !== undefined && { type }),
      ...(enabled !== undefined && { enabled }),
    });

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json({
      data: result.data,
      meta: { requestId },
    });
  });

  /**
   * GET /tools/:id
   * Get tool details
   */
  app.get('/tools/:id', async (c) => {
    const actor = getActor(c);
    const requestId = getRequestId(c);
    const toolId = c.req.param('id');

    const result = await toolService.getTool(actor, toolId);

    if (!result.success) {
      return errorResponse(c, result.error, requestId);
    }

    return c.json({
      data: result.data,
      meta: { requestId },
    });
  });

  return app;
}
