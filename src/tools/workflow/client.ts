/**
 * Workflow Client Stub (n8n)
 * Phase 4: Tool Execution Layer
 *
 * Reference: docs/stage-5-tool-execution.md Section 4
 *
 * STUB IMPLEMENTATION: Will be replaced with real n8n webhook integration
 * when n8n workflows are configured.
 */

import type {
  WorkflowClient,
  WorkflowResult,
  WorkflowConfig,
} from '../types.js';

/**
 * Create a stub workflow client
 *
 * This is a placeholder that returns appropriate errors.
 * Replace with real n8n webhook integration when ready.
 */
export function createStubWorkflowClient(
  _config?: WorkflowConfig
): WorkflowClient {
  return {
    invoke(
      workflowId: string,
      _input: Record<string, unknown>,
      _timeout: number
    ): Promise<WorkflowResult> {
      // Stub: always return not configured
      return Promise.resolve({
        success: false,
        output: {},
        errorMessage: `Workflow '${workflowId}' not configured. n8n integration unavailable.`,
      });
    },

    isHealthy(): boolean {
      // Stub is always "healthy" but non-functional
      return false;
    },
  };
}

/**
 * Workflow Client Factory (n8n)
 *
 * When implementing real n8n integration, this factory will:
 * 1. Configure webhook endpoints
 * 2. Handle authentication
 * 3. Manage timeouts and retries
 *
 * For now, returns stub.
 */
export function createWorkflowClient(config?: WorkflowConfig): WorkflowClient {
  // TODO: Implement real n8n webhook client
  // For now, return stub
  return createStubWorkflowClient(config);
}
