/**
 * Main Hono Application
 * Wires together all routes and middleware
 *
 * Reference: docs/stage-3a-minimal-api.md Section 7
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import { createAdminMiddleware } from './middleware/admin.js';
import {
  createAuthMiddleware,
  createPublicMiddleware,
} from './middleware/auth.js';
import { createAdminRoutes } from './routes/admin.js';
import { createChatRoutes } from './routes/chats.js';
import { createHealthRoutes } from './routes/health.js';
import { createKnowledgeCategoriesRoutes } from './routes/knowledge-categories.js';
import { createKnowledgeUploadRoutes } from './routes/knowledge-upload.js';
import { createKnowledgeRoutes } from './routes/knowledge.js';
import { createMemoryRoutes } from './routes/memories.js';
import { createSubscriptionRoutes } from './routes/subscription.js';
import { createToolRoutes } from './routes/tools.js';
import { createUserRoutes } from './routes/users.js';
import type { ApiServices } from './types.js';

/**
 * App configuration
 */
interface AppConfig {
  supabaseClient: SupabaseClient;
  services: ApiServices;
  allowedOrigins?: string[];
}

/**
 * Create the main Hono application
 */
export function createApp(config: AppConfig): Hono {
  const { supabaseClient, services, allowedOrigins } = config;
  const app = new Hono();

  // Global middleware
  app.use('*', logger());
  app.use(
    '*',
    cors({
      origin: allowedOrigins ?? ['http://localhost:3000'],
      credentials: true,
    })
  );

  // Public routes (no auth)
  const publicMiddleware = createPublicMiddleware();
  app.use('/api/v1/health', publicMiddleware);
  app.route('/api/v1', createHealthRoutes());

  // Auth middleware for protected routes
  const authMiddleware = createAuthMiddleware({
    supabaseClient,
    authService: {
      resolvePermissions: async (userId: string) => {
        const result = await services.authService.resolvePermissions(userId);
        return result;
      },
    },
    userService: services.userService as any,
  });

  // Protected routes
  app.use('/api/v1/chats/*', authMiddleware);
  app.use('/api/v1/chats', authMiddleware);
  app.route(
    '/api/v1',
    createChatRoutes({
      chatService: services.chatService as any,
    })
  );

  // User routes
  app.use('/api/v1/users/*', authMiddleware);
  app.use('/api/v1/users', authMiddleware);
  app.route(
    '/api/v1',
    createUserRoutes({
      userService: services.userService as any,
    })
  );

  // Memory routes
  app.use('/api/v1/memories/*', authMiddleware);
  app.use('/api/v1/memories', authMiddleware);
  app.route(
    '/api/v1',
    createMemoryRoutes({
      memoryService: services.memoryService as any,
    })
  );

  // Knowledge routes
  app.use('/api/v1/knowledge/*', authMiddleware);
  app.use('/api/v1/knowledge', authMiddleware);
  app.route(
    '/api/v1',
    createKnowledgeRoutes({
      knowledgeService: services.knowledgeService as any,
    })
  );

  // Knowledge upload routes (document upload with parsing)
  app.route('/api/v1', createKnowledgeUploadRoutes(supabaseClient));

  // Tool routes
  app.use('/api/v1/tools/*', authMiddleware);
  app.use('/api/v1/tools', authMiddleware);
  app.route(
    '/api/v1',
    createToolRoutes({
      toolService: services.toolService as any,
    })
  );

  // Subscription routes
  app.use('/api/v1/subscription/*', authMiddleware);
  app.use('/api/v1/subscription', authMiddleware);
  app.route(
    '/api/v1',
    createSubscriptionRoutes({
      subscriptionService: services.subscriptionService as any,
    })
  );

  // Knowledge categories routes (require auth + admin permission)
  const adminMiddleware = createAdminMiddleware();
  app.use('/api/v1/knowledge-categories/*', authMiddleware);
  app.use('/api/v1/knowledge-categories/*', adminMiddleware);
  app.use('/api/v1/knowledge-categories', authMiddleware);
  app.use('/api/v1/knowledge-categories', adminMiddleware);
  app.route('/api/v1', createKnowledgeCategoriesRoutes(supabaseClient));

  // Admin routes (require auth + admin permission)
  app.use('/api/v1/admin/*', authMiddleware);
  app.use('/api/v1/admin/*', adminMiddleware);
  app.route(
    '/api/v1',
    createAdminRoutes({
      supabase: supabaseClient,
      userService: services.userService as any,
      auditService: services.auditService as any,
      promptService: services.promptService as any,
      approvalService: services.approvalService as any,
    })
  );

  // 404 handler
  app.notFound((c) => {
    const actor = c.get('actor');
    const requestId = actor?.requestId || 'unknown';

    return c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'Endpoint not found',
          requestId,
        },
      },
      404
    );
  });

  // Global error handler
  app.onError((err, c) => {
    console.error('Unhandled error:', err);
    const actor = c.get('actor');
    const requestId = actor?.requestId || 'unknown';

    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
          requestId,
        },
      },
      500
    );
  });

  return app;
}
