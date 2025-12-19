# STAGE 5: TOOL EXECUTION LAYER

**Layer**: 5 of 6
**Status**: ✅ APPROVED & LOCKED (with 3 hardening notes)
**References**:
- `docs/stage-1-database-governance.md` (IMMUTABLE)
- `docs/stage-2-service-layer.md` (IMMUTABLE)
- `docs/stage-3a-minimal-api.md` (IMMUTABLE)
- `docs/stage-3b-expand-api.md` (IMMUTABLE)
- `docs/stage-4-ai-orchestrator.md` (IMMUTABLE)
- `docs/architecture.md`

---

## 0. PURPOSE OF THIS STAGE

Implement the **actual tool execution infrastructure** that the AI Orchestrator (Stage 4) invokes.

This stage defines:
1. **Tool Executor Runtime** — The engine that runs tools
2. **MCP Server Integration** — Model Context Protocol servers
3. **Local Tool Handlers** — Built-in tools (reasoning, calculations)
4. **Workflow Executor** — n8n integration implementation
5. **Background Workers** — Async job processing
6. **Security & Sandboxing** — Tool isolation and safety

### 0.1 What This Stage IS Allowed To Do

| Allowed | Description |
|---------|-------------|
| ✅ Implement tool execution | Actually run tools |
| ✅ Integrate MCP servers | Connect to external MCP providers |
| ✅ Create local tools | Built-in functionality |
| ✅ Implement workflow calls | n8n webhook invocations |
| ✅ Background job processing | Async workers via Upstash |
| ✅ Cost tracking | Measure and record tool costs |

### 0.2 What This Stage is NOT Allowed To Do

| Prohibited | Reason |
|------------|--------|
| ❌ Make authorization decisions | ToolService (Stage 2) handles permissions |
| ❌ Modify prompt logic | Orchestrator (Stage 4) owns prompts |
| ❌ Access database directly | Must use Service Layer |
| ❌ Bypass ToolService | All tool calls go through ToolService |
| ❌ Store secrets in code | Secrets come from environment |

### 0.3 Tool Execution Invariant

```
┌─────────────────────────────────────────────────────────────────┐
│                    TOOL EXECUTION RULE                          │
│                                                                 │
│   Tools are DUMB EXECUTORS. They:                               │
│   1. Receive validated input                                    │
│   2. Perform ONE specific action                                │
│   3. Return structured output                                   │
│                                                                 │
│   Tools NEVER:                                                  │
│   - Make permission decisions (ToolService did that)            │
│   - Access other tools directly                                 │
│   - Persist data (return data, let caller persist)              │
│   - Make network calls outside their scope                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 1. TOOL EXECUTION ARCHITECTURE

### 1.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     AI ORCHESTRATOR (Stage 4)                   │
│                                                                 │
│   AI decides: "I need to call web_search"                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ ToolCall { name, input }
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     TOOL SERVICE (Stage 2)                      │
│                                                                 │
│   1. Validate tool exists                                       │
│   2. Check permissions                                          │
│   3. Estimate cost                                              │
│   4. Check budget                                               │
│   5. Log invocation start                                       │
│   6. Delegate to Tool Executor ────────────────────────────┐    │
│   7. Log invocation complete                               │    │
│   8. Return result                                         │    │
└────────────────────────────────────────────────────────────│────┘
                                                             │
                              ┌───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  TOOL EXECUTOR (THIS STAGE)                     │
│                                                                 │
│   Routes to appropriate handler based on tool.type:             │
│                                                                 │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│   │   LOCAL     │  │    MCP      │  │   WORKFLOW  │            │
│   │  HANDLER    │  │   CLIENT    │  │   CLIENT    │            │
│   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘            │
│          │                │                │                    │
│          ▼                ▼                ▼                    │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│   │ Calculator  │  │ Brave Search│  │ n8n Webhook │            │
│   │ Reasoning   │  │ Filesystem  │  │ Integration │            │
│   │ DateTime    │  │ Postgres    │  │             │            │
│   └─────────────┘  └─────────────┘  └─────────────┘            │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Tool Types

| Type | Description | Execution Model |
|------|-------------|-----------------|
| `local` | Built-in handlers, run in-process | Synchronous |
| `mcp` | MCP server tools, external process | Sync/Async |
| `workflow` | n8n workflows, HTTP webhook | Sync with timeout |

### 1.3 Tool Executor Interface

```typescript
/**
 * Tool Executor - implements the execution logic
 * Called by ToolService after permission/quota checks pass
 */
interface ToolExecutor {
  /**
   * Execute a tool and return result
   * Timeout is enforced by the executor
   */
  execute(params: ToolExecutionParams): Promise<ToolExecutionResult>;

  /**
   * Check if executor can handle this tool type
   */
  canHandle(toolType: ToolType): boolean;

  /**
   * Health check for the executor
   */
  healthCheck(): Promise<HealthStatus>;
}

interface ToolExecutionParams {
  tool: Tool;
  input: Record<string, unknown>;
  context: {
    requestId: string;
    userId: string;
    timeout: number;
  };
}

interface ToolExecutionResult {
  status: 'success' | 'failure' | 'timeout';
  output?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  metrics: {
    durationMs: number;
    tokensUsed?: number;
    costIncurred?: number;
  };
}
```

---

## 2. LOCAL TOOL HANDLERS

### 2.1 Local Tool Registry

```typescript
/**
 * Registry of built-in tool handlers
 */
type LocalToolHandler = (
  input: Record<string, unknown>,
  context: ToolContext
) => Promise<Record<string, unknown>>;

const localToolHandlers: Map<string, LocalToolHandler> = new Map([
  ['calculator', calculatorHandler],
  ['datetime', datetimeHandler],
  ['deep_reasoning', deepReasoningHandler],
  ['json_parser', jsonParserHandler],
  ['text_transform', textTransformHandler],
]);
```

### 2.2 Calculator Tool

```typescript
/**
 * Calculator - safe math expression evaluation
 */
const calculatorHandler: LocalToolHandler = async (input, context) => {
  const { expression } = input as { expression: string };

  // Validate expression (prevent code injection)
  if (!isValidMathExpression(expression)) {
    throw new ToolError('INVALID_INPUT', 'Invalid math expression');
  }

  // Use math.js for safe evaluation
  const result = mathjs.evaluate(expression);

  return {
    expression,
    result,
    resultType: typeof result,
  };
};

/**
 * Validate math expression - only allow safe operations
 */
function isValidMathExpression(expr: string): boolean {
  // Allow: numbers, operators, parentheses, common functions
  const safePattern = /^[\d\s+\-*/().^%,a-z]+$/i;
  const dangerousPatterns = [
    /import/i,
    /require/i,
    /eval/i,
    /function/i,
    /=>/,
    /\$/,
  ];

  if (!safePattern.test(expr)) return false;
  if (dangerousPatterns.some(p => p.test(expr))) return false;

  return true;
}

// Tool definition
const calculatorTool: Tool = {
  id: 'tool-calculator',
  name: 'calculator',
  description: 'Evaluate mathematical expressions. Supports basic arithmetic, powers, roots, trigonometry.',
  type: 'local',
  inputSchema: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'Math expression to evaluate (e.g., "sqrt(16) + 2^3")',
      },
    },
    required: ['expression'],
  },
  config: {},
  enabled: true,
  costConfig: { fixedCost: 0 },  // Free
};
```

### 2.3 DateTime Tool

```typescript
/**
 * DateTime - timezone-aware date/time operations
 */
const datetimeHandler: LocalToolHandler = async (input, context) => {
  const { operation, timezone, date, format } = input as {
    operation: 'now' | 'parse' | 'format' | 'diff' | 'add';
    timezone?: string;
    date?: string;
    format?: string;
    [key: string]: unknown;
  };

  const tz = timezone || 'Africa/Kigali';  // Default to Rwanda

  switch (operation) {
    case 'now':
      return {
        iso: new Date().toISOString(),
        formatted: formatInTimezone(new Date(), tz, format || 'YYYY-MM-DD HH:mm:ss'),
        timezone: tz,
        timestamp: Date.now(),
      };

    case 'parse':
      const parsed = parseDate(date!);
      return {
        iso: parsed.toISOString(),
        formatted: formatInTimezone(parsed, tz, format || 'YYYY-MM-DD HH:mm:ss'),
        timestamp: parsed.getTime(),
      };

    case 'format':
      const toFormat = date ? parseDate(date) : new Date();
      return {
        formatted: formatInTimezone(toFormat, tz, format || 'YYYY-MM-DD HH:mm:ss'),
      };

    case 'diff':
      const { date1, date2, unit } = input as { date1: string; date2: string; unit: string };
      return {
        difference: dateDiff(parseDate(date1), parseDate(date2), unit as any),
        unit,
      };

    case 'add':
      const { amount, unit: addUnit } = input as { amount: number; unit: string };
      const base = date ? parseDate(date) : new Date();
      const result = dateAdd(base, amount, addUnit as any);
      return {
        original: base.toISOString(),
        result: result.toISOString(),
        formatted: formatInTimezone(result, tz, format || 'YYYY-MM-DD HH:mm:ss'),
      };

    default:
      throw new ToolError('INVALID_INPUT', `Unknown operation: ${operation}`);
  }
};

// Tool definition
const datetimeTool: Tool = {
  id: 'tool-datetime',
  name: 'datetime',
  description: 'Get current time, parse dates, calculate differences, format dates. Timezone-aware.',
  type: 'local',
  inputSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['now', 'parse', 'format', 'diff', 'add'],
        description: 'Operation to perform',
      },
      timezone: {
        type: 'string',
        description: 'Timezone (e.g., "Africa/Kigali", "UTC")',
      },
      date: { type: 'string', description: 'Date string to process' },
      format: { type: 'string', description: 'Output format' },
    },
    required: ['operation'],
  },
  config: {},
  enabled: true,
  costConfig: { fixedCost: 0 },
};
```

### 2.4 Deep Reasoning Tool

```typescript
/**
 * Deep Reasoning - delegates to a reasoning-specialized model
 * This is a local tool that makes an LLM call internally
 */
const deepReasoningHandler: LocalToolHandler = async (input, context) => {
  const { problem, context: problemContext } = input as {
    problem: string;
    context?: string;
  };

  // Get reasoning model client (e.g., DeepSeek R1, o1)
  const reasoningClient = getReasoningClient();

  const prompt = buildReasoningPrompt(problem, problemContext);

  const startTime = Date.now();
  const response = await reasoningClient.complete({
    messages: [{ role: 'user', content: prompt }],
    model: config.REASONING_MODEL,  // e.g., 'deepseek-reasoner'
    maxTokens: 8000,
    temperature: 0,  // Deterministic for reasoning
  });

  return {
    reasoning: response.content,
    model: config.REASONING_MODEL,
    tokensUsed: response.usage.input + response.usage.output,
    durationMs: Date.now() - startTime,
  };
};

function buildReasoningPrompt(problem: string, context?: string): string {
  return `You are a reasoning specialist. Think step-by-step to solve the following problem.

${context ? `CONTEXT:\n${context}\n\n` : ''}PROBLEM:
${problem}

Provide your reasoning process, then state your final answer clearly.`;
}

// Tool definition
const deepReasoningTool: Tool = {
  id: 'tool-deep-reasoning',
  name: 'deep_reasoning',
  description: 'Use advanced reasoning for complex problems. Good for math, logic, code analysis, planning.',
  type: 'local',
  inputSchema: {
    type: 'object',
    properties: {
      problem: {
        type: 'string',
        description: 'The problem to analyze',
      },
      context: {
        type: 'string',
        description: 'Additional context or constraints',
      },
    },
    required: ['problem'],
  },
  config: { model: 'deepseek-reasoner' },
  enabled: true,
  costConfig: {
    costPerUnit: {
      unit: 'token',
      costPerUnit: 0.00014,  // $0.14 per 1M tokens
      inputField: 'problem',
    },
  },
};
```

### 2.5 JSON Parser Tool

```typescript
/**
 * JSON Parser - extract structured data from text
 */
const jsonParserHandler: LocalToolHandler = async (input, context) => {
  const { text, schema } = input as {
    text: string;
    schema?: Record<string, unknown>;
  };

  // Try direct JSON parse first
  try {
    const parsed = JSON.parse(text);
    return {
      success: true,
      data: parsed,
      method: 'direct_parse',
    };
  } catch {
    // If schema provided, use LLM to extract
    if (schema) {
      const extracted = await extractWithLLM(text, schema);
      return {
        success: true,
        data: extracted,
        method: 'llm_extraction',
      };
    }

    // Try to find JSON in text
    const jsonMatch = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          success: true,
          data: parsed,
          method: 'regex_extraction',
        };
      } catch {
        // Fall through to error
      }
    }

    return {
      success: false,
      error: 'Could not parse JSON from text',
    };
  }
};
```

### 2.6 Text Transform Tool

```typescript
/**
 * Text Transform - common text operations
 */
const textTransformHandler: LocalToolHandler = async (input, context) => {
  const { text, operation, options } = input as {
    text: string;
    operation: string;
    options?: Record<string, unknown>;
  };

  switch (operation) {
    case 'summarize':
      return await summarizeText(text, options?.maxLength as number);

    case 'translate':
      return await translateText(text, options?.targetLanguage as string);

    case 'extract_entities':
      return await extractEntities(text);

    case 'sentiment':
      return await analyzeSentiment(text);

    case 'keywords':
      return await extractKeywords(text, options?.count as number);

    case 'word_count':
      return {
        characters: text.length,
        words: text.split(/\s+/).filter(Boolean).length,
        sentences: text.split(/[.!?]+/).filter(Boolean).length,
        paragraphs: text.split(/\n\n+/).filter(Boolean).length,
      };

    default:
      throw new ToolError('INVALID_INPUT', `Unknown operation: ${operation}`);
  }
};
```

---

## 3. MCP SERVER INTEGRATION

### 3.1 MCP Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      TOOL EXECUTOR                              │
│                                                                 │
│   MCPClient.callTool(server, tool, input)                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ stdio / SSE / HTTP
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     MCP SERVER MANAGER                          │
│                                                                 │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│   │brave-search │  │ filesystem  │  │  postgres   │            │
│   │   (npx)     │  │   (npx)     │  │   (npx)     │            │
│   └─────────────┘  └─────────────┘  └─────────────┘            │
│                                                                 │
│   Server lifecycle:                                             │
│   - Lazy start on first call                                   │
│   - Keep-alive with heartbeat                                  │
│   - Auto-restart on failure                                    │
│   - Graceful shutdown                                          │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 MCP Client Implementation

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * MCP Client - manages connections to MCP servers
 */
class MCPClientManager {
  private clients: Map<string, MCPServerConnection> = new Map();
  private config: MCPConfig;

  constructor(config: MCPConfig) {
    this.config = config;
  }

  /**
   * Call a tool on an MCP server
   */
  async callTool(
    serverName: string,
    toolName: string,
    input: Record<string, unknown>,
    timeout: number
  ): Promise<ToolExecutionResult> {
    const connection = await this.getOrCreateConnection(serverName);

    const startTime = Date.now();

    try {
      const result = await withTimeout(
        connection.client.callTool({ name: toolName, arguments: input }),
        timeout
      );

      return {
        status: 'success',
        output: this.parseToolResult(result),
        metrics: {
          durationMs: Date.now() - startTime,
        },
      };
    } catch (err) {
      if (err.name === 'TimeoutError') {
        return {
          status: 'timeout',
          error: {
            code: 'TIMEOUT',
            message: `Tool ${toolName} timed out after ${timeout}ms`,
            retryable: true,
          },
          metrics: { durationMs: Date.now() - startTime },
        };
      }

      return {
        status: 'failure',
        error: {
          code: 'MCP_ERROR',
          message: err.message,
          retryable: this.isRetryableError(err),
        },
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  }

  /**
   * Get or create connection to MCP server
   */
  private async getOrCreateConnection(serverName: string): Promise<MCPServerConnection> {
    let connection = this.clients.get(serverName);

    if (connection && connection.isHealthy()) {
      return connection;
    }

    // Create new connection
    const serverConfig = this.config.servers[serverName];
    if (!serverConfig) {
      throw new Error(`Unknown MCP server: ${serverName}`);
    }

    connection = await this.createConnection(serverName, serverConfig);
    this.clients.set(serverName, connection);

    return connection;
  }

  /**
   * Create connection to MCP server
   */
  private async createConnection(
    serverName: string,
    config: MCPServerConfig
  ): Promise<MCPServerConnection> {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: { ...process.env, ...config.env },
    });

    const client = new Client(
      { name: 'bakame-platform', version: '1.0.0' },
      { capabilities: {} }
    );

    await client.connect(transport);

    return {
      client,
      transport,
      serverName,
      startedAt: new Date(),
      isHealthy: () => transport.isConnected(),
    };
  }

  /**
   * List available tools from an MCP server
   */
  async listTools(serverName: string): Promise<MCPToolDefinition[]> {
    const connection = await this.getOrCreateConnection(serverName);
    const result = await connection.client.listTools();
    return result.tools;
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    for (const [name, connection] of this.clients) {
      try {
        await connection.client.close();
      } catch (err) {
        console.error(`Error closing MCP server ${name}:`, err);
      }
    }
    this.clients.clear();
  }
}

interface MCPServerConnection {
  client: Client;
  transport: StdioClientTransport;
  serverName: string;
  startedAt: Date;
  isHealthy: () => boolean;
}
```

### 3.3 MCP Server Configuration

```typescript
interface MCPConfig {
  servers: Record<string, MCPServerConfig>;
}

interface MCPServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  healthCheckInterval?: number;
  maxRestarts?: number;
}

// Configuration loaded from environment/config file
const mcpConfig: MCPConfig = {
  servers: {
    'brave-search': {
      command: 'npx',
      args: ['-y', '@anthropic/mcp-server-brave-search'],
      env: {
        BRAVE_API_KEY: process.env.BRAVE_API_KEY!,
      },
    },
    'filesystem': {
      command: 'npx',
      args: ['-y', '@anthropic/mcp-server-filesystem', '/allowed/path'],
      env: {},
    },
    'postgres': {
      command: 'npx',
      args: ['-y', '@anthropic/mcp-server-postgres'],
      env: {
        POSTGRES_CONNECTION_STRING: process.env.POSTGRES_MCP_URL!,
      },
    },
    'github': {
      command: 'npx',
      args: ['-y', '@anthropic/mcp-server-github'],
      env: {
        GITHUB_TOKEN: process.env.GITHUB_TOKEN!,
      },
    },
  },
};
```

### 3.4 MCP Tool Definitions

```typescript
// Tools exposed through MCP servers
const mcpTools: Tool[] = [
  {
    id: 'tool-web-search',
    name: 'web_search',
    description: 'Search the web for current information. Returns relevant results with snippets.',
    type: 'mcp',
    config: {
      server: 'brave-search',
      mcpToolName: 'brave_search',
    },
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        count: { type: 'number', description: 'Number of results (1-20)', default: 10 },
      },
      required: ['query'],
    },
    requiresPermission: 'tool:web_search',
    enabled: true,
    costConfig: {
      fixedCost: 0.01,
      costPerUnit: { unit: 'record', costPerUnit: 0.001, inputField: 'count' },
    },
  },
  {
    id: 'tool-read-file',
    name: 'read_file',
    description: 'Read contents of a file from allowed directories.',
    type: 'mcp',
    config: {
      server: 'filesystem',
      mcpToolName: 'read_file',
    },
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to read' },
      },
      required: ['path'],
    },
    requiresPermission: 'tool:filesystem',
    enabled: true,
    costConfig: { fixedCost: 0 },
  },
  {
    id: 'tool-query-database',
    name: 'query_database',
    description: 'Run read-only SQL queries against the analytics database.',
    type: 'mcp',
    config: {
      server: 'postgres',
      mcpToolName: 'query',
    },
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'SQL query (SELECT only)' },
      },
      required: ['query'],
    },
    requiresPermission: 'tool:database_query',
    enabled: true,
    costConfig: { fixedCost: 0.001 },
  },
];
```

---

## 4. WORKFLOW EXECUTOR (n8n)

### 4.1 Workflow Client Implementation

```typescript
/**
 * N8n Workflow Client
 * Implements WorkflowService interface from Stage 4
 */
class N8nWorkflowClient {
  private baseUrl: string;
  private apiKey: string;
  private webhookSecret: string;

  constructor(config: N8nConfig) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.webhookSecret = config.webhookSecret;
  }

  /**
   * Invoke workflow synchronously (wait for result)
   */
  async invoke(params: WorkflowInvocation): Promise<WorkflowResult> {
    const workflow = await this.getWorkflowConfig(params.workflowId);
    const startTime = Date.now();

    try {
      const response = await fetch(
        `${this.baseUrl}/webhook/${workflow.webhookPath}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Secret': this.webhookSecret,
            'X-Request-Id': params.requestId,
            'X-Idempotency-Key': params.idempotencyKey,
          },
          body: JSON.stringify({
            ...params.input,
            _metadata: {
              requestId: params.requestId,
              userId: params.metadata?.userId,
              chatId: params.metadata?.chatId,
              triggeredBy: params.metadata?.triggeredBy,
            },
          }),
          signal: AbortSignal.timeout(params.timeout),
        }
      );

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          status: 'failure',
          error: {
            code: 'N8N_ERROR',
            message: `Workflow returned ${response.status}: ${errorBody}`,
          },
          durationMs: Date.now() - startTime,
        };
      }

      const output = await response.json();

      return {
        status: 'success',
        output,
        executionId: response.headers.get('x-n8n-execution-id') || undefined,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        return {
          status: 'timeout',
          error: {
            code: 'TIMEOUT',
            message: `Workflow timed out after ${params.timeout}ms`,
          },
          durationMs: Date.now() - startTime,
        };
      }

      return {
        status: 'failure',
        error: {
          code: 'INVOCATION_ERROR',
          message: err.message,
        },
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Invoke workflow asynchronously (fire and forget)
   */
  async invokeAsync(params: WorkflowInvocation): Promise<{ invocationId: string }> {
    // Check idempotency
    const existing = await this.checkIdempotency(params.idempotencyKey);
    if (existing) {
      return { invocationId: existing.invocationId };
    }

    // Create invocation record
    const invocationId = generateUUIDv7();
    await this.createInvocationRecord({
      id: invocationId,
      workflowId: params.workflowId,
      idempotencyKey: params.idempotencyKey,
      input: params.input,
      status: 'pending',
      createdAt: new Date(),
    });

    // Enqueue for processing
    await this.enqueueWorkflow({
      invocationId,
      ...params,
    });

    return { invocationId };
  }

  /**
   * Handle incoming webhook from n8n (workflow completion callback)
   */
  async handleWebhook(params: WorkflowWebhook): Promise<void> {
    // Verify webhook signature
    if (!this.verifyWebhookSignature(params)) {
      throw new Error('Invalid webhook signature');
    }

    // Update invocation record
    await this.updateInvocationRecord(params.invocationId, {
      status: params.success ? 'success' : 'failure',
      output: params.output,
      error: params.error,
      completedAt: new Date(),
    });

    // Emit event for any listeners
    await this.emitWorkflowComplete(params);
  }
}
```

### 4.2 Workflow Tool Definitions

```typescript
// Tools backed by n8n workflows
const workflowTools: Tool[] = [
  {
    id: 'tool-send-email',
    name: 'send_email',
    description: 'Send an email. Always confirm with user before sending.',
    type: 'workflow',
    config: {
      workflowId: 'wf-send-email',
      webhookPath: 'send-email',
      timeout: 30000,
    },
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject line' },
        body: { type: 'string', description: 'Email body (plain text or HTML)' },
        isHtml: { type: 'boolean', description: 'Whether body is HTML', default: false },
      },
      required: ['to', 'subject', 'body'],
    },
    requiresPermission: 'tool:send_email',
    enabled: true,
    costConfig: { fixedCost: 0.001 },
  },
  {
    id: 'tool-create-calendar-event',
    name: 'create_calendar_event',
    description: 'Create a calendar event. Requires user confirmation.',
    type: 'workflow',
    config: {
      workflowId: 'wf-calendar-create',
      webhookPath: 'calendar-create',
      timeout: 30000,
    },
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Event title' },
        description: { type: 'string', description: 'Event description' },
        startTime: { type: 'string', format: 'date-time', description: 'Start time (ISO 8601)' },
        endTime: { type: 'string', format: 'date-time', description: 'End time (ISO 8601)' },
        attendees: { type: 'array', items: { type: 'string' }, description: 'Attendee emails' },
      },
      required: ['title', 'startTime', 'endTime'],
    },
    requiresPermission: 'tool:calendar',
    enabled: true,
    costConfig: { fixedCost: 0.001 },
  },
  {
    id: 'tool-send-notification',
    name: 'send_notification',
    description: 'Send a push notification to user devices.',
    type: 'workflow',
    config: {
      workflowId: 'wf-send-notification',
      webhookPath: 'send-notification',
      timeout: 10000,
    },
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Notification title' },
        body: { type: 'string', description: 'Notification body' },
        data: { type: 'object', description: 'Custom data payload' },
      },
      required: ['title', 'body'],
    },
    requiresPermission: 'tool:notifications',
    enabled: true,
    costConfig: { fixedCost: 0 },
  },
];
```

### 4.3 Workflow Retry Logic

```typescript
/**
 * Execute workflow with retry policy
 */
async function executeWithRetry(
  client: N8nWorkflowClient,
  params: WorkflowInvocation,
  policy: RetryPolicy
): Promise<WorkflowResult> {
  let lastError: WorkflowResult | null = null;
  let delay = policy.initialDelayMs;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    const result = await client.invoke(params);

    // Success - return immediately
    if (result.status === 'success') {
      return result;
    }

    lastError = result;

    // Check if error is retryable
    if (!isRetryableError(result.error?.code, policy.retryableErrors)) {
      return result;
    }

    // Check if we have more attempts
    if (attempt === policy.maxAttempts) {
      return result;
    }

    // Wait before retry
    await sleep(delay);
    delay = Math.min(delay * policy.backoffMultiplier, policy.maxDelayMs);
  }

  return lastError!;
}

function isRetryableError(code: string | undefined, retryableCodes: string[]): boolean {
  if (!code) return false;
  return retryableCodes.includes(code);
}
```

---

## 5. BACKGROUND WORKERS

### 5.1 Worker Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        UPSTASH QSTASH                           │
│                     (Message Queue)                             │
└─────────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
          ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ Embedding       │ │ Workflow        │ │ Notification    │
│ Worker          │ │ Worker          │ │ Worker          │
│                 │ │                 │ │                 │
│ - Generate      │ │ - Execute       │ │ - Send push     │
│   embeddings    │ │   async flows   │ │ - Send email    │
│ - Update        │ │ - Handle        │ │ - Log delivery  │
│   vectors       │ │   callbacks     │ │                 │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

### 5.2 Worker Implementation

```typescript
import { Client as QStashClient } from '@upstash/qstash';

/**
 * Background job processor using Upstash QStash
 */
class BackgroundWorker {
  private qstash: QStashClient;
  private handlers: Map<string, JobHandler>;

  constructor() {
    this.qstash = new QStashClient({
      token: process.env.QSTASH_TOKEN!,
    });
    this.handlers = new Map();
  }

  /**
   * Register a job handler
   */
  registerHandler(jobType: string, handler: JobHandler): void {
    this.handlers.set(jobType, handler);
  }

  /**
   * Enqueue a job for background processing
   */
  async enqueue(job: BackgroundJob): Promise<string> {
    const messageId = await this.qstash.publishJSON({
      url: `${process.env.WORKER_ENDPOINT}/jobs/${job.type}`,
      body: job,
      retries: job.retries ?? 3,
      delay: job.delay,
    });

    return messageId;
  }

  /**
   * Process incoming job (called by webhook endpoint)
   */
  async process(jobType: string, payload: unknown): Promise<void> {
    const handler = this.handlers.get(jobType);
    if (!handler) {
      throw new Error(`Unknown job type: ${jobType}`);
    }

    await handler(payload as BackgroundJob);
  }
}

interface BackgroundJob {
  type: string;
  payload: Record<string, unknown>;
  retries?: number;
  delay?: number;  // Delay in seconds
  idempotencyKey?: string;
}

type JobHandler = (job: BackgroundJob) => Promise<void>;
```

### 5.3 Embedding Worker

```typescript
/**
 * Embedding Worker - generates vector embeddings for knowledge/memories
 */
const embeddingWorker: JobHandler = async (job) => {
  const { type, id, content } = job.payload as {
    type: 'knowledge' | 'memory';
    id: string;
    content: string;
  };

  // Generate embedding
  const embedding = await embeddingService.generateEmbedding(content);

  // Store based on type
  if (type === 'knowledge') {
    await knowledgeService.updateEmbedding(SYSTEM_ACTOR, id, embedding);
  } else {
    await memoryService.updateEmbedding(SYSTEM_ACTOR, id, embedding);
  }

  // Log completion
  await auditService.log(SYSTEM_ACTOR, {
    action: 'embedding.generated',
    resourceType: type,
    resourceId: id,
    metadata: { vectorDimensions: embedding.length },
  });
};

// Register handler
backgroundWorker.registerHandler('generate_embedding', embeddingWorker);
```

### 5.4 Workflow Worker

```typescript
/**
 * Workflow Worker - executes async workflow invocations
 */
const workflowWorker: JobHandler = async (job) => {
  const invocation = job.payload as WorkflowInvocation & { invocationId: string };

  // Get workflow config
  const workflow = await workflowService.getWorkflow(SYSTEM_ACTOR, invocation.workflowId);
  if (!workflow.success) {
    throw new Error(`Workflow not found: ${invocation.workflowId}`);
  }

  // Execute with retry
  const result = await executeWithRetry(
    n8nClient,
    invocation,
    workflow.data.retryPolicy
  );

  // Update invocation record
  await workflowService.updateInvocationStatus(SYSTEM_ACTOR, invocation.invocationId, {
    status: result.status,
    output: result.output,
    error: result.error,
    completedAt: new Date(),
    durationMs: result.durationMs,
  });

  // Log completion
  await auditService.log(SYSTEM_ACTOR, {
    action: 'workflow.completed',
    resourceType: 'workflow_invocation',
    resourceId: invocation.invocationId,
    metadata: {
      workflowId: invocation.workflowId,
      status: result.status,
      durationMs: result.durationMs,
    },
  });
};

backgroundWorker.registerHandler('execute_workflow', workflowWorker);
```

### 5.5 Notification Worker

```typescript
/**
 * Notification Worker - sends push notifications
 */
const notificationWorker: JobHandler = async (job) => {
  const { userId, title, body, data } = job.payload as {
    userId: string;
    title: string;
    body: string;
    data?: Record<string, unknown>;
  };

  // Get user's push tokens
  const tokens = await userService.getPushTokens(SYSTEM_ACTOR, userId);
  if (!tokens.success || tokens.data.length === 0) {
    return;  // No tokens, nothing to do
  }

  // Send to each token
  const results = await Promise.allSettled(
    tokens.data.map(token =>
      pushService.send({
        token: token.token,
        platform: token.platform,
        title,
        body,
        data,
      })
    )
  );

  // Clean up invalid tokens
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'rejected' && result.reason?.code === 'INVALID_TOKEN') {
      await userService.removePushToken(SYSTEM_ACTOR, tokens.data[i].id);
    }
  }

  // Log
  await auditService.log(SYSTEM_ACTOR, {
    action: 'notification.sent',
    resourceType: 'user',
    resourceId: userId,
    metadata: {
      title,
      tokenCount: tokens.data.length,
      successCount: results.filter(r => r.status === 'fulfilled').length,
    },
  });
};

backgroundWorker.registerHandler('send_notification', notificationWorker);
```

### 5.6 Worker Webhook Endpoint

```typescript
/**
 * Webhook endpoint for QStash to deliver jobs
 */
app.post('/jobs/:type', async (c) => {
  // Verify QStash signature
  const signature = c.req.header('upstash-signature');
  if (!verifyQStashSignature(signature, await c.req.text())) {
    return c.json({ error: 'Invalid signature' }, 401);
  }

  const jobType = c.req.param('type');
  const payload = await c.req.json();

  try {
    await backgroundWorker.process(jobType, payload);
    return c.json({ success: true });
  } catch (err) {
    console.error(`Job ${jobType} failed:`, err);
    // Return 500 to trigger QStash retry
    return c.json({ error: err.message }, 500);
  }
});
```

---

## 6. TOOL COST TRACKING

### 6.1 Cost Estimation Implementation

```typescript
/**
 * Estimate tool cost before execution
 * Implementation of ToolService.estimateCost() from Stage 4
 */
async function estimateToolCost(
  tool: Tool,
  input: Record<string, unknown>
): Promise<ToolCostEstimate> {
  const config = tool.costConfig;

  if (!config) {
    return {
      estimatedCost: 0,
      estimatedLatencyMs: 1000,
      confidence: 'unknown',
    };
  }

  let cost = 0;

  // Fixed cost
  if (config.fixedCost) {
    cost += config.fixedCost;
  }

  // Dynamic cost based on input
  if (config.costPerUnit) {
    const inputValue = input[config.costPerUnit.inputField];
    let units = 0;

    switch (config.costPerUnit.unit) {
      case 'token':
        // Estimate tokens from string length
        units = typeof inputValue === 'string'
          ? Math.ceil(inputValue.length / 4)  // ~4 chars per token
          : 0;
        break;

      case 'character':
        units = typeof inputValue === 'string' ? inputValue.length : 0;
        break;

      case 'record':
        units = typeof inputValue === 'number' ? inputValue : 1;
        break;

      case 'second':
        // Estimated execution time
        units = tool.config.timeout ? tool.config.timeout / 1000 : 30;
        break;
    }

    cost += units * config.costPerUnit.costPerUnit;
  }

  // Estimated latency
  const estimatedLatencyMs = tool.config.timeout || 30000;

  return {
    estimatedCost: cost,
    estimatedTokens: config.costPerUnit?.unit === 'token'
      ? Math.ceil((input[config.costPerUnit.inputField] as string)?.length / 4)
      : undefined,
    estimatedLatencyMs,
    confidence: config.fixedCost !== undefined ? 'exact' : 'estimate',
  };
}
```

### 6.2 Cost Recording

```typescript
/**
 * Record actual tool cost after execution
 */
async function recordToolCost(
  actor: ActorContext,
  invocationId: string,
  result: ToolExecutionResult,
  tool: Tool
): Promise<void> {
  // Calculate actual cost
  let actualCost = tool.costConfig?.fixedCost || 0;

  if (result.metrics.tokensUsed && tool.costConfig?.costPerUnit?.unit === 'token') {
    actualCost += result.metrics.tokensUsed * tool.costConfig.costPerUnit.costPerUnit;
  }

  // Override if result includes actual cost
  if (result.metrics.costIncurred !== undefined) {
    actualCost = result.metrics.costIncurred;
  }

  // Record to usage
  await subscriptionService.recordUsage(SYSTEM_ACTOR, {
    userId: actor.userId!,
    featureCode: 'tool_invocations',
    quantity: 1,
    invocationId,
  });

  // Record cost if non-zero
  if (actualCost > 0) {
    await subscriptionService.recordUsage(SYSTEM_ACTOR, {
      userId: actor.userId!,
      featureCode: 'tool_cost',
      quantity: actualCost,
      invocationId,
    });
  }

  // Update invocation log with actual cost
  await toolService.updateInvocationCost(SYSTEM_ACTOR, invocationId, {
    actualCost,
    tokensUsed: result.metrics.tokensUsed,
  });
}
```

### 6.3 Budget Checking

```typescript
/**
 * Check if user has budget for tool execution
 */
async function checkToolBudget(
  actor: ActorContext,
  estimate: ToolCostEstimate
): Promise<{ allowed: boolean; reason?: string }> {
  // Get user's remaining budget
  const usage = await subscriptionService.getUsageSummary(actor, actor.userId!, {
    periodStart: startOfDay(),
    periodEnd: endOfDay(),
  });

  const toolCostUsage = usage.data?.find(u => u.featureCode === 'tool_cost');
  const entitlement = await subscriptionService.getEntitlementValue(
    actor,
    actor.userId!,
    'daily_tool_budget'
  );

  if (!entitlement.success || !entitlement.data) {
    // No budget limit
    return { allowed: true };
  }

  const currentUsage = toolCostUsage?.quantity || 0;
  const limit = entitlement.data.value as number;
  const projected = currentUsage + estimate.estimatedCost;

  if (projected > limit) {
    return {
      allowed: false,
      reason: `Daily tool budget exceeded. Used: $${currentUsage.toFixed(4)}, Limit: $${limit.toFixed(4)}`,
    };
  }

  return { allowed: true };
}
```

---

## 7. SECURITY & SANDBOXING

### 7.1 Input Validation

```typescript
/**
 * Validate tool input against schema
 */
function validateToolInput(
  input: Record<string, unknown>,
  schema: JSONSchema
): ValidationResult {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  const valid = validate(input);

  if (!valid) {
    return {
      valid: false,
      errors: validate.errors?.map(e => ({
        path: e.instancePath,
        message: e.message || 'Invalid value',
      })),
    };
  }

  return { valid: true };
}

/**
 * Sanitize tool input - remove dangerous patterns
 */
function sanitizeInput(input: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') {
      // Remove potential injection patterns
      sanitized[key] = value
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+=/gi, '');
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeInput(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
```

### 7.2 Output Sanitization

```typescript
/**
 * Sanitize tool output before returning to AI
 */
function sanitizeOutput(output: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(output)) {
    // Skip sensitive fields
    if (SENSITIVE_FIELD_PATTERNS.some(p => p.test(key))) {
      sanitized[key] = '[REDACTED]';
      continue;
    }

    if (typeof value === 'string') {
      // Truncate very long strings
      sanitized[key] = value.length > MAX_OUTPUT_STRING_LENGTH
        ? value.substring(0, MAX_OUTPUT_STRING_LENGTH) + '...[truncated]'
        : value;
    } else if (Array.isArray(value)) {
      // Limit array length
      sanitized[key] = value.slice(0, MAX_OUTPUT_ARRAY_LENGTH);
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeOutput(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

const SENSITIVE_FIELD_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /credential/i,
  /private[_-]?key/i,
];

const MAX_OUTPUT_STRING_LENGTH = 10000;
const MAX_OUTPUT_ARRAY_LENGTH = 100;
```

### 7.3 Rate Limiting Per Tool

```typescript
/**
 * Tool-specific rate limiting
 */
class ToolRateLimiter {
  private redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async checkLimit(
    userId: string,
    toolId: string,
    limits: ToolRateLimit
  ): Promise<{ allowed: boolean; retryAfter?: number }> {
    const key = `tool_rate:${userId}:${toolId}`;

    // Get current count
    const current = await this.redis.get(key);
    const count = current ? parseInt(current, 10) : 0;

    if (count >= limits.maxPerHour) {
      const ttl = await this.redis.ttl(key);
      return { allowed: false, retryAfter: ttl };
    }

    // Increment
    await this.redis.incr(key);
    if (count === 0) {
      await this.redis.expire(key, 3600);  // 1 hour
    }

    return { allowed: true };
  }
}

interface ToolRateLimit {
  maxPerHour: number;
  maxPerDay?: number;
}
```

### 7.4 MCP Server Isolation

```typescript
/**
 * Security configuration for MCP servers
 */
interface MCPSecurityConfig {
  // Allowed paths for filesystem server
  allowedPaths: string[];

  // Blocked paths (never allowed even if in allowedPaths)
  blockedPaths: string[];

  // Database: read-only queries only
  readOnlyDatabase: boolean;

  // Network: allowed domains for external calls
  allowedDomains: string[];

  // Resource limits
  maxExecutionTime: number;
  maxMemoryMb: number;
  maxOutputSize: number;
}

const defaultSecurityConfig: MCPSecurityConfig = {
  allowedPaths: ['/data/user-files', '/data/knowledge'],
  blockedPaths: ['/etc', '/var', '/root', '.env', 'credentials'],
  readOnlyDatabase: true,
  allowedDomains: ['api.brave.com', 'api.github.com'],
  maxExecutionTime: 30000,
  maxMemoryMb: 256,
  maxOutputSize: 1024 * 1024,  // 1MB
};
```

---

## 8. TOOL EXECUTOR FACTORY

### 8.1 Unified Executor

```typescript
/**
 * Tool Executor Factory - routes to appropriate executor
 */
class ToolExecutorFactory implements ToolExecutor {
  private localExecutor: LocalToolExecutor;
  private mcpClient: MCPClientManager;
  private workflowClient: N8nWorkflowClient;

  constructor(deps: ToolExecutorDependencies) {
    this.localExecutor = new LocalToolExecutor(deps.localHandlers);
    this.mcpClient = deps.mcpClient;
    this.workflowClient = deps.workflowClient;
  }

  async execute(params: ToolExecutionParams): Promise<ToolExecutionResult> {
    const { tool, input, context } = params;

    // Validate input
    const validation = validateToolInput(input, tool.inputSchema);
    if (!validation.valid) {
      return {
        status: 'failure',
        error: {
          code: 'VALIDATION_ERROR',
          message: `Invalid input: ${validation.errors?.map(e => e.message).join(', ')}`,
          retryable: false,
        },
        metrics: { durationMs: 0 },
      };
    }

    // Sanitize input
    const sanitizedInput = sanitizeInput(input);

    // Route to appropriate executor
    let result: ToolExecutionResult;

    switch (tool.type) {
      case 'local':
        result = await this.localExecutor.execute({
          tool,
          input: sanitizedInput,
          context,
        });
        break;

      case 'mcp':
        result = await this.executeMCP(tool, sanitizedInput, context);
        break;

      case 'workflow':
        result = await this.executeWorkflow(tool, sanitizedInput, context);
        break;

      default:
        return {
          status: 'failure',
          error: {
            code: 'UNKNOWN_TOOL_TYPE',
            message: `Unknown tool type: ${tool.type}`,
            retryable: false,
          },
          metrics: { durationMs: 0 },
        };
    }

    // Sanitize output
    if (result.status === 'success' && result.output) {
      result.output = sanitizeOutput(result.output);
    }

    return result;
  }

  private async executeMCP(
    tool: Tool,
    input: Record<string, unknown>,
    context: ToolExecutionParams['context']
  ): Promise<ToolExecutionResult> {
    const { server, mcpToolName } = tool.config as { server: string; mcpToolName: string };

    return this.mcpClient.callTool(
      server,
      mcpToolName,
      input,
      context.timeout
    );
  }

  private async executeWorkflow(
    tool: Tool,
    input: Record<string, unknown>,
    context: ToolExecutionParams['context']
  ): Promise<ToolExecutionResult> {
    const { workflowId, timeout } = tool.config as { workflowId: string; timeout: number };

    const invocation: WorkflowInvocation = {
      workflowId,
      input,
      timeout: timeout || context.timeout,
      requestId: context.requestId,
      idempotencyKey: generateIdempotencyKey({
        workflowId,
        input,
        triggeredBy: 'ai',
      }),
      metadata: {
        userId: context.userId,
        triggeredBy: 'ai',
      },
    };

    const result = await this.workflowClient.invoke(invocation);

    return {
      status: result.status,
      output: result.output,
      error: result.error ? {
        code: result.error.code,
        message: result.error.message,
        retryable: result.status === 'timeout',
      } : undefined,
      metrics: {
        durationMs: result.durationMs,
      },
    };
  }

  canHandle(toolType: ToolType): boolean {
    return ['local', 'mcp', 'workflow'].includes(toolType);
  }

  async healthCheck(): Promise<HealthStatus> {
    const checks: Record<string, boolean> = {};

    // Check local tools
    checks.local = true;

    // Check MCP servers
    try {
      for (const serverName of Object.keys(mcpConfig.servers)) {
        await this.mcpClient.listTools(serverName);
        checks[`mcp:${serverName}`] = true;
      }
    } catch {
      checks.mcp = false;
    }

    // Check workflow client
    try {
      // Simple health check ping
      checks.workflow = true;
    } catch {
      checks.workflow = false;
    }

    const healthy = Object.values(checks).every(Boolean);

    return {
      healthy,
      checks,
      timestamp: new Date().toISOString(),
    };
  }
}
```

---

## 9. FILE STRUCTURE

```
src/
├── tools/
│   ├── index.ts                    # Tool executor factory
│   ├── types.ts                    # Tool type definitions
│   ├── local/
│   │   ├── index.ts                # Local tool registry
│   │   ├── calculator.ts           # Calculator tool
│   │   ├── datetime.ts             # DateTime tool
│   │   ├── reasoning.ts            # Deep reasoning tool
│   │   ├── json-parser.ts          # JSON parser tool
│   │   └── text-transform.ts       # Text transform tool
│   ├── mcp/
│   │   ├── client.ts               # MCP client manager
│   │   ├── config.ts               # MCP server configuration
│   │   └── tools.ts                # MCP tool definitions
│   ├── workflow/
│   │   ├── client.ts               # N8n workflow client
│   │   ├── retry.ts                # Retry logic
│   │   └── tools.ts                # Workflow tool definitions
│   ├── security/
│   │   ├── validation.ts           # Input validation
│   │   ├── sanitization.ts         # Output sanitization
│   │   └── rate-limit.ts           # Tool rate limiting
│   └── cost/
│       ├── estimation.ts           # Cost estimation
│       ├── tracking.ts             # Cost tracking
│       └── budget.ts               # Budget checking
├── workers/
│   ├── index.ts                    # Worker registration
│   ├── embedding.ts                # Embedding worker
│   ├── workflow.ts                 # Workflow worker
│   └── notification.ts             # Notification worker
└── services/                       # Service layer (Stage 2)
```

---

## 10. TOOL REGISTRY (INITIAL SET)

### 10.1 Local Tools

| Tool | Description | Cost |
|------|-------------|------|
| `calculator` | Math expression evaluation | Free |
| `datetime` | Date/time operations | Free |
| `deep_reasoning` | Complex reasoning via specialized model | ~$0.14/1M tokens |
| `json_parser` | Extract JSON from text | Free |
| `text_transform` | Summarize, translate, extract | Varies |

### 10.2 MCP Tools

| Tool | Server | Description | Cost |
|------|--------|-------------|------|
| `web_search` | brave-search | Web search | ~$0.01/search |
| `read_file` | filesystem | Read files | Free |
| `query_database` | postgres | SQL queries | ~$0.001/query |

### 10.3 Workflow Tools

| Tool | Workflow | Description | Cost |
|------|----------|-------------|------|
| `send_email` | wf-send-email | Send emails | ~$0.001 |
| `create_calendar_event` | wf-calendar-create | Calendar integration | ~$0.001 |
| `send_notification` | wf-send-notification | Push notifications | Free |

---

## 11. ASSUMPTIONS & NOTES

### 11.1 Assumptions

1. Upstash QStash is used for background jobs
2. MCP servers run as child processes (npx)
3. n8n is available via webhook endpoints
4. API keys are stored in environment variables

### 11.2 Notes for Implementation

- Start with local tools (no external dependencies)
- Add MCP servers incrementally
- Test workflow integration with mock n8n first
- Implement cost tracking early for budget alerts

### 11.3 Security Notes

- MCP servers run in isolated processes
- Filesystem access is path-restricted
- Database queries are read-only
- All outputs are sanitized before returning to AI

---

## 12. NEXT STEPS

Stage 5 is now approved. Next:

1. **Stage 6: Frontend Contracts** — Flutter integration contracts
2. **Implement local tools** — Calculator, DateTime, Text
3. **Set up MCP integration** — Brave Search first
4. **Implement workflow client** — n8n webhook calls
5. **Set up background workers** — Upstash QStash

---

## APPROVAL RECORD

**Status**: ✅ APPROVED & LOCKED

**Non-Blocking Hardening Notes** (for future implementation):

| # | Note | Description | Priority |
|---|------|-------------|----------|
| 1 | **Idempotency in Workers** | Enforce deduplication at handler entry using Redis SETNX before processing | v1.1 |
| 2 | **QStash Payload Size Guard** | Add max payload size check in `/jobs/:type` to prevent vector/blob abuse | v1.1 |
| 3 | **MCP Restart Limits** | `maxRestarts` is defined but not enforced yet — implement circuit breaker | v1.1 |

**Implementation Note**: These hardening measures are not blockers for v1 but should be addressed before production scale.

**This document is now IMMUTABLE. Any changes require a new design review.**
