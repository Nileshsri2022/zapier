// Mock environment variables
process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-purposes-only';
process.env.NODE_ENV = 'test';

// Mock bcrypt
jest.mock('bcrypt', () => ({
  __esModule: true,
  default: {
    hashSync: jest.fn().mockReturnValue('$2b$10$hashedpassword'),
    compareSync: jest.fn().mockReturnValue(true),
  },
  hashSync: jest.fn().mockReturnValue('$2b$10$hashedpassword'),
  compareSync: jest.fn().mockReturnValue(true),
}));

// Mock jsonwebtoken
jest.mock('jsonwebtoken', () => ({
  __esModule: true,
  default: {
    sign: jest.fn().mockReturnValue('mock-jwt-token'),
  },
  sign: jest.fn().mockReturnValue('mock-jwt-token'),
}));

// Mock the email service to avoid sending actual emails during tests
jest.mock('@repo/email', () => ({
  sendEmail: jest.fn().mockResolvedValue(true),
}));

// Mock the database client
jest.mock('@repo/db', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    $transaction: jest.fn((callback: any) => callback({
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    })),
  },
}));

// Global test timeout
jest.setTimeout(10000);

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
});
