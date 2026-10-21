const mockFindManyTriggers = jest.fn();
const mockUpdateTrigger = jest.fn();
const mockUpdateServer = jest.fn();
const mockEnqueueRun = jest.fn();
const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();
const mockRedisDel = jest.fn();
const mockRedisSmembers = jest.fn();
const mockRedisSadd = jest.fn();
const mockRedisExpire = jest.fn();
const mockEventsList = jest.fn();
const mockCalendarList = jest.fn();
const mockRefreshAccessToken = jest.fn();
const mockSetCredentials = jest.fn();

jest.mock('@repo/db', () => ({
  __esModule: true,
  default: {
    googleCalendarTrigger: {
      findMany: (...args: any[]) => mockFindManyTriggers(...args),
      update: (...args: any[]) => mockUpdateTrigger(...args),
    },
    googleCalendarServer: {
      update: (...args: any[]) => mockUpdateServer(...args),
    },
  },
}));

jest.mock('@repo/runs', () => ({
  enqueueRun: (...args: any[]) => mockEnqueueRun(...args),
}));

jest.mock('@repo/redis', () => ({
  __esModule: true,
  default: {
    get: (...args: any[]) => mockRedisGet(...args),
    set: (...args: any[]) => mockRedisSet(...args),
    del: (...args: any[]) => mockRedisDel(...args),
    smembers: (...args: any[]) => mockRedisSmembers(...args),
    sadd: (...args: any[]) => mockRedisSadd(...args),
    expire: (...args: any[]) => mockRedisExpire(...args),
  },
}));

jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        setCredentials: mockSetCredentials,
        refreshAccessToken: mockRefreshAccessToken,
      })),
    },
    calendar: jest.fn().mockImplementation(() => ({
      events: {
        list: (...args: any[]) => mockEventsList(...args),
      },
      calendarList: {
        list: (...args: any[]) => mockCalendarList(...args),
      },
    })),
  },
}));

import { GoogleCalendarPoller } from '../src/pollers/GoogleCalendarPoller';

describe('GoogleCalendarPoller.poll - Seam 1 (All 7 Calendar Trigger Types)', () => {
  let poller: GoogleCalendarPoller;
  const baseServer = {
    id: 'cal-srv-1',
    accessToken: 'valid-token',
    refreshToken: 'refresh-token',
    tokenExpiry: new Date(Date.now() + 3600_000),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.CALENDAR_WEBHOOKS_ENABLED;
    poller = new GoogleCalendarPoller();
    mockEnqueueRun.mockResolvedValue({ status: 'queued', zapRunId: 'run-cal-1' });
    mockUpdateTrigger.mockResolvedValue({});
  });

  it('filters to non-instant triggers when CALENDAR_WEBHOOKS_ENABLED=true', async () => {
    process.env.CALENDAR_WEBHOOKS_ENABLED = 'true';
    mockFindManyTriggers.mockResolvedValue([]);

    const res = await poller.poll();

    expect(mockFindManyTriggers).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: true,
          zap: { isActive: true },
          isInstant: false,
        },
      })
    );
    expect(res.processed).toBe(0);
    expect(res.errors).toBe(0);
  });

  it('polls new_event and enqueues runs only for newly created uncached events', async () => {
    const now = new Date();
    const lastPolledAt = new Date(now.getTime() - 60_000);
    const createdAfter = new Date(now.getTime() - 10_000).toISOString();

    mockFindManyTriggers.mockResolvedValue([
      {
        id: 'trig-new',
        zapId: 'zap-1',
        calendarId: 'primary',
        triggerType: 'new_event',
        lastPolledAt,
        server: baseServer,
        zap: { id: 'zap-1', isActive: true },
      },
    ]);
    mockEventsList.mockResolvedValue({
      data: {
        items: [
          {
            id: 'evt-1',
            summary: 'Architecture Review',
            created: createdAfter,
            start: { dateTime: now.toISOString() },
            end: { dateTime: now.toISOString() },
          },
        ],
      },
    });
    mockRedisGet.mockResolvedValue(null);

    const res = await poller.poll();

    expect(res.processed).toBe(1);
    expect(mockEnqueueRun).toHaveBeenCalledWith(
      expect.objectContaining({
        zapId: 'zap-1',
        metadata: expect.objectContaining({
          trigger_type: 'new_event',
          event_id: 'evt-1',
          summary: 'Architecture Review',
        }),
      })
    );
    expect(mockRedisSet).toHaveBeenCalledWith('calendar:new_event:trig-new:evt-1', '1', {
      ex: 86400,
    });
  });

  it('polls event_updated and skips events where updated == created (<1s)', async () => {
    const now = new Date();
    const lastPolledAt = new Date(now.getTime() - 120_000);
    const createdLongAgo = new Date(now.getTime() - 600_000).toISOString();
    const updatedRecently = new Date(now.getTime() - 10_000).toISOString();

    mockFindManyTriggers.mockResolvedValue([
      {
        id: 'trig-upd',
        zapId: 'zap-2',
        calendarId: 'primary',
        triggerType: 'event_updated',
        lastPolledAt,
        server: baseServer,
        zap: { id: 'zap-2', isActive: true },
      },
    ]);
    mockEventsList.mockResolvedValue({
      data: {
        items: [
          {
            id: 'evt-fresh',
            summary: 'Just Created',
            created: updatedRecently,
            updated: updatedRecently,
          },
          {
            id: 'evt-modified',
            summary: 'Rescheduled Sync',
            created: createdLongAgo,
            updated: updatedRecently,
          },
        ],
      },
    });
    mockRedisGet.mockResolvedValue(null);

    const res = await poller.poll();

    expect(res.processed).toBe(1);
    expect(mockEnqueueRun).toHaveBeenCalledTimes(1);
    expect(mockEnqueueRun).toHaveBeenCalledWith(
      expect.objectContaining({
        zapId: 'zap-2',
        metadata: expect.objectContaining({
          trigger_type: 'event_updated',
          event_id: 'evt-modified',
        }),
      })
    );
  });

  it('polls event_start and event_ended within their configured time windows', async () => {
    const now = new Date();
    const endedTime = new Date(now.getTime() - 60_000).toISOString();

    mockFindManyTriggers.mockResolvedValue([
      {
        id: 'trig-start',
        zapId: 'zap-start',
        calendarId: 'primary',
        triggerType: 'event_start',
        reminderMinutes: 15,
        server: baseServer,
        zap: { id: 'zap-start', isActive: true },
      },
      {
        id: 'trig-end',
        zapId: 'zap-end',
        calendarId: 'primary',
        triggerType: 'event_ended',
        server: baseServer,
        zap: { id: 'zap-end', isActive: true },
      },
    ]);
    mockEventsList
      .mockResolvedValueOnce({
        data: { items: [{ id: 'evt-starting', summary: 'Standup' }] },
      })
      .mockResolvedValueOnce({
        data: {
          items: [{ id: 'evt-ended', summary: 'Retro', end: { dateTime: endedTime } }],
        },
      });
    mockRedisGet.mockResolvedValue(null);

    const res = await poller.poll();

    expect(res.processed).toBe(2);
    expect(mockEnqueueRun).toHaveBeenCalledWith(
      expect.objectContaining({
        zapId: 'zap-start',
        metadata: expect.objectContaining({ trigger_type: 'event_start', event_id: 'evt-starting' }),
      })
    );
    expect(mockEnqueueRun).toHaveBeenCalledWith(
      expect.objectContaining({
        zapId: 'zap-end',
        metadata: expect.objectContaining({ trigger_type: 'event_ended', event_id: 'evt-ended' }),
      })
    );
  });

  it('polls event_cancelled with syncToken and resets token on HTTP 410 Gone', async () => {
    mockFindManyTriggers.mockResolvedValue([
      {
        id: 'trig-cancel',
        zapId: 'zap-cancel',
        calendarId: 'primary',
        triggerType: 'event_cancelled',
        server: baseServer,
        zap: { id: 'zap-cancel', isActive: true },
      },
    ]);
    mockRedisGet.mockResolvedValueOnce('sync-tok-1');
    mockEventsList.mockResolvedValueOnce({
      data: {
        items: [{ id: 'evt-del', status: 'cancelled', summary: 'Cancelled Call' }],
        nextSyncToken: 'sync-tok-2',
      },
    });

    const first = await poller.poll();
    expect(first.processed).toBe(1);
    expect(mockRedisSet).toHaveBeenCalledWith(
      'calendar:sync_token:trig-cancel',
      'sync-tok-2',
      expect.any(Object)
    );

    // Simulate 410 Gone on next poll
    mockRedisGet.mockResolvedValueOnce('expired-tok');
    mockEventsList.mockRejectedValueOnce({ code: 410 });
    const second = await poller.poll();
    expect(second.errors).toBe(0);
    expect(mockRedisDel).toHaveBeenCalledWith('calendar:sync_token:trig-cancel');
  });

  it('polls new_calendar and event_matching_search accurately', async () => {
    mockFindManyTriggers.mockResolvedValue([
      {
        id: 'trig-cal',
        zapId: 'zap-cal',
        triggerType: 'new_calendar',
        server: baseServer,
        zap: { id: 'zap-cal', isActive: true },
      },
      {
        id: 'trig-search',
        zapId: 'zap-search',
        triggerType: 'event_matching_search',
        searchQuery: 'incident',
        server: baseServer,
        zap: { id: 'zap-search', isActive: true },
      },
    ]);
    mockCalendarList.mockResolvedValue({
      data: {
        items: [
          { id: 'cal-existing', summary: 'Primary' },
          { id: 'cal-new', summary: 'Engineering On-Call' },
        ],
      },
    });
    mockRedisSmembers.mockResolvedValue(['cal-existing']);
    mockEventsList.mockResolvedValue({
      data: {
        items: [{ id: 'evt-inc', summary: 'Prod incident postmortem' }],
      },
    });
    mockRedisGet.mockResolvedValue(null);

    const res = await poller.poll();

    expect(res.processed).toBe(2);
    expect(mockEnqueueRun).toHaveBeenCalledWith(
      expect.objectContaining({
        zapId: 'zap-cal',
        metadata: expect.objectContaining({
          trigger_type: 'new_calendar',
          calendar_id: 'cal-new',
        }),
      })
    );
    expect(mockEnqueueRun).toHaveBeenCalledWith(
      expect.objectContaining({
        zapId: 'zap-search',
        metadata: expect.objectContaining({
          trigger_type: 'event_matching_search',
          search_query: 'incident',
          event_id: 'evt-inc',
        }),
      })
    );
  });
});
