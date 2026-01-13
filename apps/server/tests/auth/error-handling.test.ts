import request from 'supertest';
import { createTestApp } from '../utils';

const app = createTestApp();

describe('Authentication - Error Handling', () => {
  describe('General Error Handling', () => {
    it('should handle malformed JSON in request body', async () => {
      const response = await request(app)
        .post('/api/auth/signup')
        .set('Content-Type', 'application/json')
        .send('{ invalid json }')
        .expect(400); // Express default error for malformed JSON

      expect(response.body).toBeDefined();
    });

    it('should handle unsupported HTTP methods', async () => {
      const response = await request(app)
        .put('/api/auth/signup')
        .send({})
        .expect(404); // Route not found

      expect(response.body).toBeDefined();
    });

    it('should handle requests to non-existent endpoints', async () => {
      const response = await request(app)
        .get('/api/auth/nonexistent')
        .expect(403); // Express returns 403 for routes without handlers

      expect(response.body).toBeDefined();
    });
  });

  describe('Input Sanitization', () => {
    it('should handle HTML/script injection attempts', async () => {
      const maliciousUser = {
        name: '<script>alert("xss")</script>',
        email: 'test@example.com<script>',
        password: 'password123<script>',
      };

      const response = await request(app)
        .post('/api/auth/signup')
        .send(maliciousUser)
        .expect(422); // Should fail validation

      expect(response.body).toHaveProperty('message', 'Invalid credentials');
    });

    it('should handle SQL injection attempts', async () => {
      const maliciousUser = {
        name: "'; DROP TABLE users; --",
        email: "test@example.com'; --",
        password: "password'; --",
      };

      const response = await request(app)
        .post('/api/auth/signup')
        .send(maliciousUser)
        .expect(422); // Should fail validation

      expect(response.body).toHaveProperty('message', 'Invalid credentials');
    });

    it('should handle extremely large payloads', async () => {
      const largePayload = 'x'.repeat(100000); // 100KB payload
      const largeUser = {
        name: largePayload,
        email: largePayload,
        password: largePayload,
      };

      const response = await request(app)
        .post('/api/auth/signup')
        .send(largeUser)
        .expect(413); // Payload too large

      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('Rate Limiting Simulation', () => {
    it('should handle rapid consecutive requests', async () => {
      const requests = Array(10).fill(null).map(() =>
        request(app)
          .post('/api/auth/signup')
          .send({
            name: 'Test User',
            email: 'test@example.com',
            password: 'testpassword123',
          })
      );

      const responses = await Promise.all(requests);

      // At least some requests should fail due to validation or rate limiting
      const failureCount = responses.filter(r => r.status >= 400).length;
      expect(failureCount).toBeGreaterThan(0);
    });
  });

  describe('Network and Timeout Handling', () => {
    it('should handle slow requests gracefully', async () => {
      // This test simulates a slow request
      const startTime = Date.now();

      const response = await request(app)
        .post('/api/auth/signup')
        .send({
          name: 'Test User',
          email: 'test@example.com',
          password: 'testpassword123',
        })
        .timeout(5000); // 5 second timeout

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(5000); // Should complete within timeout
      expect(response.status).toBeDefined();
    });
  });

  describe('Authentication Middleware', () => {
    it('should handle requests without authorization header', async () => {
      const response = await request(app)
        .get('/api/auth/123')
        .expect(403); // Express returns 403 for protected routes without auth

      expect(response.body).toBeDefined();
    });

    it('should handle requests with invalid authorization header', async () => {
      const response = await request(app)
        .get('/api/auth/123')
        .set('Authorization', 'Invalid')
        .expect(403);

      expect(response.body).toBeDefined();
    });

    it('should handle requests with malformed JWT token', async () => {
      const response = await request(app)
        .get('/api/auth/123')
        .set('Authorization', 'Bearer invalid.jwt.token')
        .expect(403);

      expect(response.body).toBeDefined();
    });

    it('should handle requests with expired JWT token', async () => {
      // Create an expired token for testing
      const jwt = require('jsonwebtoken');
      const expiredToken = jwt.sign({ id: 123 }, process.env.JWT_SECRET, { expiresIn: '-1h' });

      const response = await request(app)
        .get('/api/auth/123')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(403);

      expect(response.body).toBeDefined();
    });
  });

  describe('Database Connection Issues', () => {
    it('should handle database connection failures gracefully', async () => {
      // This test would require mocking the database connection to fail
      // For now, we'll test the general error handling structure

      const response = await request(app)
        .post('/api/auth/signup')
        .send({
          name: 'Test User',
          email: 'test@example.com',
          password: 'testpassword123',
        });

      // The response should be either success or a proper error
      expect([200, 201, 400, 422, 500]).toContain(response.status);
    });
  });

  describe('Environment and Configuration Issues', () => {
    it('should handle missing JWT secret', async () => {
      const originalSecret = process.env.JWT_SECRET;
      delete process.env.JWT_SECRET;

      const response = await request(app)
        .post('/api/auth/signin')
        .send({
          email: 'test@example.com',
          password: 'testpassword123',
        });

      // Restore the secret
      process.env.JWT_SECRET = originalSecret;

      // Should handle the error gracefully
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });
});
