'use client';
import { useEffect, useState } from 'react';
import { API_URL } from '@/lib/config';
import Button from '../Button';

interface ScheduleMetaDataProps {
  handleClick: (data: any) => void;
  scheduleType?: string;
}

/** Q-SCHED-02: timezone defaults to the user's browser timezone. */
const browserTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

const ScheduleMetaData = ({ handleClick, scheduleType = 'daily' }: ScheduleMetaDataProps) => {
  const [formData, setFormData] = useState<{
    scheduleType: string;
    hour: number;
    minute: number;
    dayOfWeek?: number;
    dayOfMonth?: number;
    timezone: string;
    cron?: string;
  }>({
    scheduleType: scheduleType,
    hour: 9,
    minute: 0,
    dayOfWeek: 1, // Monday
    dayOfMonth: 1,
    timezone: browserTimezone(),
    cron: '',
  });
  const [previewFires, setPreviewFires] = useState<string[]>([]);
  const [cronError, setCronError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const isCron = scheduleType === 'customcron';

  // M5 — next-fires preview before save (validated server-side).
  useEffect(() => {
    if (!isCron) return;
    const expr = (formData.cron || '').trim();
    if (!expr) {
      setPreviewFires([]);
      setCronError(null);
      return;
    }
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        setPreviewLoading(true);
        const res = await fetch(`${API_URL}/api/schedule/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scheduleType: 'cron',
            cron: expr,
            timezone: formData.timezone,
            count: 5,
          }),
          signal: controller.signal,
        });
        const data = await res.json();
        if (!res.ok) {
          setCronError(data.error || 'Invalid cron expression');
          setPreviewFires([]);
        } else {
          setCronError(null);
          setPreviewFires((data.fires || []).map((f: any) => f.local));
        }
      } catch (e) {
        if ((e as any)?.name !== 'AbortError')
          setCronError('Preview failed — check the expression');
      } finally {
        setPreviewLoading(false);
      }
    }, 350);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [isCron, formData.cron, formData.timezone]);

  const daysOfWeek = [
    { value: 0, label: 'Sunday' },
    { value: 1, label: 'Monday' },
    { value: 2, label: 'Tuesday' },
    { value: 3, label: 'Wednesday' },
    { value: 4, label: 'Thursday' },
    { value: 5, label: 'Friday' },
    { value: 6, label: 'Saturday' },
  ];

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]:
        name === 'hour' || name === 'minute' || name === 'dayOfWeek' || name === 'dayOfMonth'
          ? parseInt(value, 10)
          : value,
    }));
  };

  const getScheduleDescription = () => {
    const { hour, minute, dayOfWeek, dayOfMonth, scheduleType: t, cron } = formData;
    const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;

    switch (t) {
      case 'everyminute':
        return 'Runs every minute';
      case 'everyhour':
        return `Runs every hour at minute :${minute.toString().padStart(2, '0')}`;
      case 'everyday':
        return `Runs every day at ${timeStr}`;
      case 'everyweek':
        return `Runs every ${daysOfWeek.find((d) => d.value === dayOfWeek)?.label} at ${timeStr}`;
      case 'everymonth':
        return `Runs on day ${dayOfMonth} of each month at ${timeStr}`;
      case 'customcron':
        return cron ? `Custom cron: ${cron}` : 'Enter a 5-field cron expression';
      default:
        return 'Schedule configured';
    }
  };

  return (
    <div className="meta-form">
      <div className="meta-form__summary">
        <p className="meta-form__summary-title">
          <span>📅</span> Schedule:{' '}
          {isCron ? 'Custom Cron' : scheduleType.replace('every', 'Every ')}
        </p>
        <p className="meta-form__summary-note">{getScheduleDescription()}</p>
      </div>

      {/* M5 — custom 5-field cron */}
      {isCron && (
        <div>
          <label className="meta-form__label">
            Cron expression (5 fields: min hour dom month dow)
          </label>
          <input
            type="text"
            name="cron"
            value={formData.cron || ''}
            onChange={handleChange}
            placeholder="e.g. */15 9-17 * * 1-5"
            className="meta-form__input"
          />
          {cronError && <p className="meta-form__hint-warning">{cronError}</p>}
          {previewFires.length > 0 && (
            <div className="meta-form__panel">
              <h4 className="meta-form__panel-title">Next fires ({formData.timezone})</h4>
              <ol style={{ margin: 0, paddingLeft: '1.2rem' }}>
                {previewFires.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ol>
            </div>
          )}
          {previewLoading && <p className="meta-form__hint">Computing preview…</p>}
        </div>
      )}

      {/* Time Picker (for daily, weekly, monthly - NOT for everyminute/everyhour/cron) */}
      {!isCron && scheduleType !== 'everyhour' && scheduleType !== 'everyminute' && (
        <div className="meta-form__grid">
          <div>
            <label className="meta-form__label">Hour</label>
            <select
              name="hour"
              value={formData.hour}
              onChange={handleChange}
              className="meta-form__input"
            >
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={i}>
                  {i.toString().padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="meta-form__label">Minute</label>
            <select
              name="minute"
              value={formData.minute}
              onChange={handleChange}
              className="meta-form__input"
            >
              {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                <option key={m} value={m}>
                  :{m.toString().padStart(2, '0')}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Minute only for hourly */}
      {scheduleType === 'everyhour' && (
        <div>
          <label className="meta-form__label">Run at minute</label>
          <select
            name="minute"
            value={formData.minute}
            onChange={handleChange}
            className="meta-form__input"
          >
            {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
              <option key={m} value={m}>
                :{m.toString().padStart(2, '0')} past every hour
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Day of Week (for weekly) */}
      {scheduleType === 'everyweek' && (
        <div>
          <label className="meta-form__label">Day of Week</label>
          <select
            name="dayOfWeek"
            value={formData.dayOfWeek}
            onChange={handleChange}
            className="meta-form__input"
          >
            {daysOfWeek.map((day) => (
              <option key={day.value} value={day.value}>
                {day.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Day of Month (for monthly) */}
      {scheduleType === 'everymonth' && (
        <div>
          <label className="meta-form__label">Day of Month</label>
          <select
            name="dayOfMonth"
            value={formData.dayOfMonth}
            onChange={handleChange}
            className="meta-form__input"
          >
            {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
              <option key={day} value={day}>
                {day}
                {day === 1 ? 'st' : day === 2 ? 'nd' : day === 3 ? 'rd' : 'th'}
              </option>
            ))}
          </select>
          <p className="meta-form__hint">Limited to 1-28 for all months</p>
        </div>
      )}

      {/* Timezone (not needed for everyminute) */}
      {scheduleType !== 'everyminute' && (
        <div>
          <label className="meta-form__label">Timezone</label>
          <select
            name="timezone"
            value={formData.timezone}
            onChange={handleChange}
            className="meta-form__input"
          >
            <option value="UTC">UTC</option>
            <option value="Asia/Kolkata">India (IST)</option>
            <option value="America/New_York">Eastern (US)</option>
            <option value="America/Los_Angeles">Pacific (US)</option>
            <option value="Europe/London">London (UK)</option>
            <option value="Europe/Paris">Paris (EU)</option>
          </select>
        </div>
      )}

      <Button variant="secondary" onClick={() => handleClick(formData)}>
        Save Schedule
      </Button>
    </div>
  );
};

export default ScheduleMetaData;
