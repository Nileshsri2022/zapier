import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/ApiError';
import { isOriginAllowed } from './cors';

/**
 * Global error handler middleware
 * Catches all errors and returns standardized JSON responses
 *
 * Always keeps CORS headers on the response: an error without them is
 * reported by browsers as a CORS failure ("No 'Access-Control-Allow-Origin'
 * header is present") instead of the real error.
 *
 * Usage: Add as the LAST middleware in Express app
 *   app.use(errorHandler);
 */
export const errorHandler = (err: Error, req: Request, res: Response, next: NextFunction): void => {
  // If response headers already sent, delegate to Express default handler
  if (res.headersSent) {
    return next(err);
  }

  // Preserve CORS headers on error responses (defense in depth — the cors
  // middleware normally sets these first, but errors must never lose them).
  const requestOrigin = req.headers.origin;
  if (requestOrigin && isOriginAllowed(requestOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
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

  // Preserve the status of framework errors (e.g. body-parser's malformed
  // JSON SyntaxError carries `status: 400`) instead of always returning 500.
  const statusError = err as Error & { status?: number; statusCode?: number };
  const errStatus = statusError.status ?? statusError.statusCode;
  if (errStatus && errStatus >= 400 && errStatus < 600) {
    res.status(errStatus).json({
      success: false,
      message: process.env.NODE_ENV === 'production' ? 'Bad request' : err.message,
      code: 'BAD_REQUEST',
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
