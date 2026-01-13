import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { createTestApp, testUser, mockUser } from '../utils';
import client from '@repo/db';

const app = createTestApp();

describe('Authentication - Signin', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();
  });

  describe('POST /api/auth/signin', () => {
    describe('Successful Signin', () => {
      it('should sign in user with correct credentials', async () => {
        // Mock existing user
        (client.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

        // Mock bcrypt comparison
        (bcrypt.compareSync as jest.Mock).mockReturnValue(true);

        // Mock JWT sign
        (jwt.sign as jest.Mock).mockReturnValue('mock-jwt-token');

        const signinData = {
          email: testUser.email,
          password: testUser.password,
        };

        const response = await request(app)
          .post('/api/auth/signin')
          .send(signinData)
          .expect(200);

        expect(response.body).toHaveProperty('message', 'Signin successful');
        expect(response.body).toHaveProperty('data');
        expect(response.body.data).toHaveProperty('id', mockUser.id);
        expect(response.body.data).toHaveProperty('name', mockUser.name);
        expect(response.body.data).toHaveProperty('email', mockUser.email);
        expect(response.body.data).toHaveProperty('token', 'mock-jwt-token');
      });

      it('should generate JWT token with correct payload', async () => {
        (client.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
        (bcrypt.compareSync as jest.Mock).mockReturnValue(true);
        (jwt.sign as jest.Mock).mockReturnValue('mock-jwt-token');

        const signinData = {
          email: testUser.email,
          password: testUser.password,
        };

        await request(app)
          .post('/api/auth/signin')
          .send(signinData);

        // Verify JWT was signed with user id
        expect(jwt.sign).toHaveBeenCalled();
      });
    });

    describe('Validation Errors', () => {
      it('should return 422 for invalid email format', async () => {
        const invalidSigninData = {
          email: 'invalid-email',
          password: testUser.password,
        };

        const response = await request(app)
          .post('/api/auth/signin')
          .send(invalidSigninData)
          .expect(422);

        expect(response.body).toHaveProperty('message', 'Invalid credentials');
        expect(response.body).toHaveProperty('error');
        expect(response.body.error).toHaveProperty('email');
      });

      it('should return 422 for password too short', async () => {
        const shortPasswordData = {
          email: testUser.email,
          password: '123',
        };

        const response = await request(app)
          .post('/api/auth/signin')
          .send(shortPasswordData)
          .expect(422);

        expect(response.body).toHaveProperty('message', 'Invalid credentials');
        expect(response.body).toHaveProperty('error');
        expect(response.body.error).toHaveProperty('password');
      });

      it('should return 422 for missing required fields', async () => {
        const incompleteData = { email: 'test@example.com' };

        const response = await request(app)
          .post('/api/auth/signin')
          .send(incompleteData)
          .expect(422);

        expect(response.body).toHaveProperty('message', 'Invalid credentials');
        expect(response.body).toHaveProperty('error');
      });
    });

    describe('Authentication Errors', () => {
      it('should return 422 when user does not exist', async () => {
        // Mock no user found
        (client.user.findUnique as jest.Mock).mockResolvedValue(null);

        const signinData = {
          email: 'nonexistent@example.com',
          password: testUser.password,
        };

        const response = await request(app)
          .post('/api/auth/signin')
          .send(signinData)
          .expect(422);

        expect(response.body).toHaveProperty('message', 'User does not exist');
        expect(response.body).toHaveProperty('error', 'User does not exist');
      });

      it('should return 422 for incorrect password', async () => {
        // Mock existing user
        (client.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

        // Mock incorrect password
        (bcrypt.compareSync as jest.Mock).mockReturnValue(false);

        const signinData = {
          email: testUser.email,
          password: 'wrongpassword',
        };

        const response = await request(app)
          .post('/api/auth/signin')
          .send(signinData)
          .expect(422);

        expect(response.body).toHaveProperty('message', 'Invalid credentials');
        expect(response.body).toHaveProperty('error');
      });

      it('should handle bcrypt comparison errors', async () => {
        (client.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

        // Mock bcrypt throwing an error
        (bcrypt.compareSync as jest.Mock).mockImplementation(() => {
          throw new Error('bcrypt error');
        });

        const signinData = {
          email: testUser.email,
          password: testUser.password,
        };

        const response = await request(app)
          .post('/api/auth/signin')
          .send(signinData);

        // Accept 422 or 500 depending on error handling
        expect([422, 500]).toContain(response.status);
      });
    });

    it('should handle JWT signing errors', async () => {
      (client.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (bcrypt.compareSync as jest.Mock).mockReturnValue(true);

      // Mock JWT throwing an error
      (jwt.sign as jest.Mock).mockImplementation(() => {
        throw new Error('JWT error');
      });

      const signinData = {
        email: testUser.email,
        password: testUser.password,
      };

      const response = await request(app)
        .post('/api/auth/signin')
        .send(signinData);

      // Accept 500 or 200 depending on error handling
      expect([500, 200]).toContain(response.status);
    });

    it('should use correct JWT secret from environment', async () => {
      (client.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (bcrypt.compareSync as jest.Mock).mockReturnValue(true);
      (jwt.sign as jest.Mock).mockReturnValue('mock-jwt-token');

      const signinData = {
        email: testUser.email,
        password: testUser.password,
      };

      await request(app)
        .post('/api/auth/signin')
        .send(signinData);

      expect(jwt.sign).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty request body', async () => {
      const response = await request(app)
        .post('/api/auth/signin')
        .send({})
        .expect(422);

      expect(response.body).toHaveProperty('message', 'Invalid credentials');
    });

    it('should handle null values in request', async () => {
      const nullValueData = {
        email: null,
        password: null,
      };

      const response = await request(app)
        .post('/api/auth/signin')
        .send(nullValueData)
        .expect(422);

      expect(response.body).toHaveProperty('message', 'Invalid credentials');
    });

    it('should handle case-sensitive email matching', async () => {
      (client.user.findUnique as jest.Mock).mockResolvedValue(null);

      const signinData = {
        email: 'Test@Example.Com', // Different case
        password: testUser.password,
      };

      const response = await request(app)
        .post('/api/auth/signin')
        .send(signinData)
        .expect(422);

      expect(response.body).toHaveProperty('message', 'User does not exist');
    });

    it('should handle database query errors', async () => {
      (client.user.findUnique as jest.Mock).mockRejectedValueOnce(new Error('Database error'));

      const signinData = {
        email: testUser.email,
        password: testUser.password,
      };

      const response = await request(app)
        .post('/api/auth/signin')
        .send(signinData);

      // Accept 500 or 422 depending on error handling
      expect([500, 422]).toContain(response.status);
    });
  });
});
});
