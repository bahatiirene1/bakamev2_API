/**
 * Result Pattern Unit Tests
 * Tests for the core Result type utilities
 */

import { describe, it, expect } from 'vitest';

import {
  success,
  failure,
  isSuccess,
  isFailure,
  type Result,
} from '@/types/result.js';

describe('Result Pattern', () => {
  describe('success()', () => {
    it('should create a success result with data', () => {
      const result = success({ id: '123', name: 'Test' });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ id: '123', name: 'Test' });
    });

    it('should work with primitive values', () => {
      const stringResult = success('hello');
      const numberResult = success(42);
      const boolResult = success(true);

      expect(stringResult.data).toBe('hello');
      expect(numberResult.data).toBe(42);
      expect(boolResult.data).toBe(true);
    });

    it('should work with null', () => {
      const result = success(null);
      expect(result.data).toBeNull();
    });
  });

  describe('failure()', () => {
    it('should create a failure result with error', () => {
      const result = failure('NOT_FOUND', 'Resource not found');

      expect(result.success).toBe(false);
      expect(result.error.code).toBe('NOT_FOUND');
      expect(result.error.message).toBe('Resource not found');
    });

    it('should include optional details', () => {
      const result = failure('VALIDATION_ERROR', 'Invalid input', {
        field: 'email',
        reason: 'Invalid format',
      });

      expect(result.error.details).toEqual({
        field: 'email',
        reason: 'Invalid format',
      });
    });
  });

  describe('isSuccess()', () => {
    it('should return true for success results', () => {
      const result = success({ data: 'test' });
      expect(isSuccess(result)).toBe(true);
    });

    it('should return false for failure results', () => {
      const result = failure('ERROR', 'Something went wrong');
      expect(isSuccess(result)).toBe(false);
    });

    it('should narrow the type correctly', () => {
      const result: Result<string> = success('test');

      if (isSuccess(result)) {
        // TypeScript should know result.data is available here
        expect(result.data).toBe('test');
      }
    });
  });

  describe('isFailure()', () => {
    it('should return true for failure results', () => {
      const result = failure('ERROR', 'Something went wrong');
      expect(isFailure(result)).toBe(true);
    });

    it('should return false for success results', () => {
      const result = success({ data: 'test' });
      expect(isFailure(result)).toBe(false);
    });

    it('should narrow the type correctly', () => {
      const result: Result<string> = failure('ERROR', 'Something went wrong');

      if (isFailure(result)) {
        // TypeScript should know result.error is available here
        expect(result.error.code).toBe('ERROR');
      }
    });
  });
});
