import request from 'supertest';
import express from 'express';
import { corsMiddleware, getAllowedOrigins, isOriginAllowed } from '../../src/middlewares/cors';
import { errorHandler } from '../../src/middlewares/errorHandler';

/**
 * Regression tests for the production CORS failure:
 *
 *   Access to XMLHttpRequest at 'https://zapier-fd68.onrender.com/api/auth/signin'
 *   from origin 'https://zapier-web-seven.vercel.app' has been blocked by CORS
 *   policy: Response to preflight request doesn't pass access control check:
 *   No 'Access-Control-Allow-Origin' header is present on the requested resource.
 *
 * The app is wired exactly like src/index.ts: CORS first (before body
 * parsing), explicit preflight handling, JSON error handler last.
 */

const WEB_ORIGIN = 'https://zapier-web-seven.vercel.app';
const DEPLOYMENT_ORIGIN = 'https://zapier-qwltqdtk3-nilesh-srivastavas-projects.vercel.app';
const EVIL_ORIGIN = 'https://evil.example.com';

const createApp = () => {
  const app = express();
  // Order mirrors src/index.ts — CORS must be the very first middleware.
  app.use(corsMiddleware);
  app.options('*', corsMiddleware);
  app.use(express.json());
  app.post('/api/auth/signup', (req, res) => {
    res.status(201).json({ success: true, message: 'Signup successful' });
  });
  app.post('/api/auth/signin', (req, res) => {
    res.status(200).json({ success: true, message: 'Signin successful' });
  });
  app.get('/api/boom', () => {
    throw new Error('kaboom');
  });
  app.use(errorHandler);
  return app;
};

const app = createApp();

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('CORS - preflight (OPTIONS)', () => {
  it('allows the preflight for /api/auth/signin from the deployed web origin', async () => {
    const response = await request(app)
      .options('/api/auth/signin')
      .set('Origin', WEB_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Content-Type, Authorization')
      .expect(204);

    // Exactly the requesting origin (never `*`) because credentials are allowed
    expect(response.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers['access-control-allow-methods']).toContain('POST');
    expect(response.headers['access-control-allow-headers']).toMatch(/Content-Type/i);
    expect(response.headers['access-control-allow-headers']).toMatch(/Authorization/i);
    // Preflights are cached for 24h
    expect(response.headers['access-control-max-age']).toBe('86400');
  });

  it('sends no Access-Control-Allow-Origin for an unknown origin', async () => {
    const response = await request(app)
      .options('/api/auth/signin')
      .set('Origin', EVIL_ORIGIN)
      .set('Access-Control-Request-Method', 'POST');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('allows any localhost port outside production', async () => {
    const response = await request(app)
      .options('/api/auth/signin')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST');

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });
});

describe('CORS - Vercel deployment origins in production', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    delete process.env.CORS_ORIGIN;
    delete process.env.FRONTEND_URL;
  });

  it.each([
    WEB_ORIGIN,
    DEPLOYMENT_ORIGIN,
    'https://zapier-abc123xyz-nilesh-srivastavas-projects.vercel.app',
    'https://zapier-git-main-nilesh-srivastavas-projects.vercel.app',
    'https://zapier-git-fix-signup-nilesh-srivastavas-projects.vercel.app',
    'https://zapier-nilesh-srivastavas-projects.vercel.app',
  ])('allows signup and signin preflights from %s', async (origin) => {
    for (const path of ['/api/auth/signup', '/api/auth/signin']) {
      const response = await request(app)
        .options(path)
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'content-type')
        .expect(204);

      expect(response.headers['access-control-allow-origin']).toBe(origin);
      expect(response.headers['access-control-allow-credentials']).toBe('true');
      expect(response.headers['access-control-allow-methods']).toContain('POST');
      expect(response.headers['access-control-allow-headers']).toMatch(/content-type/i);
      expect(response.headers.vary).toContain('Origin');
    }
  });

  it('answers the reported signup preflight without reaching downstream middleware', async () => {
    const downstream = jest.fn((_req, res) => res.sendStatus(503));
    const preflightApp = express();
    preflightApp.use(corsMiddleware);
    preflightApp.use(downstream);

    await request(preflightApp)
      .options('/api/auth/signup')
      .set('Origin', DEPLOYMENT_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type')
      .expect(204);

    expect(downstream).not.toHaveBeenCalled();
  });

  it('keeps CORS headers on signup success and validation errors for the reported origin', async () => {
    for (const [body, status] of [
      ['{"name":"Test User","email":"user@example.com","password":"secret"}', 201],
      ['{ invalid json }', 400],
    ] as const) {
      const response = await request(app)
        .post('/api/auth/signup')
        .set('Origin', DEPLOYMENT_ORIGIN)
        .set('Content-Type', 'application/json')
        .send(body)
        .expect(status);

      expect(response.headers['access-control-allow-origin']).toBe(DEPLOYMENT_ORIGIN);
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    }
  });

  it('keeps CORS headers on server errors for the reported origin', async () => {
    const response = await request(app)
      .get('/api/boom')
      .set('Origin', DEPLOYMENT_ORIGIN)
      .expect(500);

    expect(response.headers['access-control-allow-origin']).toBe(DEPLOYMENT_ORIGIN);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it.each([
    EVIL_ORIGIN,
    'https://unrelated.vercel.app',
    'https://zapier-qwltqdtk3-other-team.vercel.app',
    'https://other-project-qwltqdtk3-nilesh-srivastavas-projects.vercel.app',
    `${DEPLOYMENT_ORIGIN}.evil.example.com`,
    `${DEPLOYMENT_ORIGIN}:444`,
    `${DEPLOYMENT_ORIGIN}/api`,
    DEPLOYMENT_ORIGIN.replace('https:', 'http:'),
    'https://zapier-qwltqdtk3-nilesh-srivastavas-projectsXvercel.app',
    'http://localhost:5173',
    'null',
  ])('does not grant credentialed access to %s', async (origin) => {
    expect(isOriginAllowed(origin)).toBe(false);
    const response = await request(app)
      .options('/api/auth/signup')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });
});

describe('CORS - actual requests', () => {
  it('returns CORS headers on POST /api/auth/signin for the web origin', async () => {
    const response = await request(app)
      .post('/api/auth/signin')
      .set('Origin', WEB_ORIGIN)
      .set('Content-Type', 'application/json')
      .send({ email: 'user@example.com', password: 'secret' })
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('keeps CORS headers on error responses (malformed JSON body)', async () => {
    const response = await request(app)
      .post('/api/auth/signin')
      .set('Origin', WEB_ORIGIN)
      .set('Content-Type', 'application/json')
      .send('{ invalid json }')
      .expect(400);

    // The exact regression: an error without these headers is reported by the
    // browser as a CORS failure instead of the real error.
    expect(response.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('keeps CORS headers on 500 responses from route handlers', async () => {
    const response = await request(app).get('/api/boom').set('Origin', WEB_ORIGIN).expect(500);

    expect(response.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
    expect(response.body).toEqual({ success: false, message: 'kaboom', code: 'INTERNAL_ERROR' });
  });

  it('still serves requests without an Origin header (curl, server-to-server)', async () => {
    const response = await request(app)
      .post('/api/auth/signin')
      .send({ email: 'user@example.com', password: 'secret' })
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.body.success).toBe(true);
  });

  it('serves unknown origins without CORS headers but does not crash the request', async () => {
    const response = await request(app)
      .post('/api/auth/signin')
      .set('Origin', EVIL_ORIGIN)
      .send({ email: 'user@example.com', password: 'secret' })
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('CORS - origin allowlist configuration', () => {
  it('always includes the deployed web app and localhost defaults', () => {
    const origins = getAllowedOrigins();
    expect(origins).toContain(WEB_ORIGIN);
    expect(origins).toContain('http://localhost:3000');
  });

  it('honors extra origins from CORS_ORIGIN (comma-separated)', () => {
    process.env.CORS_ORIGIN = 'https://staging.example.com, https://app.example.com/';
    expect(isOriginAllowed('https://staging.example.com')).toBe(true);
    expect(isOriginAllowed('https://app.example.com')).toBe(true); // trailing slash normalized
    expect(isOriginAllowed('https://other.example.com')).toBe(false);
  });

  it('honors FRONTEND_URL as an allowed origin', () => {
    delete process.env.CORS_ORIGIN;
    process.env.FRONTEND_URL = 'https://my-frontend.example.com';
    expect(isOriginAllowed('https://my-frontend.example.com')).toBe(true);
  });
});
