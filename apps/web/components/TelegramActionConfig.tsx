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
  botToken: string;
}

interface Props {
  zapId?: string;
  onActionConfigured?: (config: any) => void;
}

const TelegramActionConfig = ({ zapId, onActionConfigured }: Props) => {
  const [bots, setBots] = useState<TelegramBot[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedBot, setSelectedBot] = useState('');
  const [formData, setFormData] = useState({
    chatId: '',
    message: '',
  });

  // Template variables that can be used in messages
  const templateVariables = [
    { key: '{firstName}', description: 'Sender first name' },
    { key: '{lastName}', description: 'Sender last name' },
    { key: '{username}', description: 'Telegram @username' },
    { key: '{text}', description: 'Message text' },
    { key: '{chatId}', description: 'Chat ID (for replies)' },
    { key: '{command}', description: 'Command if starts with /' },
    { key: '{email}', description: 'Email (from other triggers)' },
  ];

  const fetchBots = async () => {
    try {
      setIsLoading(true);
      // Cookie auth - no token needed
      if (!token) return;

      const response = await axios.get(`${API_URL}/api/telegram/bots`, {
        withCredentials: true,
      });

      setBots(response.data.bots || []);
    } catch (error: any) {
      toast.error('Failed to fetch Telegram bots');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = () => {
    if (!selectedBot) {
      toast.error('Please select a Telegram bot');
      return;
    }
    if (!formData.chatId.trim()) {
      toast.error('Please enter a chat ID or use {chatId}');
      return;
    }
    if (!formData.message.trim()) {
      toast.error('Please enter a message');
      return;
    }

    const bot = bots.find((b) => b.id === selectedBot);
    if (!bot) return;

    const actionConfig = {
      type: 'Telegram',
      metadata: {
        chatId: formData.chatId,
        message: formData.message,
        botToken: bot.botToken, // Hidden but passed
        botDisplayName: bot.botName,
      },
    };

    if (onActionConfigured) {
      onActionConfigured(actionConfig);
    }

    toast.success('Telegram action configured!');
  };

  const insertVariable = (variable: string) => {
    setFormData({
      ...formData,
      message: formData.message + variable,
    });
  };

  useEffect(() => {
    fetchBots();
  }, []);

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
        <span className="text-blue-500">🤖</span>
        Send Telegram Message
      </h2>

      {isLoading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
        </div>
      ) : bots.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <p>No Telegram bots connected.</p>
          <p className="text-sm mt-2">Connect a bot first to send messages.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Bot Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Telegram Bot *</label>
            <select
              value={selectedBot}
              onChange={(e) => setSelectedBot(e.target.value)}
              className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Select bot...</option>
              {bots.map((bot) => (
                <option key={bot.id} value={bot.id}>
                  {bot.botName} (@{bot.botUsername})
                </option>
              ))}
            </select>
          </div>

          {/* Chat ID */}
          <div>
            <FormInput
              label="Chat ID *"
              name="chatId"
              placeholder="123456789 or use {chatId} for reply"
              value={formData.chatId}
              onChange={(e) => setFormData({ ...formData, chatId: e.target.value })}
            />
            <p className="text-sm text-gray-500 mt-1">
              Use {'{chatId}'} to reply to the same chat that triggered the Zap.
            </p>
          </div>

          {/* Message */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Message *</label>
            <textarea
              value={formData.message}
              onChange={(e) => setFormData({ ...formData, message: e.target.value })}
              placeholder="Hello {firstName}! Thanks for your message: {text}"
              rows={4}
              className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <p className="text-sm text-gray-500 mt-1">
              Supports HTML formatting: &lt;b&gt;bold&lt;/b&gt;, &lt;i&gt;italic&lt;/i&gt;,
              &lt;code&gt;code&lt;/code&gt;
            </p>
          </div>

          {/* Template Variables */}
          <div className="bg-gray-50 p-4 rounded-lg">
            <h4 className="font-medium text-gray-700 mb-2">Available Variables</h4>
            <p className="text-sm text-gray-500 mb-3">Click to insert into message</p>
            <div className="flex flex-wrap gap-2">
              {templateVariables.map((v) => (
                <button
                  key={v.key}
                  onClick={() => insertVariable(v.key)}
                  className="px-3 py-1 bg-white border rounded-full text-sm hover:bg-blue-50 hover:border-blue-300 transition-colors"
                  title={v.description}
                >
                  {v.key}
                </button>
              ))}
            </div>
          </div>

          {/* Preview */}
          {formData.message && (
            <div className="bg-blue-50 p-4 rounded-lg">
              <h4 className="font-medium text-blue-800 mb-2">Message Preview</h4>
              <div className="bg-white p-3 rounded-lg border-l-4 border-blue-500">
                <p className="text-gray-700 whitespace-pre-wrap">{formData.message}</p>
              </div>
            </div>
          )}

          <Button variant="primary" onClick={handleSave} className="w-full">
            Save Telegram Action
          </Button>
        </div>
      )}
    </div>
  );
};

export default TelegramActionConfig;
