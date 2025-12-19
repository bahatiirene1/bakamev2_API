/**
 * Bakame Application Entry Point
 *
 * Wires together all services and starts the Hono application.
 */

import 'dotenv/config';
import { serve } from '@hono/node-server';
import { createClient } from '@supabase/supabase-js';

import { createApp } from './api/app.js';
import type { ApiServices } from './api/types.js';
import {
  createAuthService,
  createAuthServiceDb,
  createAuditService,
  createAuditServiceDb,
  createUserService,
  createUserServiceDb,
  createChatService,
  createChatServiceDb,
  createMemoryService,
  createMemoryServiceDb,
  createKnowledgeService,
  createKnowledgeServiceDb,
  createToolService,
  createToolServiceDb,
  createSubscriptionService,
  createSubscriptionServiceDb,
  createApprovalService,
  createApprovalServiceDb,
  createPromptService,
  createPromptServiceDb,
} from './services/index.js';

// Validate environment
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

// Create Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Wire all database adapters
const auditDb = createAuditServiceDb(supabase);
const authDb = createAuthServiceDb(supabase);
const userDb = createUserServiceDb(supabase);
const chatDb = createChatServiceDb(supabase);
const memoryDb = createMemoryServiceDb(supabase);
const knowledgeDb = createKnowledgeServiceDb(supabase);
const toolDb = createToolServiceDb(supabase);
const subscriptionDb = createSubscriptionServiceDb(supabase);
const approvalDb = createApprovalServiceDb(supabase);
const promptDb = createPromptServiceDb(supabase);

// Wire all services
const auditService = createAuditService({ db: auditDb });
const authService = createAuthService({ db: authDb });

const userService = createUserService({
  db: userDb,
  auditService: auditService,
});

const chatService = createChatService({
  db: chatDb,
  auditService: auditService,
});

const memoryService = createMemoryService({
  db: memoryDb,
  auditService: auditService,
});

const knowledgeService = createKnowledgeService({
  db: knowledgeDb,
  auditService: auditService,
  approvalService: {
    createRequest: async () => ({
      success: true as const,
      data: { id: 'stub' },
    }),
  },
});

const toolService = createToolService({
  db: toolDb,
  auditService: auditService,
  subscriptionService: {
    hasEntitlement: async () => ({ success: true as const, data: true }),
    getEntitlementValue: async () => ({ success: true as const, data: null }),
    checkUsageLimit: async () => ({
      success: true as const,
      data: { allowed: true },
    }),
  },
});

const subscriptionService = createSubscriptionService({
  db: subscriptionDb,
  auditService: auditService,
});

const approvalService = createApprovalService({
  db: approvalDb,
  auditService: auditService,
});

const promptService = createPromptService({
  db: promptDb,
  auditService: auditService,
});

// Create the API application
// Cast services to ApiServices - the loose interface uses `unknown` for flexibility
// while the actual services have stricter types for type safety
const app = createApp({
  supabaseClient: supabase,
  services: {
    authService,
    auditService,
    userService,
    chatService,
    memoryService,
    knowledgeService,
    toolService,
    subscriptionService,
    approvalService,
    promptService,
  } as unknown as ApiServices,
  allowedOrigins: ['http://localhost:5173', 'http://localhost:3000'],
});

const port = Number(process.env.PORT) || 3000;

console.error(`Server starting on port ${port}`);
console.error(`Supabase URL: ${SUPABASE_URL}`);

serve({
  fetch: app.fetch,
  port,
});

export { app };
