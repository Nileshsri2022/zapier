import request from 'supertest';
import express from 'express';
import client from '@repo/db';
import { AuthRouter } from '../../src/routes/AuthRoutes';

const app = express();
app.use(express.json());
app.use('/api/auth', AuthRouter);

describe('POST /api/auth/signup — response shape', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does not return the password hash to the client', async () => {
    (client.user.findUnique as jest.Mock).mockResolvedValue(null);
    (client.user.create as jest.Mock).mockResolvedValue({
      id: 7,
      name: 'New User',
      email: 'new@example.com',
      password: '$2b$10$hashed-password-value',
    });

    const response = await request(app).post('/api/auth/signup').send({
      name: 'New User',
      email: 'new@example.com',
      password: 'password123',
    });

    expect(response.status).toBe(201);
    expect(response.body.data.user).toEqual({
      id: 7,
      name: 'New User',
      email: 'new@example.com',
    });
    expect(JSON.stringify(response.body)).not.toContain('hashed-password-value');
  });
});
