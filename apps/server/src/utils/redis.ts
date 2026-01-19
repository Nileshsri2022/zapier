import { Redis } from '@upstash/redis';

/**
 * Upstash Redis client for serverless caching
 * Requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN env vars
 */

// Create Redis client only if env vars are configured
let redis: Redis | null = null;

export const getRedisClient = (): Redis | null => {
  if (redis) return redis;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    console.warn('⚠️ Upstash Redis not configured - caching disabled');
    return null;
  }

  redis = new Redis({ url, token });
  return redis;
};

/**
 * Cache helper functions
 */
export const cache = {
  /**
   * Get cached value
   */
  async get<T>(key: string): Promise<T | null> {
    const client = getRedisClient();
    if (!client) return null;

    try {
      return await client.get<T>(key);
    } catch (error) {
      console.error('Redis get error:', error);
      return null;
    }
  },

  /**
   * Set cached value with TTL
   */
  async set<T>(key: string, value: T, ttlSeconds: number = 300): Promise<void> {
    const client = getRedisClient();
    if (!client) return;

    try {
      await client.set(key, value, { ex: ttlSeconds });
    } catch (error) {
      console.error('Redis set error:', error);
    }
  },

  /**
   * Delete cached value
   */
  async del(key: string): Promise<void> {
    const client = getRedisClient();
    if (!client) return;

    try {
      await client.del(key);
    } catch (error) {
      console.error('Redis del error:', error);
    }
  },

  /**
   * Delete all cached values matching pattern
   */
  async invalidatePattern(pattern: string): Promise<void> {
    const client = getRedisClient();
    if (!client) return;

    try {
      const keys = await client.keys(pattern);
      if (keys.length > 0) {
        await Promise.all(keys.map((key) => client.del(key)));
      }
    } catch (error) {
      console.error('Redis invalidate error:', error);
    }
  },
};

export default cache;
