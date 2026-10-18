import cors from 'cors';
import type { CorsOptions } from 'cors';

/**
 * CORS configuration for the API.
 *
 * The web app (e.g. https://zapier-web-seven.vercel.app on Vercel) calls this
 * API cross-origin (https://zapier-fd68.onrender.com on Render) via XHR, and
 * auth uses an httpOnly cookie + axios `withCredentials: true`. That requires:
 *
 *   - Access-Control-Allow-Credentials: true, AND
 *   - Access-Control-Allow-Origin echoing the exact request origin (never `*`).
 *
 * Two rules for the middleware stack (see src/index.ts):
 *
 *   1. `corsMiddleware` must be registered BEFORE any other middleware —
 *      body parsers, cookie-parser, helmet, rate limiters, routes. If anything
 *      ahead of it answers a request first (or errors), the response goes out
 *      without CORS headers and the browser reports the preflight as failed:
 *      "No 'Access-Control-Allow-Origin' header is present on the requested
 *      resource."
 *   2. Error responses must also carry CORS headers, otherwise a 4xx/5xx
 *      (malformed JSON, rate limit, crash) looks like a CORS failure too.
 *
 * Allowed origins come from env (`CORS_ORIGIN`, comma-separated, or
 * `FRONTEND_URL`) plus the built-in defaults below. Outside production any
 * localhost/127.0.0.1 origin is allowed so dev servers on any port work.
 */

const DEFAULT_ALLOWED_ORIGINS = [
  'https://zapier-web-seven.vercel.app', // deployed web app (Vercel)
  'http://localhost:3000', // local Next.js dev server
  'http://127.0.0.1:3000',
];

/** Normalize an origin for comparison (trim, strip trailing slash). */
const normalizeOrigin = (origin: string): string => origin.trim().replace(/\/+$/, '');

/** Origins allowed to call this API cross-origin. */
export function getAllowedOrigins(): string[] {
  const fromEnv = [process.env.CORS_ORIGIN, process.env.FRONTEND_URL]
    .filter((v): v is string => Boolean(v))
    .flatMap((v) => v.split(','))
    .map(normalizeOrigin)
    .filter(Boolean);
  return Array.from(new Set([...fromEnv, ...DEFAULT_ALLOWED_ORIGINS]));
}

/** Whether a request's Origin header may receive CORS headers. */
export function isOriginAllowed(origin: string | undefined): boolean {
  // No Origin header: curl / server-to-server / same-origin — not a CORS
  // request, let it through without CORS headers.
  if (!origin) return true;

  const normalized = normalizeOrigin(origin);
  if (getAllowedOrigins().includes(normalized)) return true;

  // Any localhost port outside production (dev servers, e2e runners).
  if (process.env.NODE_ENV !== 'production') {
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalized);
  }

  return false;
}

export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    const allowed = isOriginAllowed(origin);
    if (!allowed && origin) {
      console.warn(`⚠️ CORS: blocked request from origin ${origin} — set CORS_ORIGIN to allow it`);
    }
    callback(null, allowed);
  },
  // Required for the httpOnly auth cookie (axios `withCredentials: true`).
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Cache-Control',
    'X-CSRF-Token',
    'X-Requested-With',
  ],
  // Let the browser read rate-limit and download headers cross-origin.
  exposedHeaders: ['RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'Content-Disposition'],
  // Cache preflights for 24h — far fewer OPTIONS round trips, so fewer
  // chances for a preflight to fail (and faster API calls).
  maxAge: 86400,
  optionsSuccessStatus: 204,
};

export const corsMiddleware = cors(corsOptions);
