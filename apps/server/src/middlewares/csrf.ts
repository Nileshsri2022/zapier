import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

// In-memory CSRF token store (use Redis in production for multi-instance)
const csrfTokens = new Map<string, { token: string; expires: number }>();

// Token expiration time (1 hour)
const TOKEN_TTL = 60 * 60 * 1000;

// Clean up expired tokens periodically
setInterval(
  () => {
    const now = Date.now();
    for (const [key, value] of csrfTokens.entries()) {
      if (value.expires < now) {
        csrfTokens.delete(key);
      }
    }
  },
  5 * 60 * 1000
); // Every 5 minutes

/**
 * Generate a CSRF token for a session/user
 */
export function generateCsrfToken(sessionId: string): string {
  const token = crypto.randomBytes(32).toString('hex');
  csrfTokens.set(sessionId, {
    token,
    expires: Date.now() + TOKEN_TTL,
  });
  return token;
}

/**
 * Validate a CSRF token
 */
export function validateCsrfToken(sessionId: string, token: string): boolean {
  const stored = csrfTokens.get(sessionId);
  if (!stored) return false;
  if (stored.expires < Date.now()) {
    csrfTokens.delete(sessionId);
    return false;
  }
  return stored.token === token;
}

/**
 * CSRF Protection Middleware
 * Protects state-changing requests (POST, PUT, PATCH, DELETE)
 *
 * Usage:
 * - GET /api/csrf-token - Returns token for the session
 * - Include X-CSRF-Token header with state-changing requests
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  // Skip safe methods (GET, HEAD, OPTIONS)
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Skip if using Bearer token auth (already CSRF-protected)
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return next();
  }

  // For cookie-based auth, validate CSRF token
  const csrfToken = req.headers['x-csrf-token'] as string;
  // @ts-ignore - sessionId comes from session middleware
  const sessionId = req.sessionId || req.cookies?.sessionId;

  if (!sessionId) {
    return res.status(403).json({ error: 'Missing session' });
  }

  if (!csrfToken || !validateCsrfToken(sessionId, csrfToken)) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }

  next();
}

/**
 * Endpoint handler to get CSRF token
 */
export function getCsrfToken(req: Request, res: Response) {
  // @ts-ignore
  const sessionId = req.sessionId || req.cookies?.sessionId || req.id;

  if (!sessionId) {
    return res.status(400).json({ error: 'No session available' });
  }

  const token = generateCsrfToken(sessionId);
  res.json({ csrfToken: token });
}

export default csrfProtection;
