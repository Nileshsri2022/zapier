'use client';
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import Button from './Button';
import { API_URL } from '@/lib/config';

interface TelegramBot {
  id: string;
  botName: string;
  botUsername: string;
}

interface TelegramTrigger {
  id: string;
  eventType: string;
  filterCommand: string | null;
  isActive: boolean;
  lastProcessedAt: string | null;
  bot: TelegramBot;
  zap?: {
    id: string;
    name: string;
  };
}

interface Props {
  zapId?: string;
  onTriggerCreated?: (trigger: any) => void;
}

const TelegramTriggerConfig = ({ zapId, onTriggerCreated }: Props) => {
  const [bots, setBots] = useState<TelegramBot[]>([]);
  const [triggers, setTriggers] = useState<TelegramTrigger[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedBot, setSelectedBot] = useState('');
  const [eventType, setEventType] = useState('message');
  const [filterCommand, setFilterCommand] = useState('');

  const eventTypes = [
    { value: 'message', label: 'Any Message', description: 'Trigger when any message is received' },
    { value: 'command', label: 'Command Only', description: 'Trigger only for specific /command' },
  ];

  const fetchBots = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      const response = await axios.get(`${API_URL}/api/telegram/bots`, {
        headers: { Authorization: token },
      });

      setBots(response.data.bots || []);
    } catch (error: any) {
      toast.error('Failed to fetch Telegram bots');
    }
  };

  const fetchTriggers = async () => {
    try {
      setIsLoading(true);
      const token = localStorage.getItem('token');
      if (!token) return;

      const url = zapId
        ? `${API_URL}/api/telegram/triggers?zapId=${zapId}`
        : `${API_URL}/api/telegram/triggers`;

      const response = await axios.get(url, {
        headers: { Authorization: token },
      });

      setTriggers(response.data.triggers || []);
    } catch (error: any) {
      toast.error('Failed to fetch triggers');
    } finally {
      setIsLoading(false);
    }
  };

  const createTrigger = async () => {
    if (!selectedBot) {
      toast.error('Please select a Telegram bot');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      const response = await axios.post(
        `${API_URL}/api/telegram/triggers`,
        {
          botId: selectedBot,
          zapId: zapId,
          eventType: eventType,
          filterCommand: eventType === 'command' ? filterCommand : null,
        },
        {
          headers: { Authorization: token },
        }
      );

      toast.success('Telegram trigger created!');
      setShowCreateForm(false);
      setSelectedBot('');
      setFilterCommand('');
      fetchTriggers();

      if (onTriggerCreated) {
        onTriggerCreated(response.data.trigger);
      }
    } catch (error: any) {
      toast.error('Failed to create trigger: ' + (error.response?.data?.message || error.message));
    }
  };

  const deleteTrigger = async (triggerId: string) => {
    if (!confirm('Delete this Telegram trigger?')) return;

    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      await axios.delete(`${API_URL}/api/telegram/triggers/${triggerId}`, {
        headers: { Authorization: token },
      });

      toast.success('Trigger deleted');
      fetchTriggers();
    } catch (error: any) {
      toast.error('Failed to delete trigger');
    }
  };

  useEffect(() => {
    fetchBots();
    fetchTriggers();
  }, [zapId]);

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold text-gray-800">Telegram Triggers</h2>
        <Button variant="primary" onClick={() => setShowCreateForm(!showCreateForm)}>
          {showCreateForm ? 'Cancel' : 'New Trigger'}
        </Button>
      </div>

      {showCreateForm && (
        <div className="bg-white p-6 rounded-lg shadow-md mb-6">
          <h3 className="text-lg font-semibold mb-4">Create Telegram Trigger</h3>

          {bots.length === 0 ? (
            <div className="text-center py-4 text-gray-500">
              <p>No Telegram bots connected.</p>
              <p className="text-sm mt-1">Connect a bot first via @BotFather.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Telegram Bot</label>
                <select
                  value={selectedBot}
                  onChange={(e) => setSelectedBot(e.target.value)}
                  className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select bot...</option>
                  {bots.map((bot) => (
                    <option key={bot.id} value={bot.id}>
                      {bot.botName} (@{bot.botUsername})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Event Type</label>
                <select
                  value={eventType}
                  onChange={(e) => setEventType(e.target.value)}
                  className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  {eventTypes.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
                <p className="text-sm text-gray-500 mt-1">
                  {eventTypes.find((t) => t.value === eventType)?.description}
                </p>
              </div>

              {eventType === 'command' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Command Filter
                  </label>
                  <input
                    type="text"
                    value={filterCommand}
                    onChange={(e) => setFilterCommand(e.target.value)}
                    placeholder="/start or /help"
                    className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-sm text-gray-500 mt-1">
                    Only trigger when this specific command is sent
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

      {isLoading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
        </div>
      ) : triggers.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <p>No Telegram triggers configured.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {triggers.map((trigger) => (
            <div key={trigger.id} className="bg-white p-4 rounded-lg shadow-md">
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-semibold flex items-center gap-2">
                    <span className="text-blue-500">🤖</span>
                    {eventTypes.find((t) => t.value === trigger.eventType)?.label ||
                      trigger.eventType}
                    {trigger.filterCommand && (
                      <span className="text-sm font-normal text-gray-500">
                        ({trigger.filterCommand})
                      </span>
                    )}
                  </h4>
                  <p className="text-sm text-gray-600">Bot: @{trigger.bot?.botUsername}</p>
                  {trigger.zap && <p className="text-sm text-gray-600">Zap: {trigger.zap.name}</p>}
                  {trigger.lastProcessedAt && (
                    <p className="text-sm text-gray-500">
                      Last triggered: {new Date(trigger.lastProcessedAt).toLocaleString()}
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

export default TelegramTriggerConfig;
