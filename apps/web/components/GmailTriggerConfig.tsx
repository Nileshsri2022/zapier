'use client';
import { API_URL } from '@/lib/config';
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import FormInput from './FormInput';
import Button from './Button';
import { Spinner } from './ui/spinner';

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
      const response = await axios.get(`${API_URL}/api/gmail/servers`, {
        withCredentials: true,
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

      const response = await axios.get(
        `${API_URL}/api/gmail/triggers${serverId ? `/${serverId}` : ''}`,
        {
          withCredentials: true,
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
      await axios.post(
        `${API_URL}/api/gmail/triggers`,
        {
          serverId: selectedServer,
          zapId: formData.zapId,
          triggerType: formData.triggerType,
          watchedLabels: formData.watchedLabels,
          senderFilter: formData.senderFilter || undefined,
          subjectFilter: formData.subjectFilter || undefined,
        },
        {
          withCredentials: true,
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
      await axios.delete(`${API_URL}/api/gmail/triggers/${triggerId}`, {
        withCredentials: true,
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
    <div className="gmail-panel">
      <div className="gmail-panel__head">
        <h2 className="gmail-panel__title">Gmail Triggers</h2>
        <div className="gmail-panel__actions">
          <select
            value={selectedServer}
            onChange={(e) => setSelectedServer(e.target.value)}
            className="gmail-select"
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
        <div className="gmail-form-card">
          <h3 className="gmail-card__title">Create Gmail Trigger</h3>

          <div className="gmail-grid">
            <div>
              <label className="gmail-label">Trigger Type</label>
              <select
                value={formData.triggerType}
                onChange={(e) => setFormData((prev) => ({ ...prev, triggerType: e.target.value }))}
                className="gmail-input"
              >
                {triggerTypes.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
              <p className="gmail-hint">
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

          <div className="gmail-block">
            <label className="gmail-label">Watch Labels</label>
            <div className="gmail-chips">
              {commonLabels.map((label) => (
                <button
                  key={label}
                  onClick={() => handleLabelToggle(label)}
                  className="gmail-chip"
                  data-selected={formData.watchedLabels.includes(label)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="gmail-grid gmail-block">
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

          <div className="gmail-actions">
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
        <div className="gmail-empty">
          <Spinner color="primary" />
          <p className="gmail-empty__text">Loading Gmail triggers...</p>
        </div>
      ) : triggers.length === 0 ? (
        <div className="gmail-empty">
          <p>No Gmail triggers configured yet.</p>
          <p className="gmail-empty__text">
            Select a Gmail server and create triggers to start email automations.
          </p>
        </div>
      ) : (
        <div className="gmail-list">
          {triggers.map((trigger) => (
            <div key={trigger.id} className="gmail-card">
              <div className="gmail-card__head">
                <div>
                  <h3 className="gmail-card__title gmail-card__title--cap">
                    {trigger.triggerType.replace('_', ' ')} Trigger
                  </h3>
                  <p className="gmail-card__meta">Triggers Zap: {trigger.zap.name}</p>
                  {trigger.watchedLabels.length > 0 && (
                    <p className="gmail-card__meta">Watching: {trigger.watchedLabels.join(', ')}</p>
                  )}
                  {trigger.senderFilter && (
                    <p className="gmail-card__meta">Sender: {trigger.senderFilter}</p>
                  )}
                  {trigger.subjectFilter && (
                    <p className="gmail-card__meta">Subject: {trigger.subjectFilter}</p>
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
