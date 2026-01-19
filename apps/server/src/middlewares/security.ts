import helmet from 'helmet';

/**
 * Security headers middleware using Helmet
 * Adds various HTTP headers to protect against common vulnerabilities
 */
export const securityHeaders = helmet({
  // Content Security Policy
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https://api.telegram.org', 'https://graph.facebook.com'],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
    },
  },
  // X-DNS-Prefetch-Control
  dnsPrefetchControl: { allow: false },
  // X-Frame-Options
  frameguard: { action: 'deny' },
  // Strict-Transport-Security
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
  },
  // X-Content-Type-Options
  noSniff: true,
  // Referrer-Policy
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  // X-XSS-Protection (legacy, but still useful)
  xssFilter: true,
});

/**
 * Relaxed security headers for API endpoints
 * Disables CSP for API responses
 */
export const apiSecurityHeaders = helmet({
  contentSecurityPolicy: false, // APIs don't need CSP
  frameguard: { action: 'deny' },
  hsts: { maxAge: 31536000, includeSubDomains: true },
  noSniff: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
});
