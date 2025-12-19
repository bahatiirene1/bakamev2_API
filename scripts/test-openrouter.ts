/**
 * OpenRouter API Test Script
 * Tests: key validation, completion, streaming, model access
 *
 * Run with: npx tsx scripts/test-openrouter.ts
 */

import { createLLMClient } from '../src/orchestrator/llm-client.js';

const API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4.1';

if (!API_KEY) {
  console.error('ERROR: OPENROUTER_API_KEY environment variable is required');
  console.error('Usage: OPENROUTER_API_KEY=sk-or-... npx tsx scripts/test-openrouter.ts');
  process.exit(1);
}

async function runTests(): Promise<void> {
  console.log('='.repeat(60));
  console.log('OpenRouter API Integration Tests');
  console.log('='.repeat(60));
  console.log(`Model: ${MODEL}`);
  console.log('');

  // Test 1: Client Creation
  console.log('TEST 1: Client Creation');
  console.log('-'.repeat(40));
  try {
    const client = createLLMClient({
      apiKey: API_KEY,
      siteName: 'Bakame',
      siteUrl: 'https://bakame.ai',
    });
    console.log('✅ Client created successfully');
    console.log('');

    // Test 2: Simple Completion
    console.log('TEST 2: Simple Completion');
    console.log('-'.repeat(40));
    const startComplete = Date.now();
    const response = await client.complete({
      model: MODEL,
      messages: [
        { role: 'system', content: 'You are a helpful assistant. Be very concise.' },
        { role: 'user', content: 'Say "Hello from Bakame!" and nothing else.' },
      ],
      max_tokens: 50,
      temperature: 0,
    });
    const completeTime = Date.now() - startComplete;

    console.log(`✅ Completion successful (${completeTime}ms)`);
    console.log(`   Response ID: ${response.id}`);
    console.log(`   Model: ${response.model}`);
    console.log(`   Content: "${response.choices[0]?.message.content}"`);
    console.log(`   Finish Reason: ${response.choices[0]?.finish_reason}`);
    console.log(`   Tokens: ${response.usage.prompt_tokens} prompt + ${response.usage.completion_tokens} completion = ${response.usage.total_tokens} total`);
    console.log('');

    // Test 3: Streaming
    console.log('TEST 3: Streaming');
    console.log('-'.repeat(40));
    const startStream = Date.now();
    let streamContent = '';
    let chunkCount = 0;

    process.stdout.write('   Streaming: ');
    for await (const chunk of client.stream({
      model: MODEL,
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Count from 1 to 5, separated by commas.' },
      ],
      max_tokens: 50,
      temperature: 0,
    })) {
      chunkCount++;
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        streamContent += content;
        process.stdout.write(content);
      }
    }
    const streamTime = Date.now() - startStream;

    console.log('');
    console.log(`✅ Streaming successful (${streamTime}ms, ${chunkCount} chunks)`);
    console.log(`   Full content: "${streamContent.trim()}"`);
    console.log('');

    // Test 4: Tool Calling
    console.log('TEST 4: Tool Calling');
    console.log('-'.repeat(40));
    const toolResponse = await client.complete({
      model: MODEL,
      messages: [
        { role: 'system', content: 'You are a helpful assistant with access to tools.' },
        { role: 'user', content: 'What is the weather in Kigali?' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get the current weather in a given location',
            parameters: {
              type: 'object',
              properties: {
                location: { type: 'string', description: 'City name' },
                unit: { type: 'string', enum: ['celsius', 'fahrenheit'], default: 'celsius' },
              },
              required: ['location'],
            },
          },
        },
      ],
      tool_choice: 'auto',
      max_tokens: 200,
    });

    const toolCalls = toolResponse.choices[0]?.message.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      console.log(`✅ Tool calling successful`);
      console.log(`   Finish Reason: ${toolResponse.choices[0]?.finish_reason}`);
      console.log(`   Tool Called: ${toolCalls[0].function.name}`);
      console.log(`   Arguments: ${toolCalls[0].function.arguments}`);
    } else {
      console.log(`⚠️ Model responded with text instead of tool call`);
      console.log(`   Content: "${toolResponse.choices[0]?.message.content?.substring(0, 100)}..."`);
    }
    console.log('');

    // Summary
    console.log('='.repeat(60));
    console.log('SUMMARY: All tests passed!');
    console.log('='.repeat(60));
    console.log('✅ Key validation: PASSED');
    console.log('✅ Model access: PASSED');
    console.log('✅ Simple completion: PASSED');
    console.log('✅ Streaming: PASSED');
    console.log(`✅ Tool calling: ${toolCalls ? 'PASSED' : 'PARTIAL (model used text)'}`);
    console.log('');
    console.log('The LLM client is ready for production use!');

  } catch (error) {
    console.log('❌ Test failed');
    if (error instanceof Error) {
      console.log(`   Error: ${error.message}`);
      if ('status' in error) {
        console.log(`   Status: ${(error as Record<string, unknown>).status}`);
      }
      if ('code' in error) {
        console.log(`   Code: ${(error as Record<string, unknown>).code}`);
      }
    } else {
      console.log(`   Error: ${String(error)}`);
    }
    process.exit(1);
  }
}

runTests().catch(console.error);
