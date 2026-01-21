'use client';
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import Button from './Button';
import { API_URL } from '@/lib/config';

interface GoogleCalendarServer {
  id: string;
  email: string;
  isActive: boolean;
  _count?: { triggers: number };
}

interface Calendar {
  id: string;
  summary: string;
  primary?: boolean;
}

interface TriggerType {
  value: string;
  label: string;
  isInstant: boolean;
  description: string;
}

interface GoogleCalendarTrigger {
  id: string;
  calendarId: string;
  triggerType: string;
  isInstant: boolean;
  searchQuery: string | null;
  reminderMinutes: number | null;
  isActive: boolean;
  lastPolledAt: string | null;
  server: { id: string; email: string };
  zap?: { id: string; name: string };
}

interface Props {
  zapId?: string;
  onTriggerCreated?: (trigger: any) => void;
}

const GoogleCalendarTriggerConfig = ({ zapId, onTriggerCreated }: Props) => {
  const [servers, setServers] = useState<GoogleCalendarServer[]>([]);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [triggerTypes, setTriggerTypes] = useState<TriggerType[]>([]);
  const [triggers, setTriggers] = useState<GoogleCalendarTrigger[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Form state
  const [selectedServer, setSelectedServer] = useState('');
  const [selectedCalendar, setSelectedCalendar] = useState('primary');
  const [selectedTriggerType, setSelectedTriggerType] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [reminderMinutes, setReminderMinutes] = useState(15);

  // Fetch connected Google Calendar accounts
  const fetchServers = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/calendar/servers`, {
        withCredentials: true,
      });
      setServers(response.data.servers || []);
    } catch (error: any) {
      // Silent fail - user may not have connected yet
    }
  };

  // Fetch calendars for selected server
  const fetchCalendars = async (serverId: string) => {
    try {
      if (!serverId) return;

      const response = await axios.get(`${API_URL}/api/calendar/calendars?serverId=${serverId}`, {
        withCredentials: true,
      });
      setCalendars(response.data.calendars || []);
    } catch (error: any) {
      toast.error('Failed to fetch calendars');
    }
  };

  // Fetch available trigger types
  const fetchTriggerTypes = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/calendar/trigger-types`, {
        withCredentials: true,
      });
      setTriggerTypes(response.data.types || []);
    } catch (error: any) {
      // Use defaults if API fails
      setTriggerTypes([
        {
          value: 'new_event',
          label: 'New Event',
          isInstant: true,
          description: 'Triggers when a new event is created',
        },
        {
          value: 'event_updated',
          label: 'New or Updated Event',
          isInstant: true,
          description: 'Triggers when an event is created or updated',
        },
        {
          value: 'event_start',
          label: 'Event Start',
          isInstant: false,
          description: 'Triggers X minutes before an event starts',
        },
        {
          value: 'event_ended',
          label: 'Event Ended',
          isInstant: false,
          description: 'Triggers when an event ends',
        },
        {
          value: 'event_cancelled',
          label: 'Event Cancelled',
          isInstant: false,
          description: 'Triggers when an event is cancelled',
        },
        {
          value: 'new_calendar',
          label: 'New Calendar',
          isInstant: false,
          description: 'Triggers when a new calendar is created',
        },
        {
          value: 'event_matching_search',
          label: 'New Event Matching Search',
          isInstant: false,
          description: 'Triggers for events matching search criteria',
        },
      ]);
    }
  };

  // Fetch existing triggers
  const fetchTriggers = async () => {
    try {
      setIsLoading(true);

      const url = zapId
        ? `${API_URL}/api/calendar/triggers?zapId=${zapId}`
        : `${API_URL}/api/calendar/triggers`;

      const response = await axios.get(url, {
        withCredentials: true,
      });
      setTriggers(response.data.triggers || []);
    } catch (error: any) {
      toast.error('Failed to fetch triggers');
    } finally {
      setIsLoading(false);
    }
  };

  // Connect new Google Calendar account
  const connectGoogleCalendar = async () => {
    try {
      setIsConnecting(true);

      const response = await axios.get(`${API_URL}/api/calendar/auth/initiate`, {
        withCredentials: true,
      });

      if (response.data.authUrl) {
        window.open(response.data.authUrl, '_blank');
        toast.info('Complete OAuth in the new window, then refresh this page');
      }
    } catch (error: any) {
      toast.error('Failed to initiate Google OAuth');
    } finally {
      setIsConnecting(false);
    }
  };

  // Create trigger
  const createTrigger = async () => {
    if (!selectedServer) {
      toast.error('Please select a Google Calendar account');
      return;
    }
    if (!selectedTriggerType) {
      toast.error('Please select a trigger type');
      return;
    }
    if (selectedTriggerType === 'event_matching_search' && !searchQuery) {
      toast.error('Please enter a search query');
      return;
    }

    try {
      const response = await axios.post(
        `${API_URL}/api/calendar/triggers`,
        {
          serverId: selectedServer,
          zapId: zapId,
          calendarId: selectedCalendar,
          triggerType: selectedTriggerType,
          searchQuery: selectedTriggerType === 'event_matching_search' ? searchQuery : undefined,
          reminderMinutes: selectedTriggerType === 'event_start' ? reminderMinutes : undefined,
        },
        {
          withCredentials: true,
        }
      );

      toast.success('Google Calendar trigger created!');
      setShowCreateForm(false);
      resetForm();
      fetchTriggers();

      if (onTriggerCreated) {
        onTriggerCreated(response.data.trigger);
      }
    } catch (error: any) {
      toast.error('Failed to create trigger: ' + (error.response?.data?.message || error.message));
    }
  };

  // Delete trigger
  const deleteTrigger = async (triggerId: string) => {
    if (!confirm('Delete this Google Calendar trigger?')) return;

    try {
      await axios.delete(`${API_URL}/api/calendar/triggers/${triggerId}`, {
        withCredentials: true,
      });

      toast.success('Trigger deleted');
      fetchTriggers();
    } catch (error: any) {
      toast.error('Failed to delete trigger');
    }
  };

  const resetForm = () => {
    setSelectedServer('');
    setSelectedCalendar('primary');
    setSelectedTriggerType('');
    setSearchQuery('');
    setReminderMinutes(15);
    setCalendars([]);
  };

  // Fetch calendars when server changes
  useEffect(() => {
    if (selectedServer) {
      fetchCalendars(selectedServer);
    } else {
      setCalendars([]);
    }
  }, [selectedServer]);

  useEffect(() => {
    fetchServers();
    fetchTriggerTypes();
    fetchTriggers();
  }, [zapId]);

  const selectedTriggerTypeInfo = triggerTypes.find((t) => t.value === selectedTriggerType);

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold text-gray-800">📅 Google Calendar Triggers</h2>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={connectGoogleCalendar} disabled={isConnecting}>
            {isConnecting ? 'Connecting...' : 'Connect Account'}
          </Button>
          <Button variant="primary" onClick={() => setShowCreateForm(!showCreateForm)}>
            {showCreateForm ? 'Cancel' : 'New Trigger'}
          </Button>
        </div>
      </div>

      {/* Create Form */}
      {showCreateForm && (
        <div className="bg-white p-6 rounded-lg shadow-md mb-6">
          <h3 className="text-lg font-semibold mb-4">Create Google Calendar Trigger</h3>

          {servers.length === 0 ? (
            <div className="text-center py-4 text-gray-500">
              <p>No Google Calendar accounts connected.</p>
              <p className="text-sm mt-1">Click "Connect Account" to add one.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Server Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Google Account
                </label>
                <select
                  value={selectedServer}
                  onChange={(e) => setSelectedServer(e.target.value)}
                  className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select account...</option>
                  {servers.map((server) => (
                    <option key={server.id} value={server.id}>
                      {server.email}
                    </option>
                  ))}
                </select>
              </div>

              {/* Calendar Selection */}
              {selectedServer && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Calendar</label>
                  <select
                    value={selectedCalendar}
                    onChange={(e) => setSelectedCalendar(e.target.value)}
                    className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="primary">Primary Calendar</option>
                    {calendars.map((cal) => (
                      <option key={cal.id} value={cal.id}>
                        {cal.summary} {cal.primary ? '(Primary)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Trigger Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Trigger Type</label>
                <select
                  value={selectedTriggerType}
                  onChange={(e) => setSelectedTriggerType(e.target.value)}
                  className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select trigger type...</option>
                  {triggerTypes.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label} {type.isInstant ? '⚡' : '⏱️'}
                    </option>
                  ))}
                </select>
                {selectedTriggerTypeInfo && (
                  <p className="text-sm text-gray-500 mt-1">
                    {selectedTriggerTypeInfo.description}
                    {selectedTriggerTypeInfo.isInstant && (
                      <span className="ml-2 text-green-600">(Real-time)</span>
                    )}
                  </p>
                )}
              </div>

              {/* Event Start - Reminder Minutes */}
              {selectedTriggerType === 'event_start' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Minutes Before Event
                  </label>
                  <input
                    type="number"
                    value={reminderMinutes}
                    onChange={(e) => setReminderMinutes(parseInt(e.target.value) || 15)}
                    min={1}
                    max={1440}
                    className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-sm text-gray-500 mt-1">
                    Trigger this many minutes before the event starts
                  </p>
                </div>
              )}

              {/* Event Matching Search - Query */}
              {selectedTriggerType === 'event_matching_search' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Search Query
                  </label>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="e.g., meeting, standup, interview"
                    className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-sm text-gray-500 mt-1">
                    Only trigger for events containing this text in title or description
                  </p>
                </div>
              )}

              <Button variant="primary" onClick={createTrigger}>
                Create Trigger
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Triggers List */}
      {isLoading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
        </div>
      ) : triggers.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <p>No Google Calendar triggers configured.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {triggers.map((trigger) => (
            <div key={trigger.id} className="bg-white p-4 rounded-lg shadow-md">
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-semibold flex items-center gap-2">
                    <span>{trigger.isInstant ? '⚡' : '⏱️'}</span>
                    {triggerTypes.find((t) => t.value === trigger.triggerType)?.label ||
                      trigger.triggerType}
                    {trigger.reminderMinutes && (
                      <span className="text-sm font-normal text-gray-500">
                        ({trigger.reminderMinutes} min before)
                      </span>
                    )}
                  </h4>
                  <p className="text-sm text-gray-600">Account: {trigger.server?.email}</p>
                  <p className="text-sm text-gray-600">
                    Calendar: {trigger.calendarId === 'primary' ? 'Primary' : trigger.calendarId}
                  </p>
                  {trigger.searchQuery && (
                    <p className="text-sm text-gray-600">Search: "{trigger.searchQuery}"</p>
                  )}
                  {trigger.zap && <p className="text-sm text-gray-600">Zap: {trigger.zap.name}</p>}
                  {trigger.lastPolledAt && !trigger.isInstant && (
                    <p className="text-sm text-gray-500">
                      Last polled: {new Date(trigger.lastPolledAt).toLocaleString()}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-1 text-xs rounded-full ${
                      trigger.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {trigger.isActive ? 'Active' : 'Inactive'}
                  </span>
                  <span
                    className={`px-2 py-1 text-xs rounded-full ${
                      trigger.isInstant
                        ? 'bg-purple-100 text-purple-800'
                        : 'bg-blue-100 text-blue-800'
                    }`}
                  >
                    {trigger.isInstant ? 'Instant' : 'Polling'}
                  </span>
                  <Button variant="link" size="md" onClick={() => deleteTrigger(trigger.id)}>
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default GoogleCalendarTriggerConfig;
