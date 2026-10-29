/**
 * Typed application errors. Every error that reaches the client goes through
 * one of these so the JSON envelope stays consistent and internal details
 * (SQL, stack traces, provider secrets) never leak.
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'INVALID_CREDENTIALS'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_INVALID'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNPROCESSABLE'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'WEBHOOK_SIGNATURE_INVALID'
  | 'CURRENCY_MISMATCH'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly details?: unknown;
  public readonly expose: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    statusCode: number,
    options: { details?: unknown; expose?: boolean; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = options.details;
    this.expose = options.expose ?? statusCode < 500;
    if (options.cause) this.cause = options.cause;
    Error.captureStackTrace?.(this, AppError);
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError('VALIDATION_ERROR', message, 400, { details });

export const unauthenticated = (message = 'Authentication required', code: ErrorCode = 'UNAUTHENTICATED') =>
  new AppError(code, message, 401);

export const invalidCredentials = () =>
  new AppError('INVALID_CREDENTIALS', 'Email or password is incorrect', 401);

export const forbidden = (message = 'You do not have permission to perform this action') =>
  new AppError('FORBIDDEN', message, 403);

export const notFound = (resource = 'Resource') => new AppError('NOT_FOUND', `${resource} not found`, 404);

export const conflict = (message: string, details?: unknown) =>
  new AppError('CONFLICT', message, 409, { details });

export const unprocessable = (message: string, details?: unknown) =>
  new AppError('UNPROCESSABLE', message, 422, { details });

export const currencyMismatch = (message: string, details?: unknown) =>
  new AppError('CURRENCY_MISMATCH', message, 422, { details });

export const internalError = (message = 'An unexpected error occurred', cause?: unknown) =>
  new AppError('INTERNAL_ERROR', message, 500, { expose: false, cause });

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
