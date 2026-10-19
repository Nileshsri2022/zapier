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
  const isAiEndpoint =
    /^\/api\/ai\/connections(?:\/|$)/.test(req.path) || req.path === '/api/actions/ai/test';
  if (req.body && !isAiEndpoint) {
    const original = req.body;
    req.body = sanitizeObject(req.body);
    // AI-specific fields are bounded/schema-validated at save time. Other action fields
    // (email body, webhook URLs, etc.) retain their previous sanitization behavior.
    if (/^\/api\/zaps(?:\/|$)/.test(req.path) && Array.isArray(original.actions)) {
      original.actions.forEach((action: any, index: number) => {
        const metadata = action?.actionMetaData;
        if (
          metadata &&
          ['openai', 'anthropic', 'puter', 'openai_compatible'].includes(metadata.provider)
        ) {
          for (const key of ['input', 'instructions', 'categories', 'outputFields']) {
            if (
              Object.prototype.hasOwnProperty.call(metadata, key) &&
              req.body.actions?.[index]?.actionMetaData
            ) {
              req.body.actions[index].actionMetaData[key] = metadata[key];
            }
          }
        }
      });
    }
  }
  if (req.query) {
    req.query = sanitizeObject(req.query);
  }
  if (req.params) {
    req.params = sanitizeObject(req.params);
  }
  next();
};
