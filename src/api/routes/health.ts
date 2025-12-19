/**
 * Health Route
 * Public endpoint for health checks
 */

import { Hono } from 'hono';

/**
 * Create health check routes
 */
export function createHealthRoutes(): Hono {
  const app = new Hono();

  /**
   * GET /health
   * Health check - no authentication required
   */
  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: 'v1',
    });
  });

  return app;
}
