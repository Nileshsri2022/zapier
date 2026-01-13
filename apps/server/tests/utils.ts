import request from 'supertest';
import express from 'express';
import { AuthRouter } from '../src/routes/AuthRoutes';

// Create test app
export const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', AuthRouter);
  return app;
};

// Test user data
export const testUser = {
  name: 'Test User',
  email: 'test@example.com',
  password: 'testpassword123',
};

export const invalidUser = {
  name: 'ab', // Too short
  email: 'invalid-email', // Invalid email
  password: '123', // Too short
};

export const existingUser = {
  name: 'Existing User',
  email: 'existing@example.com',
  password: 'existingpassword123',
};

// Mock user for database
export const mockUser = {
  id: 1,
  name: 'Test User',
  email: 'test@example.com',
  password: '$2b$10$hashedpassword',
};

// Helper function to make authenticated requests
export const makeAuthRequest = (app: express.Application, method: 'post' | 'get', endpoint: string, token?: string) => {
  const req = request(app)[method](endpoint);
  if (token) {
    req.set('Authorization', `Bearer ${token}`);
  }
  return req;
};
