/**
 * Prompt Domain Types
 * Phase 2: TDD - Type definitions for PromptService
 *
 * Reference: docs/stage-2-service-layer.md Section 3.6
 *
 * SCOPE: System prompt governance
 *
 * Workflow: draft → pending_review → approved → active → deprecated
 */

/**
 * System prompt status - lifecycle states
 */
export type PromptStatus =
  | 'draft'
  | 'pending_review'
  | 'approved'
  | 'active'
  | 'deprecated';

/**
 * System prompt entity
 */
export interface SystemPrompt {
  id: string;
  name: string;
  description: string | null;
  content: string;
  status: PromptStatus;
  authorId: string;
  reviewerId: string | null;
  version: number;
  isDefault: boolean;
  activatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Parameters for creating a system prompt
 */
export interface CreatePromptParams {
  name: string;
  description?: string;
  content: string;
}

/**
 * Parameters for updating a system prompt
 */
export interface PromptUpdate {
  name?: string;
  description?: string;
  content?: string;
}

/**
 * Parameters for listing system prompts
 */
export interface ListPromptsParams {
  status?: PromptStatus;
}
