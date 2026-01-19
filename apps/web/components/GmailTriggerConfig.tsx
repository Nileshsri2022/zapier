'use client';
import { API_URL } from '@/lib/config';
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import FormInput from './FormInput';
import Button from './Button';

interface GmailServer {
  id: string;
  name: string;
}

interface GmailTrigger {
  id: string;
  triggerType: string;
  watchedLabels: string[];
  senderFilter?: string;
  subjectFilter?: string;
  metadata?: any;
  zap: {
    id: string;
    name: string;
  };
}

const GmailTriggerConfig = () => {
  const [servers, setServers] = useState<GmailServer[]>([]);
  const [selectedServer, setSelectedServer] = useState<string>('');
  const [triggers, setTriggers] = useState<GmailTrigger[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedZap, setSelectedZap] = useState<string>('');

  const [formData, setFormData] = useState({
    triggerType: 'new_email',
    watchedLabels: [] as string[],
    senderFilter: '',
    subjectFilter: '',
    zapId: '',
  });

  const triggerTypes = [
    { value: 'new_email', label: 'New Email', description: 'Trigger when new emails arrive' },
    { value: 'labeled', label: 'Email Labeled', description: 'Trigger when emails are labeled' },
    { value: 'starred', label: 'Email Starred', description: 'Trigger when emails are starred' },
    {
      value: 'moved',
      label: 'Email Moved',
      description: 'Trigger when emails are moved between folders',
    },
  ];

  const commonLabels = [
    'INBOX',
    'SENT',
    'DRAFT',
    'TRASH',
    'SPAM',
    'STARRED',
    'IMPORTANT',
    'UNREAD',
  ];

  const fetchGmailServers = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        toast.error('No authentication token found');
        return;
      }

      const response = await axios.get('${API_URL}/api/gmail/servers', {
        headers: { Authorization: token },
      });

      setServers(response.data.gmailServers || []);
    } catch (error: any) {
      toast.error(
        'Failed to fetch Gmail servers: ' + (error.response?.data?.message || error.message)
      );
    }
  };

  const fetchGmailTriggers = async (serverId?: string) => {
    try {
      setIsLoading(true);
      const token = localStorage.getItem('token');
      if (!token) {
        toast.error('No authentication token found');
        return;
      }

      const response = await axios.get(
        `${API_URL}/api/gmail/triggers${serverId ? `/${serverId}` : ''}`,
        {
          headers: { Authorization: token },
        }
      );

      setTriggers(response.data.gmailTriggers || []);
    } catch (error: any) {
      toast.error(
        'Failed to fetch Gmail triggers: ' + (error.response?.data?.message || error.message)
      );
    } finally {
      setIsLoading(false);
    }
  };

  const createGmailTrigger = async () => {
    if (!selectedServer || !formData.zapId) {
      toast.error('Please select a Gmail server and Zap');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        toast.error('No authentication token found');
        return;
      }

      await axios.post(
        '${API_URL}/api/gmail/triggers',
        {
          serverId: selectedServer,
          zapId: formData.zapId,
          triggerType: formData.triggerType,
          watchedLabels: formData.watchedLabels,
          senderFilter: formData.senderFilter || undefined,
          subjectFilter: formData.subjectFilter || undefined,
        },
        {
          headers: { Authorization: token },
        }
      );

      toast.success('Gmail trigger created successfully');
      setShowAddForm(false);
      resetForm();
      fetchGmailTriggers(selectedServer);
    } catch (error: any) {
      toast.error(
        'Failed to create Gmail trigger: ' + (error.response?.data?.message || error.message)
      );
    }
  };

  const deleteGmailTrigger = async (triggerId: string) => {
    if (!confirm('Are you sure you want to delete this Gmail trigger?')) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        toast.error('No authentication token found');
        return;
      }

      await axios.delete(`${API_URL}/api/gmail/triggers/${triggerId}`, {
        headers: { Authorization: token },
      });

      toast.success('Gmail trigger deleted successfully');
      fetchGmailTriggers(selectedServer);
    } catch (error: any) {
      toast.error(
        'Failed to delete Gmail trigger: ' + (error.response?.data?.message || error.message)
      );
    }
  };

  const resetForm = () => {
    setFormData({
      triggerType: 'new_email',
      watchedLabels: [],
      senderFilter: '',
      subjectFilter: '',
      zapId: '',
    });
  };

  const handleLabelToggle = (label: string) => {
    setFormData((prev) => ({
      ...prev,
      watchedLabels: prev.watchedLabels.includes(label)
        ? prev.watchedLabels.filter((l) => l !== label)
        : [...prev.watchedLabels, label],
    }));
  };

  useEffect(() => {
    fetchGmailServers();
  }, []);

  useEffect(() => {
    if (selectedServer) {
      fetchGmailTriggers(selectedServer);
    } else {
      setTriggers([]);
    }
  }, [selectedServer]);

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Gmail Triggers</h2>
        <div className="flex gap-4">
          <select
            value={selectedServer}
            onChange={(e) => setSelectedServer(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md"
          >
            <option value="">Select Gmail Server</option>
            {servers.map((server) => (
              <option key={server.id} value={server.id}>
                {server.name}
              </option>
            ))}
          </select>
          <Button variant="primary" onClick={() => setShowAddForm(!showAddForm)}>
            {showAddForm ? 'Cancel' : 'Add Trigger'}
          </Button>
        </div>
      </div>

      {showAddForm && (
        <div className="bg-white p-6 rounded-lg shadow-md mb-6">
          <h3 className="text-lg font-semibold mb-4">Create Gmail Trigger</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Trigger Type</label>
              <select
                value={formData.triggerType}
                onChange={(e) => setFormData((prev) => ({ ...prev, triggerType: e.target.value }))}
                className="w-full p-2 border border-gray-300 rounded-md"
              >
                {triggerTypes.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-600 mt-1">
                {triggerTypes.find((t) => t.value === formData.triggerType)?.description}
              </p>
            </div>

            <div>
              <FormInput
                label="Zap ID"
                name="zapId"
                placeholder="Enter Zap ID to trigger"
                onChange={(e) => setFormData((prev) => ({ ...prev, zapId: e.target.value }))}
              />
            </div>
          </div>

          <div className="mt-4">
            <label className="block text-sm font-medium mb-2">Watch Labels</label>
            <div className="flex flex-wrap gap-2">
              {commonLabels.map((label) => (
                <button
                  key={label}
                  onClick={() => handleLabelToggle(label)}
                  className={`px-2 py-1 text-xs rounded-full border ${
                    formData.watchedLabels.includes(label)
                      ? 'bg-blue-100 border-blue-300 text-blue-800'
                      : 'bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <FormInput
              label="Sender Filter (optional)"
              name="senderFilter"
              placeholder="e.g., boss@company.com"
              onChange={(e) => setFormData((prev) => ({ ...prev, senderFilter: e.target.value }))}
            />
            <FormInput
              label="Subject Filter (optional)"
              name="subjectFilter"
              placeholder="e.g., urgent"
              onChange={(e) => setFormData((prev) => ({ ...prev, subjectFilter: e.target.value }))}
            />
          </div>

          <div className="flex gap-2 mt-6">
            <Button variant="primary" onClick={createGmailTrigger}>
              Create Trigger
            </Button>
            <Button variant="outline" onClick={() => setShowAddForm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500 mx-auto"></div>
          <p className="mt-2 text-gray-600">Loading Gmail triggers...</p>
        </div>
      ) : triggers.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <p>No Gmail triggers configured yet.</p>
          <p className="text-sm mt-2">
            Select a Gmail server and create triggers to start email automations.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {triggers.map((trigger) => (
            <div key={trigger.id} className="bg-white p-6 rounded-lg shadow-md">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-semibold capitalize">
                    {trigger.triggerType.replace('_', ' ')} Trigger
                  </h3>
                  <p className="text-sm text-gray-600">Triggers Zap: {trigger.zap.name}</p>
                  {trigger.watchedLabels.length > 0 && (
                    <p className="text-sm text-gray-600">
                      Watching: {trigger.watchedLabels.join(', ')}
                    </p>
                  )}
                  {trigger.senderFilter && (
                    <p className="text-sm text-gray-600">Sender: {trigger.senderFilter}</p>
                  )}
                  {trigger.subjectFilter && (
                    <p className="text-sm text-gray-600">Subject: {trigger.subjectFilter}</p>
                  )}
                </div>
                <Button variant="link" onClick={() => deleteGmailTrigger(trigger.id)}>
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

export default GmailTriggerConfig;
