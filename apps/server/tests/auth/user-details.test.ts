import request from 'supertest';
import express from 'express';
import client from '@repo/db';

/**
 * GET /api/auth/:userId must never expose another account's record, and must
 * never include the password hash. The endpoint is authenticated but the
 * handler previously looked the user up by the *path* id with no ownership
 * check and returned the full Prisma row (password included).
 *
 * jwt.verify is mocked here because tests/setup.ts only mocks jwt.sign.
 */
jest.mock('jsonwebtoken', () => ({
  __esModule: true,
  default: {
    sign: jest.fn().mockReturnValue('mock-jwt-token'),
    verify: jest.fn((token: string) => {
      if (token === 'user-1-token') return { id: 1 };
      if (token === 'user-2-token') return { id: 2 };
      throw new Error('invalid token');
    }),
  },
  sign: jest.fn().mockReturnValue('mock-jwt-token'),
  verify: jest.fn((token: string) => {
    if (token === 'user-1-token') return { id: 1 };
    if (token === 'user-2-token') return { id: 2 };
    throw new Error('invalid token');
  }),
}));

import { AuthRouter } from '../../src/routes/AuthRoutes';

const app = express();
app.use(express.json());
app.use('/api/auth', AuthRouter);

const victim = {
  id: 2,
  name: 'Victim',
  email: 'victim@example.com',
  password: '$2b$10$super-secret-hash',
};

describe('GET /api/auth/:userId — tenant isolation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("does not return another user's record", async () => {
    (client.user.findFirst as jest.Mock).mockResolvedValue(victim);

    const response = await request(app)
      .get('/api/auth/2')
      .set('Authorization', 'Bearer user-1-token');

    // The caller is user 1 and the path asks for user 2.
    expect(response.status).toBe(403);
    expect(response.body?.data?.user).toBeUndefined();
  });

  it('never includes the password hash in the response', async () => {
    (client.user.findFirst as jest.Mock).mockResolvedValue({
      id: 1,
      name: 'Self',
      email: 'self@example.com',
      password: '$2b$10$super-secret-hash',
    });

    const response = await request(app)
      .get('/api/auth/1')
      .set('Authorization', 'Bearer user-1-token');

    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain('super-secret-hash');
    expect(response.body?.data?.user?.password).toBeUndefined();
  });

  it('returns 404 (not a second response) when the user does not exist', async () => {
    (client.user.findFirst as jest.Mock).mockResolvedValue(null);

    const response = await request(app)
      .get('/api/auth/1')
      .set('Authorization', 'Bearer user-1-token');

    expect(response.status).toBe(404);
  });
});
