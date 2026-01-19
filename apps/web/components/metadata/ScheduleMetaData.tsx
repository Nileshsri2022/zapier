'use client';
import { useState } from 'react';
import Button from '../Button';

interface ScheduleMetaDataProps {
  handleClick: (data: any) => void;
  scheduleType?: string;
}

const ScheduleMetaData = ({ handleClick, scheduleType = 'daily' }: ScheduleMetaDataProps) => {
  const [formData, setFormData] = useState<{
    scheduleType: string;
    hour: number;
    minute: number;
    dayOfWeek?: number;
    dayOfMonth?: number;
    timezone: string;
  }>({
    scheduleType: scheduleType,
    hour: 9,
    minute: 0,
    dayOfWeek: 1, // Monday
    dayOfMonth: 1,
    timezone: 'UTC',
  });

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
    const { hour, minute, dayOfWeek, dayOfMonth, scheduleType } = formData;
    const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;

    switch (scheduleType) {
      case 'everyhour':
        return `Runs every hour at minute :${minute.toString().padStart(2, '0')}`;
      case 'everyday':
        return `Runs every day at ${timeStr}`;
      case 'everyweek':
        return `Runs every ${daysOfWeek.find((d) => d.value === dayOfWeek)?.label} at ${timeStr}`;
      case 'everymonth':
        return `Runs on day ${dayOfMonth} of each month at ${timeStr}`;
      default:
        return 'Schedule configured';
    }
  };

  return (
    <div className="my-4 flex flex-col gap-4 text-secondary-500">
      <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
        <p className="font-medium text-purple-800 flex items-center gap-2">
          <span>📅</span> Schedule: {scheduleType.replace('every', 'Every ')}
        </p>
        <p className="text-sm text-purple-600 mt-1">{getScheduleDescription()}</p>
      </div>

      {/* Time Picker (for daily, weekly, monthly) */}
      {scheduleType !== 'everyhour' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Hour</label>
            <select
              name="hour"
              value={formData.hour}
              onChange={handleChange}
              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
            >
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={i}>
                  {i.toString().padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Minute</label>
            <select
              name="minute"
              value={formData.minute}
              onChange={handleChange}
              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
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
          <label className="block text-sm font-medium mb-1">Run at minute</label>
          <select
            name="minute"
            value={formData.minute}
            onChange={handleChange}
            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
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
          <label className="block text-sm font-medium mb-1">Day of Week</label>
          <select
            name="dayOfWeek"
            value={formData.dayOfWeek}
            onChange={handleChange}
            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
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
          <label className="block text-sm font-medium mb-1">Day of Month</label>
          <select
            name="dayOfMonth"
            value={formData.dayOfMonth}
            onChange={handleChange}
            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
          >
            {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
              <option key={day} value={day}>
                {day}
                {day === 1 ? 'st' : day === 2 ? 'nd' : day === 3 ? 'rd' : 'th'}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-1">Limited to 1-28 for all months</p>
        </div>
      )}

      {/* Timezone */}
      <div>
        <label className="block text-sm font-medium mb-1">Timezone</label>
        <select
          name="timezone"
          value={formData.timezone}
          onChange={handleChange}
          className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
        >
          <option value="UTC">UTC</option>
          <option value="Asia/Kolkata">India (IST)</option>
          <option value="America/New_York">Eastern (US)</option>
          <option value="America/Los_Angeles">Pacific (US)</option>
          <option value="Europe/London">London (UK)</option>
          <option value="Europe/Paris">Paris (EU)</option>
        </select>
      </div>

      <Button variant="secondary" onClick={() => handleClick(formData)}>
        Save Schedule
      </Button>
    </div>
  );
};

export default ScheduleMetaData;
