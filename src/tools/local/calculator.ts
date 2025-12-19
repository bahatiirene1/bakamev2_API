/**
 * Calculator Tool
 * Phase 4: Tool Execution Layer
 *
 * Reference: docs/stage-5-tool-execution.md Section 2.2
 *
 * Safe math expression evaluation without code injection risks
 */

import type { LocalToolHandler, ToolExecutionContext } from '../types.js';
import { ToolError } from '../types.js';

/**
 * Allowed math functions and constants
 */
const MATH_FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  log: Math.log,
  log10: Math.log10,
  log2: Math.log2,
  exp: Math.exp,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  pow: Math.pow,
  min: Math.min,
  max: Math.max,
};

const MATH_CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
};

/**
 * Validate math expression - only allow safe operations
 * Prevents code injection attacks
 */
export function isValidMathExpression(expr: string): boolean {
  if (!expr || typeof expr !== 'string') {
    return false;
  }

  const trimmed = expr.trim();
  if (trimmed.length === 0) {
    return false;
  }

  // Dangerous patterns that could indicate code injection
  const dangerousPatterns = [
    /import\b/i,
    /require\b/i,
    /eval\b/i,
    /function\b/i,
    /=>/,
    /\$/,
    /;/,
    /&&/,
    /\|\|/,
    /`/,
    /\[/,
    /\]/,
    /\{/,
    /\}/,
    /"/,
    /'/,
    /new\b/i,
    /this\b/i,
    /window\b/i,
    /global\b/i,
    /process\b/i,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(trimmed)) {
      return false;
    }
  }

  // Build allowed pattern from known functions and constants
  const allowedFunctions = Object.keys(MATH_FUNCTIONS).join('|');
  const allowedConstants = Object.keys(MATH_CONSTANTS).join('|');

  // Safe pattern: numbers, operators, parentheses, commas, spaces, and allowed functions/constants
  // This is intentionally restrictive
  const safePattern = new RegExp(
    `^[\\d\\s+\\-*/().^%,]*(${allowedFunctions}|${allowedConstants}|[\\d\\s+\\-*/().^%,])*$`,
    'i'
  );

  return safePattern.test(trimmed);
}

/**
 * Tokenize a math expression
 */
function tokenize(expr: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let i = 0;

  while (i < expr.length) {
    const char = expr[i] as string;

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      i++;
      continue;
    }

    if (/[\d.]/.test(char)) {
      current += char;
      i++;
      continue;
    }

    if (/[a-zA-Z]/.test(char)) {
      current += char;
      i++;
      continue;
    }

    if (/[+\-*/%^(),]/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      tokens.push(char);
      i++;
      continue;
    }

    i++;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * Parse and evaluate the expression using a simple recursive descent parser
 */
function evaluate(expr: string): number {
  const tokens = tokenize(expr);
  let pos = 0;

  function peek(): string | undefined {
    return tokens[pos];
  }

  function consume(): string {
    return tokens[pos++] as string;
  }

  function parseExpression(): number {
    return parseAddSub();
  }

  function parseAddSub(): number {
    let left = parseMulDiv();

    while (peek() === '+' || peek() === '-') {
      const op = consume();
      const right = parseMulDiv();
      if (op === '+') {
        left = left + right;
      } else {
        left = left - right;
      }
    }

    return left;
  }

  function parseMulDiv(): number {
    let left = parsePower();

    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = consume();
      const right = parsePower();
      if (op === '*') {
        left = left * right;
      } else if (op === '/') {
        left = left / right;
      } else {
        left = left % right;
      }
    }

    return left;
  }

  function parsePower(): number {
    let left = parseUnary();

    while (peek() === '^') {
      consume();
      const right = parseUnary();
      left = Math.pow(left, right);
    }

    return left;
  }

  function parseUnary(): number {
    if (peek() === '-') {
      consume();
      return -parsePrimary();
    }
    if (peek() === '+') {
      consume();
      return parsePrimary();
    }
    return parsePrimary();
  }

  function parsePrimary(): number {
    const token = peek();

    if (token === undefined) {
      throw new Error('Unexpected end of expression');
    }

    // Parenthesized expression
    if (token === '(') {
      consume();
      const value = parseExpression();
      if (peek() !== ')') {
        throw new Error('Missing closing parenthesis');
      }
      consume();
      return value;
    }

    // Number
    if (/^[\d.]+$/.test(token)) {
      consume();
      return parseFloat(token);
    }

    // Constant
    const lowerToken = token.toLowerCase();
    if (lowerToken in MATH_CONSTANTS) {
      consume();
      return MATH_CONSTANTS[lowerToken] as number;
    }

    // Function call
    if (lowerToken in MATH_FUNCTIONS) {
      consume();
      if (peek() !== '(') {
        throw new Error(`Expected '(' after function ${token}`);
      }
      consume();

      const args: number[] = [];
      if (peek() !== ')') {
        args.push(parseExpression());
        while (peek() === ',') {
          consume();
          args.push(parseExpression());
        }
      }

      if (peek() !== ')') {
        throw new Error('Missing closing parenthesis for function');
      }
      consume();

      const fn = MATH_FUNCTIONS[lowerToken];
      if (!fn) {
        throw new Error(`Unknown function: ${token}`);
      }
      return fn(...args);
    }

    throw new Error(`Unexpected token: ${token}`);
  }

  const result = parseExpression();

  if (pos < tokens.length) {
    throw new Error(`Unexpected token: ${tokens[pos]}`);
  }

  return result;
}

/**
 * Calculator handler - safe math expression evaluation
 */
export const calculatorHandler: LocalToolHandler = (
  input: Record<string, unknown>,
  _context: ToolExecutionContext
): Promise<Record<string, unknown>> => {
  const { expression } = input;

  // Validate input
  if (expression === undefined || expression === null) {
    return Promise.reject(
      new ToolError('VALIDATION_ERROR', 'Expression is required')
    );
  }

  if (typeof expression !== 'string') {
    return Promise.reject(
      new ToolError('VALIDATION_ERROR', 'Expression must be a string')
    );
  }

  const trimmed = expression.trim();

  // Validate expression is safe
  if (!isValidMathExpression(trimmed)) {
    return Promise.reject(
      new ToolError('VALIDATION_ERROR', 'Invalid math expression')
    );
  }

  try {
    const result = evaluate(trimmed);

    return Promise.resolve({
      expression: trimmed,
      result,
      resultType: typeof result,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Evaluation failed';
    return Promise.reject(new ToolError('EVALUATION_ERROR', message));
  }
};

/**
 * Calculator tool definition
 */
export const calculatorToolDefinition = {
  name: 'calculator',
  description:
    'Evaluate mathematical expressions. Supports basic arithmetic (+, -, *, /, %), powers (^), ' +
    'roots (sqrt), trigonometry (sin, cos, tan), logarithms (log, log10), and constants (pi, e).',
  type: 'local' as const,
  config: {},
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
  outputSchema: {
    type: 'object',
    properties: {
      expression: { type: 'string' },
      result: { type: 'number' },
      resultType: { type: 'string' },
    },
  },
  estimatedCost: { tokens: 0, latencyMs: 10, apiCost: 0 },
};
