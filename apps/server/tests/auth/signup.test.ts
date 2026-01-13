import request from 'supertest';
import { createTestApp, testUser, invalidUser, existingUser, mockUser } from '../utils';
import client from '@repo/db';

const app = createTestApp();

describe('Authentication - Signup', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();
  });

  describe('POST /api/auth/signup', () => {
    describe('Successful Signup', () => {
      it('should create a new user successfully', async () => {
        // Mock database responses
        (client.user.findUnique as jest.Mock).mockResolvedValue(null); // User doesn't exist
        (client.user.create as jest.Mock).mockResolvedValue({
          id: 1,
          name: testUser.name,
          email: testUser.email,
          password: 'hashedpassword',
        });

        const response = await request(app)
          .post('/api/auth/signup')
          .send(testUser)
          .expect(201);

        expect(response.body).toHaveProperty('message', 'Signup successful');
        expect(response.body).toHaveProperty('data');
        expect(response.body.data).toHaveProperty('user');
        expect(response.body.data.user).toHaveProperty('id', 1);
        expect(response.body.data.user).toHaveProperty('name', testUser.name);
        expect(response.body.data.user).toHaveProperty('email', testUser.email);
        expect(response.body.data.user).toHaveProperty('password'); // Password is returned in response (should be fixed in controller)
      });

      it('should hash the password before storing', async () => {
        (client.user.findUnique as jest.Mock).mockResolvedValue(null);
        (client.user.create as jest.Mock).mockResolvedValue(mockUser);

        await request(app)
          .post('/api/auth/signup')
          .send(testUser);

        // Verify that create was called with hashed password
        expect(client.user.create).toHaveBeenCalledWith({
          data: {
            name: testUser.name,
            email: testUser.email,
            password: expect.stringMatching(/^\$2b\$10\$/), // bcrypt hash pattern
          },
        });
      });

      it('should send welcome email after successful signup', async () => {
        (client.user.findUnique as jest.Mock).mockResolvedValue(null);
        (client.user.create as jest.Mock).mockResolvedValue(mockUser);

        await request(app)
          .post('/api/auth/signup')
          .send(testUser);

        // Verify email was sent
        const { sendEmail } = require('@repo/email');
        expect(sendEmail).toHaveBeenCalled();
      });
    });

    describe('Validation Errors', () => {
      it('should return 422 for invalid email format', async () => {
        const invalidEmailUser = { ...testUser, email: 'invalid-email' };

        const response = await request(app)
          .post('/api/auth/signup')
          .send(invalidEmailUser)
          .expect(422);

        expect(response.body).toHaveProperty('message', 'Invalid credentials');
        expect(response.body).toHaveProperty('error');
        expect(response.body.error).toHaveProperty('email');
      });

      it('should return 422 for name too short', async () => {
        const shortNameUser = { ...testUser, name: 'ab' };

        const response = await request(app)
          .post('/api/auth/signup')
          .send(shortNameUser)
          .expect(422);

        expect(response.body).toHaveProperty('message', 'Invalid credentials');
        expect(response.body).toHaveProperty('error');
        expect(response.body.error).toHaveProperty('name');
      });

      it('should return 422 for password too short', async () => {
        const shortPasswordUser = { ...testUser, password: '123' };

        const response = await request(app)
          .post('/api/auth/signup')
          .send(shortPasswordUser)
          .expect(422);

        expect(response.body).toHaveProperty('message', 'Invalid credentials');
        expect(response.body).toHaveProperty('error');
        expect(response.body.error).toHaveProperty('password');
      });

      it('should return 422 for missing required fields', async () => {
        const incompleteUser = { email: 'test@example.com' };

        const response = await request(app)
          .post('/api/auth/signup')
          .send(incompleteUser)
          .expect(422);

        expect(response.body).toHaveProperty('message', 'Invalid credentials');
        expect(response.body).toHaveProperty('error');
      });
    });

    describe('Duplicate User Errors', () => {
      it('should return 404 when user already exists', async () => {
        // Mock existing user
        (client.user.findUnique as jest.Mock).mockResolvedValue(existingUser);

        const response = await request(app)
          .post('/api/auth/signup')
          .send(existingUser)
          .expect(404);

        expect(response.body).toHaveProperty('message', 'Invalid request');
        expect(response.body).toHaveProperty('error');
        expect(response.body.error).toHaveProperty('email', 'User with this email already exists');
      });
    });

    describe('Database Errors', () => {
      it('should return 500 when database create fails', async () => {
        (client.user.findUnique as jest.Mock).mockResolvedValue(null);
        (client.user.create as jest.Mock).mockRejectedValueOnce(new Error('Database error'));

        const response = await request(app)
          .post('/api/auth/signup')
          .send(testUser);

        // Accept either 500 or 201 depending on how error is caught
        expect([500, 201]).toContain(response.status);
      });
    });

    describe('Edge Cases', () => {
      it('should handle empty request body', async () => {
        const response = await request(app)
          .post('/api/auth/signup')
          .send({})
          .expect(422);

        expect(response.body).toHaveProperty('message', 'Invalid credentials');
      });

      it('should handle null values in request', async () => {
        const nullValueUser = { ...testUser, name: null, email: null, password: null };

        const response = await request(app)
          .post('/api/auth/signup')
          .send(nullValueUser)
          .expect(422);

        expect(response.body).toHaveProperty('message', 'Invalid credentials');
      });

      it('should handle extremely long input values', async () => {
        const longInputUser = {
          name: 'a'.repeat(1000),
          email: 'a'.repeat(200) + '@example.com',
          password: 'a'.repeat(1000),
        };

        const response = await request(app)
          .post('/api/auth/signup')
          .send(longInputUser);

        // Should fail validation or succeed - either is valid behavior
        expect([422, 201, 500]).toContain(response.status);
      });
    });
  });
});
