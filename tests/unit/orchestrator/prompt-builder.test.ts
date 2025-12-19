/**
 * Prompt Builder Unit Tests
 * Phase 5: AI Orchestrator - TDD
 *
 * Tests for 5-layer prompt assembly
 * Reference: docs/stage-4-ai-orchestrator.md Section 2.3
 */

import { describe, it, expect } from 'vitest';

import {
  createPromptBuilder,
  CORE_INSTRUCTIONS,
} from '@/orchestrator/prompt-builder.js';
import type {
  PromptBuilderInput,
  PromptBuilderOutput,
  LLMMessage,
} from '@/types/index.js';

describe('Prompt Builder', () => {
  // Helper to create a minimal valid input
  function createInput(
    overrides: Partial<PromptBuilderInput> = {}
  ): PromptBuilderInput {
    return {
      coreInstructions: CORE_INSTRUCTIONS,
      systemPrompt: 'You are Bakame, a helpful AI assistant.',
      userPreferences: {
        responseLength: 'medium',
        formality: 'balanced',
        customInstructions: null,
      },
      memories: [],
      knowledge: [],
      conversationHistory: [],
      userMessage: 'Hello',
      tools: [],
      ...overrides,
    };
  }

  describe('createPromptBuilder', () => {
    it('should create a prompt builder instance', () => {
      const builder = createPromptBuilder();
      expect(builder).toBeDefined();
      expect(typeof builder.build).toBe('function');
    });
  });

  describe('build()', () => {
    describe('Layer 1: Core Instructions', () => {
      it('should include core instructions as first system message', () => {
        const builder = createPromptBuilder();
        const input = createInput();
        const output = builder.build(input);

        expect(output.messages[0].role).toBe('system');
        expect(output.messages[0].content).toContain(CORE_INSTRUCTIONS);
      });

      it('should always include safety rules in core instructions', () => {
        const builder = createPromptBuilder();
        const input = createInput();
        const output = builder.build(input);

        const systemContent = output.messages[0].content;
        expect(systemContent).toContain('SAFETY');
      });
    });

    describe('Layer 2: System Prompt', () => {
      it('should include admin-managed system prompt', () => {
        const builder = createPromptBuilder();
        const input = createInput({
          systemPrompt:
            'You are Bakame, a knowledgeable AI assistant for Rwanda.',
        });
        const output = builder.build(input);

        const systemContent = output.messages[0].content;
        expect(systemContent).toContain(
          'You are Bakame, a knowledgeable AI assistant for Rwanda.'
        );
      });

      it('should handle empty system prompt gracefully', () => {
        const builder = createPromptBuilder();
        const input = createInput({ systemPrompt: '' });
        const output = builder.build(input);

        // Should still work without system prompt
        expect(output.messages.length).toBeGreaterThan(0);
      });
    });

    describe('Layer 3: User Preferences', () => {
      it('should include response length preference', () => {
        const builder = createPromptBuilder();
        const input = createInput({
          userPreferences: {
            responseLength: 'concise',
            formality: 'casual',
            customInstructions: null,
          },
        });
        const output = builder.build(input);

        const systemContent = output.messages[0].content;
        expect(systemContent).toContain('concise');
      });

      it('should include formality preference', () => {
        const builder = createPromptBuilder();
        const input = createInput({
          userPreferences: {
            responseLength: 'medium',
            formality: 'formal',
            customInstructions: null,
          },
        });
        const output = builder.build(input);

        const systemContent = output.messages[0].content;
        expect(systemContent).toContain('formal');
      });

      it('should include custom instructions when provided', () => {
        const builder = createPromptBuilder();
        const input = createInput({
          userPreferences: {
            responseLength: 'medium',
            formality: 'balanced',
            customInstructions:
              'Always respond in Kinyarwanda when appropriate.',
          },
        });
        const output = builder.build(input);

        const systemContent = output.messages[0].content;
        expect(systemContent).toContain(
          'Always respond in Kinyarwanda when appropriate.'
        );
      });

      it('should handle null custom instructions', () => {
        const builder = createPromptBuilder();
        const input = createInput({
          userPreferences: {
            responseLength: 'medium',
            formality: 'balanced',
            customInstructions: null,
          },
        });
        const output = builder.build(input);

        // Should not throw and should produce valid output
        expect(output.messages).toBeDefined();
      });
    });

    describe('Layer 4: Retrieved Context', () => {
      it('should include relevant memories in context', () => {
        const builder = createPromptBuilder();
        const input = createInput({
          memories: [
            {
              content: 'User prefers morning meetings',
              category: 'preference',
              importance: 8,
            },
            {
              content: 'User is a software engineer',
              category: 'fact',
              importance: 9,
            },
          ],
        });
        const output = builder.build(input);

        const systemContent = output.messages[0].content;
        expect(systemContent).toContain('User prefers morning meetings');
        expect(systemContent).toContain('User is a software engineer');
      });

      it('should include knowledge chunks in context', () => {
        const builder = createPromptBuilder();
        const input = createInput({
          knowledge: [
            {
              title: 'Company Policy',
              chunk: 'Remote work is allowed on Fridays.',
            },
            { title: 'Benefits', chunk: 'Health insurance covers dental.' },
          ],
        });
        const output = builder.build(input);

        const systemContent = output.messages[0].content;
        expect(systemContent).toContain('Remote work is allowed on Fridays.');
        expect(systemContent).toContain('Health insurance covers dental.');
      });

      it('should handle empty memories and knowledge', () => {
        const builder = createPromptBuilder();
        const input = createInput({
          memories: [],
          knowledge: [],
        });
        const output = builder.build(input);

        // Should produce valid output without context
        expect(output.messages).toBeDefined();
        expect(output.messages.length).toBeGreaterThan(0);
      });

      it('should order memories by importance', () => {
        const builder = createPromptBuilder();
        const input = createInput({
          memories: [
            { content: 'Low importance fact', category: 'fact', importance: 3 },
            {
              content: 'High importance fact',
              category: 'fact',
              importance: 10,
            },
            {
              content: 'Medium importance fact',
              category: 'fact',
              importance: 6,
            },
          ],
        });
        const output = builder.build(input);

        const systemContent = output.messages[0].content;
        const highIndex = systemContent.indexOf('High importance fact');
        const lowIndex = systemContent.indexOf('Low importance fact');

        // High importance should appear before low importance
        expect(highIndex).toBeLessThan(lowIndex);
      });
    });

    describe('Layer 5: Conversation History', () => {
      it('should include conversation history as separate messages', () => {
        const builder = createPromptBuilder();
        const input = createInput({
          conversationHistory: [
            { role: 'user', content: 'What is the weather?' },
            {
              role: 'assistant',
              content: 'I cannot check the weather without a tool.',
            },
          ],
        });
        const output = builder.build(input);

        // Find user and assistant messages after system
        const userMsg = output.messages.find(
          (m) => m.role === 'user' && m.content === 'What is the weather?'
        );
        const assistantMsg = output.messages.find(
          (m) =>
            m.role === 'assistant' &&
            m.content === 'I cannot check the weather without a tool.'
        );

        expect(userMsg).toBeDefined();
        expect(assistantMsg).toBeDefined();
      });

      it('should include current user message as the last message', () => {
        const builder = createPromptBuilder();
        const input = createInput({
          userMessage: 'What time is it?',
        });
        const output = builder.build(input);

        const lastMessage = output.messages[output.messages.length - 1];
        expect(lastMessage.role).toBe('user');
        expect(lastMessage.content).toBe('What time is it?');
      });

      it('should preserve conversation order', () => {
        const builder = createPromptBuilder();
        const input = createInput({
          conversationHistory: [
            { role: 'user', content: 'First' },
            { role: 'assistant', content: 'Second' },
            { role: 'user', content: 'Third' },
            { role: 'assistant', content: 'Fourth' },
          ],
          userMessage: 'Fifth',
        });
        const output = builder.build(input);

        // Get non-system messages
        const nonSystemMessages = output.messages.filter(
          (m) => m.role !== 'system'
        );

        expect(nonSystemMessages[0].content).toBe('First');
        expect(nonSystemMessages[1].content).toBe('Second');
        expect(nonSystemMessages[2].content).toBe('Third');
        expect(nonSystemMessages[3].content).toBe('Fourth');
        expect(nonSystemMessages[4].content).toBe('Fifth');
      });
    });

    describe('Tool Formatting', () => {
      it('should convert tools to LLM format', () => {
        const builder = createPromptBuilder();
        const input = createInput({
          tools: [
            {
              name: 'web_search',
              description: 'Search the web for information',
              type: 'local',
              config: {},
              inputSchema: {
                type: 'object',
                properties: {
                  query: { type: 'string', description: 'Search query' },
                },
                required: ['query'],
              },
            },
          ],
        });
        const output = builder.build(input);

        expect(output.tools).toHaveLength(1);
        expect(output.tools[0].type).toBe('function');
        expect(output.tools[0].function.name).toBe('web_search');
        expect(output.tools[0].function.description).toBe(
          'Search the web for information'
        );
        expect(output.tools[0].function.parameters).toEqual({
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
          },
          required: ['query'],
        });
      });

      it('should handle empty tools array', () => {
        const builder = createPromptBuilder();
        const input = createInput({ tools: [] });
        const output = builder.build(input);

        expect(output.tools).toEqual([]);
      });

      it('should convert multiple tools', () => {
        const builder = createPromptBuilder();
        const input = createInput({
          tools: [
            {
              name: 'calculator',
              description: 'Calculate math expressions',
              type: 'local',
              config: {},
              inputSchema: {
                type: 'object',
                properties: { expr: { type: 'string' } },
              },
            },
            {
              name: 'weather',
              description: 'Get weather information',
              type: 'mcp',
              config: { server: 'weather-server' },
              inputSchema: {
                type: 'object',
                properties: { location: { type: 'string' } },
              },
            },
          ],
        });
        const output = builder.build(input);

        expect(output.tools).toHaveLength(2);
        expect(output.tools[0].function.name).toBe('calculator');
        expect(output.tools[1].function.name).toBe('weather');
      });
    });

    describe('Token Estimation', () => {
      it('should provide token count estimate', () => {
        const builder = createPromptBuilder();
        const input = createInput({
          userMessage: 'Hello, how are you?',
        });
        const output = builder.build(input);

        expect(output.estimatedTokens).toBeGreaterThan(0);
      });

      it('should increase estimate with more context', () => {
        const builder = createPromptBuilder();

        const minimalInput = createInput({ userMessage: 'Hi' });
        const minimalOutput = builder.build(minimalInput);

        const richInput = createInput({
          userMessage: 'Hi',
          memories: [
            {
              content: 'Memory 1 with lots of text',
              category: 'fact',
              importance: 5,
            },
            {
              content: 'Memory 2 with lots of text',
              category: 'fact',
              importance: 5,
            },
          ],
          knowledge: [
            { title: 'Doc 1', chunk: 'A long chunk of knowledge text here' },
            {
              title: 'Doc 2',
              chunk: 'Another long chunk of knowledge text here',
            },
          ],
          conversationHistory: [
            { role: 'user', content: 'Previous message 1' },
            { role: 'assistant', content: 'Previous response 1' },
          ],
        });
        const richOutput = builder.build(richInput);

        expect(richOutput.estimatedTokens).toBeGreaterThan(
          minimalOutput.estimatedTokens
        );
      });
    });

    describe('Output Format', () => {
      it('should return valid PromptBuilderOutput', () => {
        const builder = createPromptBuilder();
        const input = createInput();
        const output = builder.build(input);

        expect(output).toHaveProperty('messages');
        expect(output).toHaveProperty('tools');
        expect(output).toHaveProperty('estimatedTokens');
        expect(Array.isArray(output.messages)).toBe(true);
        expect(Array.isArray(output.tools)).toBe(true);
        expect(typeof output.estimatedTokens).toBe('number');
      });

      it('should produce messages with correct roles', () => {
        const builder = createPromptBuilder();
        const input = createInput({
          conversationHistory: [
            { role: 'user', content: 'Question' },
            { role: 'assistant', content: 'Answer' },
          ],
        });
        const output = builder.build(input);

        const validRoles = ['system', 'user', 'assistant', 'tool'];
        for (const msg of output.messages) {
          expect(validRoles).toContain(msg.role);
        }
      });

      it('should have at least one system message and one user message', () => {
        const builder = createPromptBuilder();
        const input = createInput();
        const output = builder.build(input);

        const systemMessages = output.messages.filter(
          (m) => m.role === 'system'
        );
        const userMessages = output.messages.filter((m) => m.role === 'user');

        expect(systemMessages.length).toBeGreaterThanOrEqual(1);
        expect(userMessages.length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe('CORE_INSTRUCTIONS', () => {
    it('should be defined and non-empty', () => {
      expect(CORE_INSTRUCTIONS).toBeDefined();
      expect(CORE_INSTRUCTIONS.length).toBeGreaterThan(0);
    });

    it('should contain safety guidelines', () => {
      expect(CORE_INSTRUCTIONS).toContain('SAFETY');
    });
  });
});
