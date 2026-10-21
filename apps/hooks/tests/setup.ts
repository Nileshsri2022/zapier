/**
 * Global test setup: mock @repo/db (Prisma client is not generated in the
 * test environment) and @repo/redis so route/handler suites never touch a
 * real database. Files that define their own jest.mock('@repo/db') keep
 * their own (more specific) mock.
 */
jest.mock('@repo/db', () => ({
  __esModule: true,
  default: {
    zap: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    trigger: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    telegramTrigger: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    whatsAppTrigger: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    $disconnect: jest.fn(),
  },
  PrismaClient: class PrismaClient {},
}));

jest.mock('@repo/redis', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    expire: jest.fn(),
    hget: jest.fn(),
    hset: jest.fn(),
    sadd: jest.fn(),
    smembers: jest.fn(),
  },
  redis: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    expire: jest.fn(),
    hget: jest.fn(),
    hset: jest.fn(),
    sadd: jest.fn(),
    smembers: jest.fn(),
  },
}));
