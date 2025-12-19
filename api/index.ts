/**
 * Vercel Serverless Entry Point
 *
 * This file exports the Hono app as a Vercel serverless function.
 * It mirrors the service wiring from src/index.ts but uses the Vercel handler.
 */

import { handle } from '@hono/node-server/vercel';
import { createClient } from '@supabase/supabase-js';

import { createApp } from '../dist/api/app.js';
import type { ApiServices } from '../dist/api/types.js';
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
} from '../dist/services/index.js';

// Validate environment
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
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

// Allowed origins for CORS
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://bakame.ai',
  'https://www.bakame.ai',
  'https://bakamev2.vercel.app',
  process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '',
].filter(Boolean);

// Create the API application
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
  allowedOrigins,
});

// Export the Vercel handler
export default handle(app);
