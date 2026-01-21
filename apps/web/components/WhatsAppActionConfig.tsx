'use client';
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import FormInput from './FormInput';
import Button from './Button';
import { API_URL } from '@/lib/config';

interface WhatsAppServer {
  id: string;
  displayName: string;
  phoneNumber: string;
  phoneNumberId: string;
  accessToken: string;
}

interface Props {
  zapId?: string;
  onActionConfigured?: (config: any) => void;
}

const WhatsAppActionConfig = ({ zapId, onActionConfigured }: Props) => {
  const [servers, setServers] = useState<WhatsAppServer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedServer, setSelectedServer] = useState('');
  const [formData, setFormData] = useState({
    to: '',
    message: '',
  });

  // Template variables that can be used in messages
  const templateVariables = [
    { key: '{from}', description: 'Sender phone number' },
    { key: '{fromName}', description: 'Sender name (if available)' },
    { key: '{text}', description: 'Message text content' },
    { key: '{timestamp}', description: 'Message timestamp' },
    { key: '{email}', description: 'User email (triggers)' },
  ];

  const fetchServers = async () => {
    try {
      setIsLoading(true);

      const response = await axios.get(`${API_URL}/api/whatsapp/servers`, {
        withCredentials: true,
      });

      setServers(response.data.servers || []);
    } catch (error: any) {
      toast.error('Failed to fetch WhatsApp servers');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = () => {
    if (!selectedServer) {
      toast.error('Please select a WhatsApp account');
      return;
    }
    if (!formData.to.trim()) {
      toast.error('Please enter a recipient phone number');
      return;
    }
    if (!formData.message.trim()) {
      toast.error('Please enter a message');
      return;
    }

    const server = servers.find((s) => s.id === selectedServer);
    if (!server) return;

    const actionConfig = {
      type: 'WhatsApp',
      metadata: {
        to: formData.to,
        message: formData.message,
        phoneNumberId: server.phoneNumberId,
        accessToken: server.accessToken,
        serverDisplayName: server.displayName,
      },
    };

    if (onActionConfigured) {
      onActionConfigured(actionConfig);
    }

    toast.success('WhatsApp action configured!');
  };

  const insertVariable = (variable: string) => {
    setFormData({
      ...formData,
      message: formData.message + variable,
    });
  };

  useEffect(() => {
    fetchServers();
  }, []);

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
        <span className="text-green-500">📱</span>
        Send WhatsApp Message
      </h2>

      {isLoading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500 mx-auto"></div>
        </div>
      ) : servers.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <p>No WhatsApp accounts connected.</p>
          <p className="text-sm mt-2">Connect a WhatsApp account first to send messages.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Account Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              WhatsApp Account *
            </label>
            <select
              value={selectedServer}
              onChange={(e) => setSelectedServer(e.target.value)}
              className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
            >
              <option value="">Select account...</option>
              {servers.map((server) => (
                <option key={server.id} value={server.id}>
                  {server.displayName} ({server.phoneNumber || 'No number'})
                </option>
              ))}
            </select>
          </div>

          {/* Recipient */}
          <div>
            <FormInput
              label="Recipient Phone Number *"
              name="to"
              placeholder="+1234567890 or use {from} for reply"
              value={formData.to}
              onChange={(e) => setFormData({ ...formData, to: e.target.value })}
            />
            <p className="text-sm text-gray-500 mt-1">
              Include country code. Use {'{from}'} to reply to the sender.
            </p>
          </div>

          {/* Message */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Message *</label>
            <textarea
              value={formData.message}
              onChange={(e) => setFormData({ ...formData, message: e.target.value })}
              placeholder="Hello! Thanks for your message: {text}"
              rows={4}
              className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
            />
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
                  className="px-3 py-1 bg-white border rounded-full text-sm hover:bg-green-50 hover:border-green-300 transition-colors"
                  title={v.description}
                >
                  {v.key}
                </button>
              ))}
            </div>
          </div>

          {/* Preview */}
          {formData.message && (
            <div className="bg-green-50 p-4 rounded-lg">
              <h4 className="font-medium text-green-800 mb-2">Message Preview</h4>
              <div className="bg-white p-3 rounded-lg border-l-4 border-green-500">
                <p className="text-gray-700 whitespace-pre-wrap">{formData.message}</p>
              </div>
            </div>
          )}

          <Button variant="primary" onClick={handleSave} className="w-full">
            Save WhatsApp Action
          </Button>
        </div>
      )}
    </div>
  );
};

export default WhatsAppActionConfig;
