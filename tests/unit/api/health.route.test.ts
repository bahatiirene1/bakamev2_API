/**
 * Health Route Unit Tests
 */

import { Hono } from 'hono';
import { describe, it, expect } from 'vitest';

import { createHealthRoutes } from '@/api/routes/health.js';

describe('Health Route', () => {
  describe('GET /health', () => {
    it('should return 200 with status ok', async () => {
      const app = new Hono();
      app.route('/api/v1', createHealthRoutes());

      const res = await app.request('/api/v1/health');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('ok');
    });

    it('should include timestamp in response', async () => {
      const app = new Hono();
      app.route('/api/v1', createHealthRoutes());

      const res = await app.request('/api/v1/health');

      const body = await res.json();
      expect(body.timestamp).toBeDefined();
      expect(typeof body.timestamp).toBe('string');
      // Verify it's a valid ISO date
      expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
    });

    it('should not require authentication', async () => {
      const app = new Hono();
      app.route('/api/v1', createHealthRoutes());

      // No Authorization header
      const res = await app.request('/api/v1/health');

      expect(res.status).toBe(200);
    });

    it('should include version info', async () => {
      const app = new Hono();
      app.route('/api/v1', createHealthRoutes());

      const res = await app.request('/api/v1/health');

      const body = await res.json();
      expect(body.version).toBe('v1');
    });
  });
});
