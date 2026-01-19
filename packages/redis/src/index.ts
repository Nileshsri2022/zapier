import { Redis } from '@upstash/redis';
import dotenv from 'dotenv';

dotenv.config();

// Get Redis configuration from environment variables
const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

// Validate environment variables
if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
  console.warn('⚠️ Upstash Redis credentials not configured. Some features may not work.');
}

// Create Redis client
const redis = new Redis({
  url: UPSTASH_REDIS_REST_URL || '',
  token: UPSTASH_REDIS_REST_TOKEN || '',
});

// Log connection status
if (UPSTASH_REDIS_REST_URL) {
  console.log(`🔗 Upstash Redis configured: ${UPSTASH_REDIS_REST_URL.substring(0, 30)}...`);
}

export { redis, Redis };
export default redis;
