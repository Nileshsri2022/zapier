/**
 * BUG: signin signs a JWT with no `expiresIn`, and the token is also returned
 * in the response body. `POST /api/auth/logout` only clears the cookie, so a
 * token that was ever handed to the browser (or captured from a response body,
 * a log, or a proxy) authenticates forever — revocation is impossible.
 *
 * Expected (green): `jwt.sign` receives an expiry option, and the signin body
 * does not carry a bearer token that outlives the cookie.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import express from 'express';
import client from '@repo/db';
import { AuthRouter } from '../../apps/server/src/routes/AuthRoutes';

const app = express();
app.use(express.json());
app.use('/api/auth', AuthRouter);

const mockUser = {
  id: 7,
  name: 'Token User',
  email: 'token@example.com',
  password: '$2b$10$hashedpassword',
};

beforeEach(() => {
  jest.clearAllMocks();
  (client.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
  (bcrypt.compareSync as jest.Mock).mockReturnValue(true);
  (jwt.sign as jest.Mock).mockReturnValue('signed-token');
});

describe('signin token lifetime', () => {
  it('issues a JWT with a bounded lifetime', async () => {
    await request(app)
      .post('/api/auth/signin')
      .send({ email: mockUser.email, password: 'testpassword123' })
      .expect(200);

    expect(jwt.sign).toHaveBeenCalledTimes(1);
    const args = (jwt.sign as jest.Mock).mock.calls[0];
    const options = args[2];

    // Today jwt.sign is called with only (payload, secret): args[2] is undefined,
    // so the token never expires even though the cookie is capped at 7 days.
    expect(options).toBeDefined();
    expect(options).toEqual(expect.objectContaining({ expiresIn: expect.anything() }));
  });

  it('does not hand out a bearer token that survives logout', async () => {
    const response = await request(app)
      .post('/api/auth/signin')
      .send({ email: mockUser.email, password: 'testpassword123' });

    // The cookie is httpOnly and cleared on logout; the body token is neither.
    expect(response.body?.data?.token).toBeUndefined();
  });
});
