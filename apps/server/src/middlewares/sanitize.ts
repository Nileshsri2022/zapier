import { Request, Response, NextFunction } from 'express';
import xss from 'xss';

/**
 * Recursively sanitize all string values in an object
 */
function sanitizeObject(obj: any): any {
  if (typeof obj === 'string') {
    return xss(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }
  if (obj !== null && typeof obj === 'object') {
    const sanitized: any = {};
    for (const key of Object.keys(obj)) {
      sanitized[key] = sanitizeObject(obj[key]);
    }
    return sanitized;
  }
  return obj;
}

/**
 * XSS sanitization middleware
 * Sanitizes all string values in request body, query, and params
 */
export const sanitizeInput = (req: Request, res: Response, next: NextFunction): void => {
  // Connection credentials are opaque bytes, not HTML. XSS rewriting corrupts keys.
  // These endpoints validate strict bounded schemas and never render/echo credential input.
  const isAiConnection = /^\/api\/ai\/connections(?:\/|$)/.test(req.path);
  if (req.body && !isAiConnection) {
    req.body = sanitizeObject(req.body);
  }
  if (req.query) {
    req.query = sanitizeObject(req.query);
  }
  if (req.params) {
    req.params = sanitizeObject(req.params);
  }
  next();
};
