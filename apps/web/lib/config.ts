// API Configuration
// Uses environment variables in production, localhost in development
const rawApiUrl = process.env.NEXT_PUBLIC_API_URL || '';

// Fallback to the live production server (zapier-ibsy) if pointing to worker (zapier-fd68) or unset in production
export const API_URL =
  rawApiUrl && !rawApiUrl.includes('zapier-fd68')
    ? rawApiUrl
    : process.env.NODE_ENV === 'production'
      ? 'https://zapier-ibsy.onrender.com'
      : ''; // Development API calls are same-origin through the Next rewrite.

const rawHooksUrl = process.env.NEXT_PUBLIC_HOOKS_URL || '';
export const HOOKS_URL = rawHooksUrl
  ? rawHooksUrl
  : process.env.NODE_ENV === 'production'
    ? 'https://zapier-hooks-bqyy.onrender.com'
    : 'http://localhost:8000';
