import { Request, Response, NextFunction } from 'express';
import cache from '../utils/redis';

/**
 * Cache middleware factory
 * Caches GET request responses for specified TTL
 */
export const cacheMiddleware = (ttlSeconds: number = 300) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Create cache key from URL and user ID
    // @ts-ignore - req.id is set by auth middleware
    const userId = req.id || 'anonymous';
    const cacheKey = `api:${userId}:${req.originalUrl}`;

    try {
      // Check cache
      const cached = await cache.get<string>(cacheKey);
      if (cached) {
        res.setHeader('X-Cache', 'HIT');
        return res.json(cached);
      }

      // Store original json method
      const originalJson = res.json.bind(res);

      // Override json to cache response
      res.json = (body: any) => {
        // Cache successful responses
        if (res.statusCode >= 200 && res.statusCode < 300) {
          cache.set(cacheKey, body, ttlSeconds);
        }
        res.setHeader('X-Cache', 'MISS');
        return originalJson(body);
      };

      next();
    } catch (error) {
      // On cache error, continue without caching
      console.error('Cache middleware error:', error);
      next();
    }
  };
};

/**
 * Cache invalidation helper for mutations
 * Use after POST/PUT/PATCH/DELETE operations
 */
export const invalidateUserCache = async (userId: number | string) => {
  await cache.invalidatePattern(`api:${userId}:*`);
};

export const invalidateAllCache = async () => {
  await cache.invalidatePattern('api:*');
};
