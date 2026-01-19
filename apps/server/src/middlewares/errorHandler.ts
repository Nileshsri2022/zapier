import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/ApiError';

/**
 * Global error handler middleware
 * Catches all errors and returns standardized JSON responses
 *
 * Usage: Add as the LAST middleware in Express app
 *   app.use(errorHandler);
 */
export const errorHandler = (err: Error, req: Request, res: Response, next: NextFunction): void => {
  // If response headers already sent, delegate to Express default handler
  if (res.headersSent) {
    return next(err);
  }

  // Handle ApiError instances
  if (err instanceof ApiError) {
    res.status(err.statusCode).json(err.toJSON());
    return;
  }

  // Handle Zod validation errors (if any slip through)
  if (err.name === 'ZodError') {
    res.status(422).json({
      success: false,
      message: 'Validation failed',
      code: 'VALIDATION_ERROR',
    });
    return;
  }

  // Log unexpected errors in development
  if (process.env.NODE_ENV !== 'production') {
    console.error('Unexpected error:', err);
  }

  // Handle unexpected errors
  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    code: 'INTERNAL_ERROR',
  });
};

/**
 * Async handler wrapper to catch errors in async route handlers
 *
 * Usage:
 *   router.get('/users', asyncHandler(async (req, res) => { ... }));
 */
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
