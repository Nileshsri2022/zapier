'use client';
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import FormInput from './FormInput';
import Button from './Button';
import { API_URL } from '@/lib/config';

interface TelegramBot {
  id: string;
  botName: string;
  botUsername: string;
  webhookConfigured: boolean;
  isActive: boolean;
  createdAt: string;
  triggers: any[];
}

const TelegramBotConfig = () => {
  const [bots, setBots] = useState<TelegramBot[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({
    botName: '',
    botToken: '',
  });

  const fetchBots = async () => {
    try {
      setIsLoading(true);
      // Cookie auth - no token needed
      if (!token) {
        toast.error('No authentication token found');
        return;
      }

      const response = await axios.get(`${API_URL}/api/telegram/bots`, {
        withCredentials: true,
      });

      setBots(response.data.bots || []);
    } catch (error: any) {
      toast.error(
        'Failed to fetch Telegram bots: ' + (error.response?.data?.message || error.message)
      );
    } finally {
      setIsLoading(false);
    }
  };

  const createBot = async () => {
    if (!formData.botName.trim() || !formData.botToken.trim()) {
      toast.error('Please fill in all required fields');
      return;
    }

    try {
      // Cookie auth - no token needed
      if (!token) {
        toast.error('No authentication token found');
        return;
      }

      await axios.post(`${API_URL}/api/telegram/bots`, formData, {
        withCredentials: true,
      });

      toast.success('Telegram bot connected successfully!');
      setShowAddForm(false);
      setFormData({ botName: '', botToken: '' });
      fetchBots();
    } catch (error: any) {
      toast.error('Failed to connect bot: ' + (error.response?.data?.message || error.message));
    }
  };

  const testConnection = async (botId: string) => {
    try {
      // Cookie auth - no token needed
      if (!token) return;

      const response = await axios.post(
        `${API_URL}/api/telegram/bots/${botId}/test`,
        {},
        {
          withCredentials: true,
        }
      );

      toast.success(`Connected to @${response.data.botInfo.username}!`);
    } catch (error: any) {
      toast.error('Connection test failed: ' + (error.response?.data?.message || error.message));
    }
  };

  const deleteBot = async (botId: string) => {
    if (!confirm('Are you sure you want to disconnect this bot?')) return;

    try {
      // Cookie auth - no token needed
      if (!token) return;

      await axios.delete(`${API_URL}/api/telegram/bots/${botId}`, {
        withCredentials: true,
      });

      toast.success('Bot disconnected successfully');
      fetchBots();
    } catch (error: any) {
      toast.error('Failed to disconnect bot: ' + (error.response?.data?.message || error.message));
    }
  };

  const toggleStatus = async (botId: string, isActive: boolean) => {
    try {
      // Cookie auth - no token needed
      if (!token) return;

      await axios.put(
        `${API_URL}/api/telegram/bots/${botId}`,
        { isActive: !isActive },
        {
          withCredentials: true,
        }
      );

      toast.success(`Bot ${!isActive ? 'enabled' : 'disabled'} successfully`);
      fetchBots();
    } catch (error: any) {
      toast.error('Failed to update bot: ' + (error.response?.data?.message || error.message));
    }
  };

  useEffect(() => {
    fetchBots();
  }, []);

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Telegram Bots</h2>
        <Button variant="primary" onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? 'Cancel' : 'Add Telegram Bot'}
        </Button>
      </div>

      {showAddForm && (
        <div className="bg-white p-6 rounded-lg shadow-md mb-6">
          <h3 className="text-lg font-semibold mb-4">Connect Telegram Bot</h3>
          <div className="grid gap-4">
            <FormInput
              label="Bot Display Name *"
              name="botName"
              placeholder="My Zapier Bot"
              value={formData.botName}
              onChange={(e) => setFormData({ ...formData, botName: e.target.value })}
            />
            <FormInput
              label="Bot Token * (from @BotFather)"
              name="botToken"
              placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
              type="password"
              value={formData.botToken}
              onChange={(e) => setFormData({ ...formData, botToken: e.target.value })}
            />
            <div className="flex gap-2">
              <Button variant="primary" onClick={createBot}>
                Connect Bot
              </Button>
            </div>
          </div>
          <div className="mt-4 p-4 bg-blue-50 rounded-lg">
            <h4 className="font-semibold text-blue-800 mb-2">🤖 How to get a Bot Token:</h4>
            <ol className="text-sm text-blue-700 list-decimal list-inside space-y-1">
              <li>
                Open Telegram and search for <strong>@BotFather</strong>
              </li>
              <li>
                Send <code>/newbot</code>
              </li>
              <li>Choose a name for your bot</li>
              <li>Choose a username (must end with 'bot')</li>
              <li>Copy the token BotFather gives you</li>
            </ol>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-2 text-gray-600">Loading Telegram bots...</p>
        </div>
      ) : bots.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <p>No Telegram bots connected yet.</p>
          <p className="text-sm mt-2">Connect a Telegram bot to start creating automations.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {bots.map((bot) => (
            <div key={bot.id} className="bg-white p-6 rounded-lg shadow-md">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <span className="text-blue-500">🤖</span>
                    {bot.botName}
                  </h3>
                  <p className="text-sm text-gray-600">@{bot.botUsername}</p>
                  <p className="text-sm text-gray-600">
                    Created: {new Date(bot.createdAt).toLocaleDateString()}
                  </p>
                  <p className="text-sm text-gray-600">Triggers: {bot.triggers?.length || 0}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-1 text-xs rounded-full ${
                      bot.webhookConfigured
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-yellow-100 text-yellow-800'
                    }`}
                  >
                    {bot.webhookConfigured ? 'Webhook ✓' : 'Webhook Pending'}
                  </span>
                  <span
                    className={`px-2 py-1 text-xs rounded-full ${
                      bot.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {bot.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" size="md" onClick={() => testConnection(bot.id)}>
                  Test Connection
                </Button>
                <Button
                  variant={bot.isActive ? 'secondary' : 'primary'}
                  size="md"
                  onClick={() => toggleStatus(bot.id, bot.isActive)}
                >
                  {bot.isActive ? 'Disable' : 'Enable'}
                </Button>
                <Button variant="link" size="md" onClick={() => deleteBot(bot.id)}>
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TelegramBotConfig;
