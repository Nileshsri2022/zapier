import { GoogleSheetsService } from '../../src/services/GoogleSheetsService';

const mockValuesGet = jest.fn();

jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        setCredentials: jest.fn(),
        credentials: { expiry_date: Date.now() + 60 * 60 * 1000 },
        refreshAccessToken: jest.fn(),
      })),
    },
    sheets: jest.fn().mockImplementation(() => ({
      spreadsheets: {
        values: { get: (...args: any[]) => mockValuesGet(...args) },
      },
    })),
  },
}));

const hashStore = new Map<string, Map<string, string>>();

jest.mock('@repo/redis', () => ({
  __esModule: true,
  default: {
    hget: jest.fn(async (key: string, field: string) => hashStore.get(key)?.get(field) ?? null),
    hset: jest.fn(async (key: string, values: Record<string, string>) => {
      const hash = hashStore.get(key) ?? new Map<string, string>();
      for (const [field, value] of Object.entries(values)) hash.set(field, value);
      hashStore.set(key, hash);
      return 1;
    }),
    expire: jest.fn(async () => 1),
  },
}));

const service = new GoogleSheetsService(
  { refreshToken: 'refresh-token', tokenExpiry: new Date(Date.now() + 60 * 60 * 1000) },
  'server-1'
);

const mockSheet = (rows: string[][]) => {
  mockValuesGet.mockResolvedValue({ data: { values: rows } });
};

describe('GoogleSheetsService A1 ranges', () => {
  beforeEach(() => {
    mockValuesGet.mockReset();
    hashStore.clear();
  });

  it('quotes sheet names that contain spaces', async () => {
    mockSheet([['Name'], ['Alice']]);

    await service.getSpreadsheetData('sheet-id', 'My Sheet');

    expect(mockValuesGet).toHaveBeenCalledWith(
      expect.objectContaining({ range: "'My Sheet'!A:Z" })
    );
  });

  it("escapes embedded single quotes (Bob's Sheet)", async () => {
    mockSheet([['Name'], ['Alice']]);

    await service.getSpreadsheetData('sheet-id', "Bob's Sheet");

    expect(mockValuesGet).toHaveBeenCalledWith(
      expect.objectContaining({ range: "'Bob''s Sheet'!A:Z" })
    );
  });
});

describe('GoogleSheetsService.pollForUpdates baseline semantics', () => {
  beforeEach(() => {
    mockValuesGet.mockReset();
    hashStore.clear();
  });

  it('primes existing rows without emitting them', async () => {
    mockSheet([
      ['Name', 'Email'],
      ['Alice', 'alice@example.com'],
    ]);

    const firstPoll = await service.pollForUpdates('trigger-1', 'sheet-id', 'Sheet1');
    expect(firstPoll).toEqual([]);
  });

  it('does not emit a newly appended row (the processor poller owns new rows)', async () => {
    mockSheet([
      ['Name', 'Email'],
      ['Alice', 'alice@example.com'],
    ]);
    await service.pollForUpdates('trigger-1', 'sheet-id', 'Sheet1');

    mockSheet([
      ['Name', 'Email'],
      ['Alice', 'alice@example.com'],
      ['Bob', 'bob@example.com'],
    ]);
    const secondPoll = await service.pollForUpdates('trigger-1', 'sheet-id', 'Sheet1');

    expect(secondPoll).toEqual([]);
  });

  it('still reports an in-place edit to an existing row', async () => {
    mockSheet([
      ['Name', 'Email'],
      ['Alice', 'alice@example.com'],
    ]);
    await service.pollForUpdates('trigger-1', 'sheet-id', 'Sheet1');

    mockSheet([
      ['Name', 'Email'],
      ['Alice', 'alice.new@example.com'],
    ]);
    const secondPoll = await service.pollForUpdates('trigger-1', 'sheet-id', 'Sheet1');

    expect(secondPoll).toEqual([
      { row_number: 2, row_data: { Name: 'Alice', Email: 'alice.new@example.com' } },
    ]);
  });
});
