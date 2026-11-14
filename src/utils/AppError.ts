/**
 * An expected, operational error (bad input, missing record, no permission).
 * The global error handler turns it into the standard error response.
 * `code` is a stable UPPER_SNAKE identifier the client can rely on.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;
  readonly isOperational = true;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, AppError);
  }

  static badRequest(code: string, message: string, details?: unknown): AppError {
    return new AppError(400, code, message, details);
  }

  static unauthorized(code = 'UNAUTHORIZED', message = 'Authentication required'): AppError {
    return new AppError(401, code, message);
  }

  static forbidden(
    code = 'FORBIDDEN',
    message = 'You do not have permission to perform this action',
  ): AppError {
    return new AppError(403, code, message);
  }

  static notFound(code: string, message: string): AppError {
    return new AppError(404, code, message);
  }

  static conflict(code: string, message: string, details?: unknown): AppError {
    return new AppError(409, code, message, details);
  }
}
