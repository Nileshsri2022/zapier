/**
 * Custom API Error class for standardized error responses
 * Provides factory methods for common HTTP error types
 */
export class ApiError extends Error {
  statusCode: number;
  code: string;
  isOperational: boolean;

  constructor(statusCode: number, message: string, code: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true; // Distinguishes from programming errors

    Error.captureStackTrace(this, this.constructor);
  }

  // Factory methods for common errors
  static badRequest(message: string, code = 'BAD_REQUEST') {
    return new ApiError(400, message, code);
  }

  static unauthorized(message: string, code = 'UNAUTHORIZED') {
    return new ApiError(401, message, code);
  }

  static forbidden(message: string, code = 'FORBIDDEN') {
    return new ApiError(403, message, code);
  }

  static notFound(message: string, code = 'NOT_FOUND') {
    return new ApiError(404, message, code);
  }

  static conflict(message: string, code = 'CONFLICT') {
    return new ApiError(409, message, code);
  }

  static validation(message: string, code = 'VALIDATION_ERROR') {
    return new ApiError(422, message, code);
  }

  static internal(message: string, code = 'INTERNAL_ERROR') {
    return new ApiError(500, message, code);
  }

  static serviceUnavailable(message: string, code = 'SERVICE_UNAVAILABLE') {
    return new ApiError(503, message, code);
  }

  /**
   * Serialize error to JSON response format
   */
  toJSON() {
    return {
      success: false,
      message: this.message,
      code: this.code,
    };
  }
}

/**
 * Standard success response helper
 */
export function successResponse<T>(data: T, message?: string) {
  return {
    success: true,
    message,
    data,
  };
}

/**
 * Standard error response helper (for manual use)
 */
export function errorResponse(message: string, code: string) {
  return {
    success: false,
    message,
    code,
  };
}
