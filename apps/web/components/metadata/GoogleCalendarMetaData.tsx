'use client';
import { useState, useEffect } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import Button from '../Button';
import { API_URL } from '@/lib/config';
import { redirectToOAuth } from '@/lib/oauth';

interface GoogleCalendarMetaDataProps {
  handleClick: (data: any) => void;
  selectedType: string;
  preSelectedServerId?: string;
}

const GoogleCalendarMetaData = ({
  handleClick,
  selectedType,
  preSelectedServerId,
}: GoogleCalendarMetaDataProps) => {
  const [formData, setFormData] = useState({
    calendarId: 'primary',
    serverId: preSelectedServerId || '',
    reminderMinutes: 15,
    searchQuery: '',
  });
  const [servers, setServers] = useState<any[]>([]);
  const [calendars, setCalendars] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [loadingCalendars, setLoadingCalendars] = useState(false);

  useEffect(() => {
    const fetchServers = async () => {
      try {
        const response = await axios.get(`${API_URL}/api/calendar/servers`, {
          withCredentials: true,
        });

        const connectedServers = response?.data?.servers || [];
        setServers(connectedServers);

        if (preSelectedServerId) {
          setFormData((prev) => ({ ...prev, serverId: preSelectedServerId }));
        } else if (connectedServers.length > 0) {
          setFormData((prev) => ({ ...prev, serverId: connectedServers[0].id }));
        }
      } catch (error) {
        console.error('Failed to fetch Google Calendar servers:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchServers();
  }, [preSelectedServerId]);

  // Fetch calendars when server is selected
  useEffect(() => {
    const fetchCalendars = async () => {
      if (!formData.serverId) return;

      setLoadingCalendars(true);
      try {
        const response = await axios.get(
          `${API_URL}/api/calendar/calendars?serverId=${formData.serverId}`,
          { withCredentials: true }
        );

        setCalendars(response?.data?.calendars || []);
      } catch (error) {
        console.error('Failed to fetch calendars:', error);
      } finally {
        setLoadingCalendars(false);
      }
    };

    fetchCalendars();
  }, [formData.serverId]);

  const handleConnectGoogle = async () => {
    try {
      setConnecting(true);

      localStorage.setItem('calendar_oauth_pending', 'true');

      const response = await axios.get(`${API_URL}/api/calendar/auth/initiate`, {
        withCredentials: true,
      });

      if (response?.data?.authUrl) {
        redirectToOAuth(response.data.authUrl);
      } else {
        toast.error('Failed to get OAuth URL');
      }
    } catch (error: any) {
      console.error('OAuth error:', error);
      toast.error(error?.response?.data?.error || 'Failed to connect Google');
    } finally {
      setConnecting(false);
    }
  };

  const handleFormDataChange = (e: any) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  // Determine trigger type from selectedType
  const getTriggerType = () => {
    if (selectedType.includes('New Event')) return 'new_event';
    if (selectedType.includes('Event Updated')) return 'event_updated';
    if (selectedType.includes('Event Start')) return 'event_start';
    if (selectedType.includes('Event Ended')) return 'event_ended';
    if (selectedType.includes('Event Cancelled')) return 'event_cancelled';
    if (selectedType.includes('New Calendar')) return 'new_calendar';
    if (selectedType.includes('Matching Search')) return 'event_matching_search';
    return 'new_event';
  };

  const triggerType = getTriggerType();
  const showReminderMinutes = triggerType === 'event_start';
  const showSearchQuery = triggerType === 'event_matching_search';

  if (loading) {
    return (
      <div className="my-4 flex flex-col gap-4 text-secondary-500">
        <p className="text-sm">Loading...</p>
      </div>
    );
  }

  if (servers.length === 0) {
    return (
      <div className="my-4 flex flex-col gap-4 text-secondary-500">
        <div className="bg-yellow-50 border border-yellow-200 rounded p-4 text-sm text-yellow-700">
          <p className="font-medium">📅 Connect Google Calendar</p>
          <p className="mt-1 text-xs">
            You need to connect your Google account to use Google Calendar triggers.
          </p>
        </div>
        <Button variant="secondary" onClick={connecting ? () => {} : handleConnectGoogle}>
          {connecting ? 'Connecting...' : '🔗 Connect Google Account'}
        </Button>
      </div>
    );
  }

  return (
    <div className="my-4 flex flex-col gap-4 text-secondary-500">
      {servers.length > 1 && (
        <div>
          <label className="block text-sm font-medium mb-1">Google Account</label>
          <select
            name="serverId"
            value={formData.serverId}
            onChange={handleFormDataChange}
            className="w-full p-2 border rounded text-sm"
          >
            {servers.map((server: any) => (
              <option key={server.id} value={server.id}>
                {server.email}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium mb-1">Calendar</label>
        {loadingCalendars ? (
          <p className="text-xs text-gray-500">Loading calendars...</p>
        ) : (
          <select
            name="calendarId"
            value={formData.calendarId}
            onChange={handleFormDataChange}
            className="w-full p-2 border rounded text-sm"
          >
            <option value="primary">Primary Calendar</option>
            {calendars.map((cal: any) => (
              <option key={cal.id} value={cal.id}>
                {cal.summary || cal.id}
              </option>
            ))}
          </select>
        )}
      </div>

      {showReminderMinutes && (
        <div>
          <label className="block text-sm font-medium mb-1">Reminder (minutes before)</label>
          <input
            type="number"
            name="reminderMinutes"
            value={formData.reminderMinutes}
            onChange={handleFormDataChange}
            min={1}
            max={1440}
            className="w-full p-2 border rounded text-sm"
          />
          <p className="text-xs text-gray-500 mt-1">
            Trigger will fire this many minutes before the event starts
          </p>
        </div>
      )}

      {showSearchQuery && (
        <div>
          <label className="block text-sm font-medium mb-1">Search Query</label>
          <input
            type="text"
            name="searchQuery"
            value={formData.searchQuery}
            onChange={handleFormDataChange}
            placeholder="e.g. meeting, standup, sync"
            className="w-full p-2 border rounded text-sm"
          />
          <p className="text-xs text-gray-500 mt-1">
            Trigger fires for events matching this search term
          </p>
        </div>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-700">
        <p className="font-medium">📅 {selectedType}</p>
        <p className="mt-1 text-xs">
          {triggerType === 'new_event' && 'Fires when a new event is created in your calendar.'}
          {triggerType === 'event_updated' && 'Fires when an existing event is modified.'}
          {triggerType === 'event_start' && 'Fires before an event starts (reminder style).'}
          {triggerType === 'event_ended' && 'Fires after an event ends.'}
          {triggerType === 'event_cancelled' && 'Fires when an event is cancelled or deleted.'}
          {triggerType === 'new_calendar' && 'Fires when a new calendar is added to your account.'}
          {triggerType === 'event_matching_search' &&
            'Fires for events matching your search query.'}
        </p>
      </div>

      <Button variant="secondary" onClick={() => handleClick({ ...formData, triggerType })}>
        Save
      </Button>
    </div>
  );
};

export default GoogleCalendarMetaData;
