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
    zap: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    trigger: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    action: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    availableTriggers: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    availableActions: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    zapRun: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    zapRunOutbox: {
      findMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    gmailServer: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    gmailTrigger: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    googleSheetsServer: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      upsert: jest.fn(),
    },
    googleSheetsTrigger: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn((callback: any) => callback({
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      zap: {
        create: jest.fn(),
      },
      trigger: {
        create: jest.fn(),
      },
      action: {
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
