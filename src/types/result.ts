/**
 * Result Pattern Implementation
 * From Stage 2: Service Layer Design
 *
 * All service methods return Result<T> - never throw exceptions
 */

export interface Success<T> {
  success: true;
  data: T;
}

export interface Failure {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type Result<T> = Success<T> | Failure;

/**
 * Helper function to create a success result
 */
export function success<T>(data: T): Success<T> {
  return { success: true, data };
}

/**
 * Helper function to create a failure result
 */
export function failure(
  code: string,
  message: string,
  details?: Record<string, unknown>
): Failure {
  const error: Failure['error'] = { code, message };
  if (details !== undefined) {
    error.details = details;
  }
  return {
    success: false,
    error,
  };
}

/**
 * Type guard to check if result is success
 */
export function isSuccess<T>(result: Result<T>): result is Success<T> {
  return result.success === true;
}

/**
 * Type guard to check if result is failure
 */
export function isFailure<T>(result: Result<T>): result is Failure {
  return result.success === false;
}
