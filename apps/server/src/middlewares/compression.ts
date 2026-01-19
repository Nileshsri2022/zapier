import compression from 'compression';
import { Request, Response } from 'express';

/**
 * Response compression middleware
 * Compresses responses using gzip/brotli for better performance
 * Reduces payload size by 50-70% for JSON responses
 */
export const compressionMiddleware = compression({
  // Only compress responses > 1KB
  threshold: 1024,
  // Compression level (1-9, higher = more compression but slower)
  level: 6,
  // Filter function to determine which responses to compress
  filter: (req: Request, res: Response) => {
    // Don't compress if client doesn't accept encoding
    if (req.headers['x-no-compression']) {
      return false;
    }
    // Use compression's default filter
    return compression.filter(req, res);
  },
});
