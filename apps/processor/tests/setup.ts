process.env.NODE_ENV = 'test';

jest.setTimeout(10000);

jest.mock('@repo/db', () => ({
  __esModule: true,
  default: {
    googleSheetsTrigger: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
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
    },
    $disconnect: jest.fn(),
  },
}));

jest.mock('@repo/redis', () => ({
  __esModule: true,
  default: {
    hget: jest.fn(),
    hset: jest.fn(),
    expire: jest.fn(),
    del: jest.fn(),
  },
  redis: {
    hget: jest.fn(),
    hset: jest.fn(),
    expire: jest.fn(),
    del: jest.fn(),
  },
}));

jest.mock('@repo/runs', () => ({
  __esModule: true,
  enqueueRun: jest.fn(),
}));

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.clearAllMocks();
});
