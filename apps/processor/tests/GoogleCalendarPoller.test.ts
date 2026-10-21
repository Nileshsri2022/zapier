import { GoogleCalendarPoller, calendarInstanceKey, isAllDayEvent, buildCalendarRunPayload } from '../src/pollers/GoogleCalendarPoller';
import client from '@repo/db';
import redis from '@repo/redis';
import { enqueueRun } from '@repo/runs';

/**
 * Google Calendar poller — grilled T3 spec
 * (docs/ask-matt/triggers/google-calendar.md, round 5): three-event
 * lifecycle contract, recurring instance expansion, all-day normalization,
 * per-instance update watermark, syncToken cancellations.
 */

const mockEventsList = jest.fn();
const mockCalendarList = jest.fn();
const mockRefreshAccessToken = jest.fn();

jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        setCredentials: jest.fn(),
        credentials: { expiry_date: Date.now() + 60 * 60 * 1000 },
        refreshAccessToken: (...args: any[]) => mockRefreshAccessToken(...args),
      })),
    },
    calendar: jest.fn().mockImplementation(() => ({
      events: { list: (...args: any[]) => mockEventsList(...args) },
      calendarList: { list: (...args: any[]) => mockCalendarList(...args) },
    })),
  },
}));

describe('GoogleCalendarPoller — T3 grilled spec', () => {
  let poller: GoogleCalendarPoller;

  const baseTrigger = (overrides: any = {}) => ({
    id: 'cal-trigger-1',
    zapId: 'zap-1',
    triggerType: 'new_event',
    calendarId: 'team@group.calendar.google.com',
    isActive: true,
    isInstant: false,
    searchQuery: null,
    reminderMinutes: null,
    lastPolledAt: new Date('2026-10-20T00:00:00.000Z'),
    server: {
      id: 'server-1',
      refreshToken: 'rt',
      accessToken: 'at',
      tokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
    },
    zap: { id: 'zap-1', isActive: true },
    ...overrides,
  });

  const baseEvent = {
    id: 'evt-1',
    status: 'confirmed',
    summary: 'Design review',
    description: 'Quarterly design review',
    location: 'Room 4',
    start: { dateTime: '2026-10-22T15:00:00+05:30', timeZone: 'Asia/Kolkata' },
    end: { dateTime: '2026-10-22T16:00:00+05:30', timeZone: 'Asia/Kolkata' },
    organizer: { email: 'ada@example.com', displayName: 'Ada' },
    attendees: [{ email: 'bob@example.com', responseStatus: 'accepted' }],
    htmlLink: 'https://www.google.com/calendar/event?eid=abc',
    created: '2026-10-21T08:00:00Z',
    updated: '2026-10-21T08:00:00Z',
    recurringEventId: null,
  };

  beforeEach(() => {
    poller = new GoogleCalendarPoller();
    jest.clearAllMocks();
    (enqueueRun as jest.Mock).mockResolvedValue({ status: 'queued', zapRunId: 'run-1' });
    (redis.get as jest.Mock).mockResolvedValue(null);
  });

  describe('pollNewEvent', () => {
    it('fires the unified contract for events created after the last poll, scoped to trigger.calendarId', async () => {
      (client.googleCalendarTrigger.findMany as jest.Mock).mockResolvedValue([
        baseTrigger(),
      ]);
      mockEventsList.mockResolvedValue({ data: { items: [baseEvent] } });

      const result = await poller.poll();

      expect(result.processed).toBe(1);
      expect(mockEventsList).toHaveBeenCalledWith(
        expect.objectContaining({ calendarId: 'team@group.calendar.google.com' })
      );
      expect(enqueueRun).toHaveBeenCalledTimes(1);
      const { metadata, dedup } = (enqueueRun as jest.Mock).mock.calls[0][0];
      expect(metadata).toMatchObject({
        eventId: 'evt-1',
        instanceKey: 'evt-1',
        status: 'confirmed',
        event: 'created',
        trigger_type: 'new_event',
        event_id: 'evt-1',
        summary: 'Design review',
        description: 'Quarterly design review',
        location: 'Room 4',
        allDay: false,
        recurringEventId: null,
        organizer: { email: 'ada@example.com', displayName: 'Ada' },
        attendees: [{ email: 'bob@example.com', responseStatus: 'accepted' }],
        htmlLink: 'https://www.google.com/calendar/event?eid=abc',
        html_link: 'https://www.google.com/calendar/event?eid=abc',
        updatedAt: '2026-10-21T08:00:00Z',
      });
      expect(dedup).toEqual({
        scope: 'calendar',
        key: 'zap-1:cal:created:evt-1',
      });
    });

    it('expands recurring series into one run per occurrence with distinct instanceKeys', async () => {
      (client.googleCalendarTrigger.findMany as jest.Mock).mockResolvedValue([
        baseTrigger(),
      ]);
      const mkInstance = (suffix: string, start: string) => ({
        ...baseEvent,
        id: `series-1_${suffix}`,
        recurringEventId: 'series-1',
        start: { dateTime: start, timeZone: 'Asia/Kolkata' },
        end: { dateTime: start, timeZone: 'Asia/Kolkata' },
      });
      mockEventsList.mockResolvedValue({
        data: {
          items: [
            mkInstance('20261022T150000Z', '2026-10-22T15:00:00+05:30'),
            mkInstance('20261023T150000Z', '2026-10-23T15:00:00+05:30'),
          ],
        },
      });

      const result = await poller.poll();

      expect(result.processed).toBe(2);
      const metas = (enqueueRun as jest.Mock).mock.calls.map((c: any[]) => c[0].metadata);
      expect(metas).toHaveLength(2);
      expect(metas[0].instanceKey).toBe(
        `series-1@${'2026-10-22T15:00:00+05:30'}`
      );
      expect(metas[1].instanceKey).toBe(
        `series-1@${'2026-10-23T15:00:00+05:30'}`
      );
      expect(metas.every((m: any) => m.recurringEventId === 'series-1')).toBe(true);
      expect(new Set(metas.map((m: any) => m.instanceKey)).size).toBe(2);
    });

    it('flags all-day events (start.date, no dateTime) with allDay: true', async () => {
      (client.googleCalendarTrigger.findMany as jest.Mock).mockResolvedValue([
        baseTrigger(),
      ]);
      mockEventsList.mockResolvedValue({
        data: {
          items: [
            {
              ...baseEvent,
              id: 'allday-1',
              start: { date: '2026-10-24' },
              end: { date: '2026-10-25' },
            },
          ],
        },
      });

      await poller.poll();

      const meta = (enqueueRun as jest.Mock).mock.calls[0][0].metadata;
      expect(meta.allDay).toBe(true);
      expect(meta.start).toEqual({ date: '2026-10-24' });
      expect(isAllDayEvent({ start: { date: '2026-10-24' } })).toBe(true);
      expect(isAllDayEvent({ start: { dateTime: '2026-10-24T10:00:00Z' } })).toBe(false);
    });

    it('never fires events created before the trigger last poll (no historic burst)', async () => {
      (client.googleCalendarTrigger.findMany as jest.Mock).mockResolvedValue([
        baseTrigger(),
      ]);
      mockEventsList.mockResolvedValue({
        data: { items: [{ ...baseEvent, created: '2026-10-01T00:00:00Z' }] },
      });

      const result = await poller.poll();
      expect(result.processed).toBe(0);
      expect(enqueueRun).not.toHaveBeenCalled();
    });
  });

  describe('pollEventUpdated', () => {
    it('fires per updated version with event: updated, and never for just-created events', async () => {
      (client.googleCalendarTrigger.findMany as jest.Mock).mockResolvedValue([
        baseTrigger({ triggerType: 'event_updated' }),
      ]);

      // Case A: fresh create (updated ≈ created) — must be skipped
      mockEventsList.mockResolvedValueOnce({
        data: {
          items: [
            {
              ...baseEvent,
              created: '2026-10-21T08:00:00.000Z',
              updated: '2026-10-21T08:00:00.500Z',
            },
          ],
        },
      });
      const freshResult = await poller.poll();
      expect(freshResult.processed).toBe(0);
      expect(enqueueRun).not.toHaveBeenCalled();

      // Case B: genuine later edit — fires with the unified contract
      mockEventsList.mockResolvedValueOnce({
        data: {
          items: [
            {
              ...baseEvent,
              created: '2026-10-21T08:00:00.000Z',
              updated: '2026-10-21T09:30:00.000Z',
              summary: 'Design review (moved)',
            },
          ],
        },
      });
      const updatedResult = await poller.poll();
      expect(updatedResult.processed).toBe(1);
      const { metadata, dedup } = (enqueueRun as jest.Mock).mock.calls[0][0];
      expect(metadata.event).toBe('updated');
      expect(metadata.trigger_type).toBe('event_updated');
      expect(metadata.summary).toBe('Design review (moved)');
      expect(metadata.updatedAt).toBe('2026-10-21T09:30:00.000Z');
      expect(dedup.key).toContain('cal:updated:');
      expect(dedup.key).toContain(':2026-10-21T09:30:00.000Z');
    });

    it('does not re-fire the same update version on a later poll (watermark)', async () => {
      (client.googleCalendarTrigger.findMany as jest.Mock).mockResolvedValue([
        baseTrigger({ triggerType: 'event_updated' }),
      ]);
      mockEventsList.mockResolvedValue({
        data: {
          items: [
            {
              ...baseEvent,
              created: '2026-10-21T08:00:00.000Z',
              updated: '2026-10-21T09:30:00.000Z',
            },
          ],
        },
      });

      // First poll: redis has no watermark → fires. Second: watermark set.
      await poller.poll();
      (redis.get as jest.Mock).mockResolvedValue('1');
      const second = await poller.poll();

      expect(second.processed).toBe(0);
      expect(enqueueRun).toHaveBeenCalledTimes(1);
    });
  });

  describe('pollEventCancelled', () => {
    it('emits the unified cancellation contract via syncToken', async () => {
      (client.googleCalendarTrigger.findMany as jest.Mock).mockResolvedValue([
        baseTrigger({ triggerType: 'event_cancelled' }),
      ]);
      (redis.get as jest.Mock).mockResolvedValue('sync-token-1');
      mockEventsList.mockResolvedValue({
        data: {
          items: [
            {
              ...baseEvent,
              status: 'cancelled',
              summary: 'Design review',
            },
          ],
          nextSyncToken: 'sync-token-2',
        },
      });

      const result = await poller.poll();

      expect(result.processed).toBe(1);
      expect(mockEventsList).toHaveBeenCalledWith(
        expect.objectContaining({ syncToken: 'sync-token-1' })
      );
      const { metadata, dedup } = (enqueueRun as jest.Mock).mock.calls[0][0];
      expect(metadata).toMatchObject({
        eventId: 'evt-1',
        event: 'cancelled',
        status: 'cancelled',
        trigger_type: 'event_cancelled',
        summary: 'Design review',
      });
      expect(dedup).toEqual({
        scope: 'calendar',
        key: 'zap-1:cal:cancelled:evt-1',
      });
      expect(redis.set).toHaveBeenCalledWith('calendar:sync_token:cal-trigger-1', 'sync-token-2', {
        ex: 60 * 60 * 24 * 7,
      });
    });

    it('resets an expired syncToken (410) without failing the sweep', async () => {
      (client.googleCalendarTrigger.findMany as jest.Mock).mockResolvedValue([
        baseTrigger({ triggerType: 'event_cancelled' }),
      ]);
      (redis.get as jest.Mock).mockResolvedValue('expired-token');
      mockEventsList.mockRejectedValue({ code: 410 });

      const result = await poller.poll();
      expect(result.processed).toBe(0);
      expect(result.errors).toBe(0);
      expect(redis.del).toHaveBeenCalledWith('calendar:sync_token:cal-trigger-1');
    });
  });

  describe('pure helpers', () => {
    it('calendarInstanceKey uses recurringEventId@start for instances, raw id otherwise', () => {
      expect(
        calendarInstanceKey({ id: 'x', recurringEventId: 'r', start: { dateTime: 'T1' } })
      ).toBe('r@T1');
      expect(calendarInstanceKey({ id: 'x', start: { dateTime: 'T1' } })).toBe('x');
      expect(calendarInstanceKey({ id: 'x', start: { date: 'D1' } })).toBe('x');
    });

    it('buildCalendarRunPayload marks cancelled status defaults correctly', () => {
      const payload = buildCalendarRunPayload(
        { ...baseEvent, status: undefined } as any,
        'cancelled'
      );
      expect(payload.status).toBe('cancelled');
      expect(payload.event).toBe('cancelled');
      expect(payload.summary).toBe('Design review');
    });
  });
});
