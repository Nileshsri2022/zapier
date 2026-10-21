require('dotenv').config();
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import redis from '@repo/redis';

/** Kept in one place so logout and the middleware cannot drift apart. */
const denylistKey = (jti: string) => `auth:denylist:${jti}`;

export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization as string | undefined;

  // Handle both "Bearer <token>" and plain "<token>" formats from header
  const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;

  // Also check for httpOnly cookie (new method)
  // @ts-ignore - cookies added by cookie-parser
  const cookieToken = req.cookies?.auth_token;

  // Use cookie token if available, otherwise fall back to header
  const token = cookieToken || headerToken;

  if (!token) {
    res.status(403).json({
      message: 'You are not logged in',
    });
    return;
  }

  try {
    // Throws on an expired token: `expiresIn` is what bounds a session.
    const payload = jwt.verify(token, process.env.JWT_SECRET as string) as jwt.JwtPayload;

    // Revoked at logout. Fail open on a Redis error: a cache outage must not
    // log every user out (the token still carries its own expiry).
    if (payload.jti) {
      try {
        if (await redis.get(denylistKey(payload.jti))) {
          res.status(403).json({ message: 'You are not logged in' });
          return;
        }
      } catch (error) {
        console.error('Token denylist check failed:', error);
      }
    }

    // @ts-ignore
    req.id = payload.id;
    next();
  } catch (e) {
    res.status(403).json({
      message: 'You are not logged in',
    });
    return;
  }
};

// Validation middleware
export { validateBody, validateParams, validateQuery } from './validateRequest';

// Error handling middleware
export { errorHandler, asyncHandler } from './errorHandler';

// Security middleware
export { apiLimiter, authLimiter, webhookLimiter } from './rateLimiter';
export { sanitizeInput } from './sanitize';
export { securityHeaders, apiSecurityHeaders } from './security';

// Performance middleware
export { compressionMiddleware } from './compression';
export { cacheMiddleware, invalidateUserCache, invalidateAllCache } from './cache';

// CSRF protection
export { csrfProtection, getCsrfToken, generateCsrfToken, validateCsrfToken } from './csrf';
