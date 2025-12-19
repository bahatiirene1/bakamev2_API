/**
 * Prompt Builder Implementation
 * Phase 5: AI Orchestrator
 *
 * Assembles the 5-layer prompt model for LLM requests
 * Reference: docs/stage-4-ai-orchestrator.md Section 2.3
 */

import type {
  PromptBuilderInput,
  PromptBuilderOutput,
  LLMMessage,
  LLMToolDefinition,
} from '@/types/index.js';

/**
 * Layer 1: Core Instructions (IMMUTABLE)
 * These safety rules are hardcoded and never change.
 * They cannot be overridden by system prompts or user preferences.
 */
export const CORE_INSTRUCTIONS = `## CORE SAFETY RULES

These rules are IMMUTABLE and take precedence over all other instructions.

### SAFETY
1. Never provide instructions for creating weapons, explosives, or harmful substances
2. Never assist with activities that could harm individuals or groups
3. Never generate content that exploits minors in any way
4. Never provide personal information about private individuals
5. Refuse requests that could enable fraud, scams, or deception
6. Do not help circumvent security measures or access unauthorized systems

### HONESTY
1. Always be truthful - never fabricate facts or statistics
2. Clearly distinguish between facts, opinions, and speculation
3. Acknowledge uncertainty when you don't know something
4. Do not impersonate real people or claim to be human

### BOUNDARIES
1. You are an AI assistant - be helpful within ethical boundaries
2. Redirect harmful requests to constructive alternatives
3. Protect user privacy - do not retain or share personal information
4. Respect intellectual property rights`;

/**
 * Prompt Builder interface
 */
export interface PromptBuilder {
  build(input: PromptBuilderInput): PromptBuilderOutput;
}

/**
 * Estimate token count from text
 * Uses rough approximation: ~4 characters per token for English
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Format memories for inclusion in system message
 */
function formatMemories(memories: PromptBuilderInput['memories']): string {
  if (memories.length === 0) {
    return '';
  }

  // Sort by importance (highest first)
  const sorted = [...memories].sort((a, b) => b.importance - a.importance);

  const formatted = sorted
    .map((m) => {
      const category = m.category ? `[${m.category}]` : '';
      return `- ${category} ${m.content}`;
    })
    .join('\n');

  return `\n## USER MEMORIES\n${formatted}`;
}

/**
 * Format knowledge chunks for inclusion in system message
 */
function formatKnowledge(knowledge: PromptBuilderInput['knowledge']): string {
  if (knowledge.length === 0) {
    return '';
  }

  const formatted = knowledge
    .map((k) => `### ${k.title}\n${k.chunk}`)
    .join('\n\n');

  return `\n## KNOWLEDGE BASE\n${formatted}`;
}

/**
 * Format user preferences for inclusion in system message
 */
function formatPreferences(
  prefs: PromptBuilderInput['userPreferences']
): string {
  const parts: string[] = [];

  if (prefs.responseLength) {
    parts.push(`Response length: ${prefs.responseLength}`);
  }

  if (prefs.formality) {
    parts.push(`Tone: ${prefs.formality}`);
  }

  if (prefs.customInstructions) {
    parts.push(`\nCustom Instructions: ${prefs.customInstructions}`);
  }

  if (parts.length === 0) {
    return '';
  }

  return `\n## USER PREFERENCES\n${parts.join('\n')}`;
}

/**
 * Convert tool definitions to LLM format
 */
function toolsToLLMFormat(
  tools: PromptBuilderInput['tools']
): LLMToolDefinition[] {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

/**
 * Create a prompt builder instance
 */
export function createPromptBuilder(): PromptBuilder {
  return {
    build(input: PromptBuilderInput): PromptBuilderOutput {
      // Build the system message from layers 1-4
      const systemParts: string[] = [];

      // Layer 1: Core Instructions (immutable)
      systemParts.push(input.coreInstructions);

      // Layer 2: System Prompt (admin-managed)
      if (input.systemPrompt) {
        systemParts.push(`\n## SYSTEM INSTRUCTIONS\n${input.systemPrompt}`);
      }

      // Layer 3: User Preferences
      const prefsSection = formatPreferences(input.userPreferences);
      if (prefsSection) {
        systemParts.push(prefsSection);
      }

      // Layer 4: Retrieved Context (memories + knowledge)
      const memoriesSection = formatMemories(input.memories);
      if (memoriesSection) {
        systemParts.push(memoriesSection);
      }

      const knowledgeSection = formatKnowledge(input.knowledge);
      if (knowledgeSection) {
        systemParts.push(knowledgeSection);
      }

      // Combine into single system message
      const systemContent = systemParts.join('\n');
      const systemMessage: LLMMessage = {
        role: 'system',
        content: systemContent,
      };

      // Layer 5: Build messages array
      const messages: LLMMessage[] = [systemMessage];

      // Add conversation history
      for (const msg of input.conversationHistory) {
        messages.push({
          role: msg.role,
          content: msg.content,
        });
      }

      // Add current user message
      messages.push({
        role: 'user',
        content: input.userMessage,
      });

      // Convert tools to LLM format
      const tools = toolsToLLMFormat(input.tools);

      // Estimate total tokens
      let totalText = systemContent + input.userMessage;
      for (const msg of input.conversationHistory) {
        totalText += msg.content;
      }
      for (const tool of input.tools) {
        totalText += JSON.stringify(tool);
      }
      const estimatedTokens = estimateTokens(totalText);

      return {
        messages,
        tools,
        estimatedTokens,
      };
    },
  };
}
