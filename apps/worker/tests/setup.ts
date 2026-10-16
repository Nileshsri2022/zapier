// Shared setup for worker tests.
// The worker's pure helpers are tested here; anything that touches Kafka,
// Postgres or the network is out of scope for this suite.

process.env.NODE_ENV = 'test';

jest.setTimeout(10000);

// The worker's helpers log progress via console.log/warn; keep test output readable.
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.clearAllMocks();
});
