/**
 * Calculator Tool Tests
 * Phase 4: Tool Execution Layer - TDD
 *
 * Reference: docs/stage-5-tool-execution.md Section 2.2
 */

import { describe, it, expect } from 'vitest';

import {
  calculatorHandler,
  isValidMathExpression,
} from '@/tools/local/calculator.js';
import type { ToolExecutionContext } from '@/tools/types.js';

const defaultContext: ToolExecutionContext = {
  userId: 'user-123',
  chatId: 'chat-456',
  requestId: 'req-789',
  timeout: 5000,
};

describe('Calculator Tool', () => {
  describe('isValidMathExpression', () => {
    it('should accept basic arithmetic', () => {
      expect(isValidMathExpression('2 + 2')).toBe(true);
      expect(isValidMathExpression('10 - 5')).toBe(true);
      expect(isValidMathExpression('3 * 4')).toBe(true);
      expect(isValidMathExpression('20 / 4')).toBe(true);
    });

    it('should accept parentheses', () => {
      expect(isValidMathExpression('(2 + 3) * 4')).toBe(true);
      expect(isValidMathExpression('((1 + 2) * (3 + 4))')).toBe(true);
    });

    it('should accept powers and roots', () => {
      expect(isValidMathExpression('2^3')).toBe(true);
      expect(isValidMathExpression('sqrt(16)')).toBe(true);
      expect(isValidMathExpression('pow(2, 10)')).toBe(true);
    });

    it('should accept trigonometric functions', () => {
      expect(isValidMathExpression('sin(0)')).toBe(true);
      expect(isValidMathExpression('cos(3.14)')).toBe(true);
      expect(isValidMathExpression('tan(45)')).toBe(true);
    });

    it('should accept decimals', () => {
      expect(isValidMathExpression('3.14 * 2')).toBe(true);
      expect(isValidMathExpression('0.5 + 0.25')).toBe(true);
    });

    it('should accept modulo', () => {
      expect(isValidMathExpression('10 % 3')).toBe(true);
    });

    it('should reject code injection attempts', () => {
      expect(isValidMathExpression('eval("alert(1)")')).toBe(false);
      expect(isValidMathExpression('import fs')).toBe(false);
      expect(isValidMathExpression('require("fs")')).toBe(false);
      expect(isValidMathExpression('function() {}')).toBe(false);
      expect(isValidMathExpression('() => {}')).toBe(false);
      expect(isValidMathExpression('$PATH')).toBe(false);
    });

    it('should reject empty expressions', () => {
      expect(isValidMathExpression('')).toBe(false);
      expect(isValidMathExpression('   ')).toBe(false);
    });

    it('should reject special characters', () => {
      expect(isValidMathExpression('2 + 2; rm -rf /')).toBe(false);
      expect(isValidMathExpression('2 && 3')).toBe(false);
      expect(isValidMathExpression('2 || 3')).toBe(false);
    });
  });

  describe('calculatorHandler', () => {
    it('should evaluate basic addition', async () => {
      const result = await calculatorHandler(
        { expression: '2 + 2' },
        defaultContext
      );
      expect(result.expression).toBe('2 + 2');
      expect(result.result).toBe(4);
      expect(result.resultType).toBe('number');
    });

    it('should evaluate subtraction', async () => {
      const result = await calculatorHandler(
        { expression: '10 - 3' },
        defaultContext
      );
      expect(result.result).toBe(7);
    });

    it('should evaluate multiplication', async () => {
      const result = await calculatorHandler(
        { expression: '6 * 7' },
        defaultContext
      );
      expect(result.result).toBe(42);
    });

    it('should evaluate division', async () => {
      const result = await calculatorHandler(
        { expression: '20 / 4' },
        defaultContext
      );
      expect(result.result).toBe(5);
    });

    it('should respect order of operations', async () => {
      const result = await calculatorHandler(
        { expression: '2 + 3 * 4' },
        defaultContext
      );
      expect(result.result).toBe(14); // Not 20
    });

    it('should handle parentheses', async () => {
      const result = await calculatorHandler(
        { expression: '(2 + 3) * 4' },
        defaultContext
      );
      expect(result.result).toBe(20);
    });

    it('should evaluate powers', async () => {
      const result = await calculatorHandler(
        { expression: '2^3' },
        defaultContext
      );
      expect(result.result).toBe(8);
    });

    it('should evaluate square root', async () => {
      const result = await calculatorHandler(
        { expression: 'sqrt(16)' },
        defaultContext
      );
      expect(result.result).toBe(4);
    });

    it('should handle decimals', async () => {
      const result = await calculatorHandler(
        { expression: '3.14 * 2' },
        defaultContext
      );
      expect(result.result).toBeCloseTo(6.28);
    });

    it('should handle modulo', async () => {
      const result = await calculatorHandler(
        { expression: '10 % 3' },
        defaultContext
      );
      expect(result.result).toBe(1);
    });

    it('should handle trigonometric functions', async () => {
      const result = await calculatorHandler(
        { expression: 'sin(0)' },
        defaultContext
      );
      expect(result.result).toBe(0);
    });

    it('should throw ToolError for invalid expression', async () => {
      await expect(
        calculatorHandler({ expression: 'eval("bad")' }, defaultContext)
      ).rejects.toThrow('Invalid math expression');
    });

    it('should throw ToolError for missing expression', async () => {
      await expect(calculatorHandler({}, defaultContext)).rejects.toThrow(
        'Expression is required'
      );
    });

    it('should throw ToolError for non-string expression', async () => {
      await expect(
        calculatorHandler({ expression: 123 }, defaultContext)
      ).rejects.toThrow('Expression must be a string');
    });

    it('should handle complex expressions', async () => {
      const result = await calculatorHandler(
        { expression: 'sqrt(16) + 2^3 - (10 / 2)' },
        defaultContext
      );
      expect(result.result).toBe(7); // 4 + 8 - 5 = 7
    });

    it('should handle log functions', async () => {
      const result = await calculatorHandler(
        { expression: 'log(10)' },
        defaultContext
      );
      expect(result.result).toBeCloseTo(2.302585); // Natural log of 10
    });

    it('should handle abs function', async () => {
      const result = await calculatorHandler(
        { expression: 'abs(-5)' },
        defaultContext
      );
      expect(result.result).toBe(5);
    });

    it('should handle pi constant', async () => {
      const result = await calculatorHandler(
        { expression: 'pi' },
        defaultContext
      );
      expect(result.result).toBeCloseTo(3.14159);
    });
  });
});
