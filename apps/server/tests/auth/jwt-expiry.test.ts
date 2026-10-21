// setup.ts installs a fake `jsonwebtoken` (a `sign` that returns a constant,
// no `verify`) for the whole server suite. This file has to exercise the real
// module to assert `exp`/`jti`, so it overrides that factory.
jest.mock('jsonwebtoken', () => jest.requireActual('jsonwebtoken'));

import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { createTestApp, testUser, mockUser } from '../utils';
import client from '@repo/db';

/**
 * #44 — signin issued a JWT with no `exp` claim and returned it in the response
 * body, so a token copied out of a response (XSS, proxy, log) authenticated
 * forever and logout could not revoke it.
 *
 * Covered here: the lifetime claim, the body shape, and logout revocation.
 */

const store = new Map<string, string>();
jest.mock('@repo/redis', () => ({
  __esModule: true,
  default: {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    del: jest.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
  },
}));

const app = createTestApp();
const SECRET = process.env.JWT_SECRET as string;
const SEVEN_DAYS = 7 * 24 * 60 * 60;

const signin = async () => {
  (client.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
  (bcrypt.compareSync as jest.Mock).mockReturnValue(true);
  return request(app).post('/api/auth/signin').send({
    email: testUser.email,
    password: testUser.password,
  });
};

const tokenFromCookie = (response: request.Response): string => {
  const cookies = response.headers['set-cookie'] as unknown as string[];
  const authCookie = cookies.find((c: string) => c.startsWith('auth_token='));
  return decodeURIComponent(authCookie!.split(';')[0].slice('auth_token='.length));
};

beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
});

describe('signin token lifetime', () => {
  it('issues a token with a bounded lifetime matching the cookie', async () => {
    const response = await signin();
    expect(response.status).toBe(200);

    const token = tokenFromCookie(response);
    const payload = jwt.verify(token, SECRET) as jwt.JwtPayload;

    expect(payload.exp).toBeDefined();
    expect(payload.iat).toBeDefined();
    // Default JWT_EXPIRES_IN is 7d, the same as the cookie maxAge.
    expect(payload.exp! - payload.iat!).toBe(SEVEN_DAYS);
  });

  it('gives every session a distinct token id so one can be revoked alone', async () => {
    const first = tokenFromCookie(await signin());
    const second = tokenFromCookie(await signin());

    const a = jwt.verify(first, SECRET) as jwt.JwtPayload;
    const b = jwt.verify(second, SECRET) as jwt.JwtPayload;
    expect(a.jti).toBeDefined();
    expect(b.jti).toBeDefined();
    expect(a.jti).not.toBe(b.jti);
  });

  it('does not hand the bearer token back in the response body', async () => {
    const response = await signin();

    expect(response.body.data).not.toHaveProperty('token');
    expect(JSON.stringify(response.body)).not.toContain('eyJ');
  });

  it('rejects an expired token', async () => {
    const expired = jwt.sign({ id: mockUser.id }, SECRET, { expiresIn: '-1s' });

    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${expired}`);

    expect(response.status).toBe(403);
  });

  it('accepts a valid token', async () => {
    (client.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
    const token = tokenFromCookie(await signin());

    const response = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
  });
});

describe('logout revokes the token', () => {
  it('refuses the token after logout, even though it has not expired', async () => {
    (client.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
    const token = tokenFromCookie(await signin());

    // Works before logout.
    expect(
      (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status
    ).toBe(200);

    await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`).expect(200);

    // Same token, still cryptographically valid, now revoked.
    const after = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(403);
  });

  it('revokes only the token that was presented', async () => {
    (client.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
    const first = tokenFromCookie(await signin());
    const second = tokenFromCookie(await signin());

    await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${first}`).expect(200);

    expect(
      (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${first}`)).status
    ).toBe(403);
    expect(
      (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${second}`)).status
    ).toBe(200);
  });

  it('still clears the cookie when no token is presented', async () => {
    const response = await request(app).post('/api/auth/logout').expect(200);

    expect(response.headers['set-cookie']?.join(';')).toContain('auth_token=');
  });
});
