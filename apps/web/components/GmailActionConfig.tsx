'use client';
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import FormInput from './FormInput';
import Button from './Button';
import { API_URL } from '@/lib/config';

interface GmailServer {
  id: string;
  name: string;
}

interface GmailAction {
  id: string;
  actionType: string;
  metadata: any;
  zap: {
    id: string;
    name: string;
  };
}

const GmailActionConfig = () => {
  const [servers, setServers] = useState<GmailServer[]>([]);
  const [selectedServer, setSelectedServer] = useState<string>('');
  const [actions, setActions] = useState<GmailAction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedZap, setSelectedZap] = useState<string>('');

  const [formData, setFormData] = useState({
    actionType: 'GmailSend',
    to: '',
    subject: '',
    body: '',
    cc: '',
    bcc: '',
    replyMessageId: '',
    replyAll: false,
    labelIds: [] as string[],
    markAsRead: true,
    archive: false,
  });

  const actionTypes = [
    {
      value: 'GmailSend',
      label: 'Send Email',
      description: 'Compose and send a new email',
      requiresMetadata: true
    },
    {
      value: 'GmailReply',
      label: 'Reply to Email',
      description: 'Reply to an existing email',
      requiresMetadata: true
    },
    {
      value: 'GmailAddLabel',
      label: 'Add Label',
      description: 'Add labels to an email',
      requiresMetadata: true
    },
    {
      value: 'GmailRemoveLabel',
      label: 'Remove Label',
      description: 'Remove labels from an email',
      requiresMetadata: true
    },
    {
      value: 'GmailMarkRead',
      label: 'Mark as Read/Unread',
      description: 'Change email read status',
      requiresMetadata: true
    },
    {
      value: 'GmailArchive',
      label: 'Archive Email',
      description: 'Move email to archive',
      requiresMetadata: true
    },
  ];

  const commonLabels = [
    'INBOX', 'SENT', 'DRAFT', 'TRASH', 'SPAM', 'STARRED', 'IMPORTANT', 'UNREAD'
  ];

  const fetchGmailServers = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        toast.error('No authentication token found');
        return;
      }

      const response = await axios.get(`${API_URL}/api/gmail/servers`, {
        headers: { Authorization: token }
      });

      setServers(response.data.gmailServers || []);
    } catch (error: any) {
      toast.error('Failed to fetch Gmail servers: ' + (error.response?.data?.message || error.message));
    }
  };

  const fetchGmailActions = async (serverId?: string) => {
    try {
      setIsLoading(true);
      const token = localStorage.getItem('token');
      if (!token) {
        toast.error('No authentication token found');
        return;
      }

      const response = await axios.get(`${API_URL}/api/gmail/triggers${serverId ? `/${serverId}` : ''}`, {
        headers: { Authorization: token }
      });

      // Note: This endpoint doesn't exist yet - would need to be implemented
      // For now, we'll show a placeholder
      setActions([]);
    } catch (error: any) {
      toast.error('Failed to fetch Gmail actions: ' + (error.response?.data?.message || error.message));
    } finally {
      setIsLoading(false);
    }
  };

  const createGmailAction = async () => {
    if (!selectedServer || !formData.to) {
      toast.error('Please select a Gmail server and provide required fields');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        toast.error('No authentication token found');
        return;
      }

      // Prepare metadata based on action type
      let metadata: any = {};

      switch (formData.actionType) {
        case 'GmailSend':
          metadata = {
            to: formData.to,
            subject: formData.subject,
            body: formData.body,
            cc: formData.cc || undefined,
            bcc: formData.bcc || undefined,
          };
          break;
        case 'GmailReply':
          metadata = {
            messageId: formData.replyMessageId,
            body: formData.body,
            replyAll: formData.replyAll,
          };
          break;
        case 'GmailAddLabel':
        case 'GmailRemoveLabel':
          metadata = {
            messageId: formData.replyMessageId,
            labelIds: formData.labelIds,
          };
          break;
        case 'GmailMarkRead':
          metadata = {
            messageId: formData.replyMessageId,
            isRead: formData.markAsRead,
          };
          break;
        case 'GmailArchive':
          metadata = {
            messageId: formData.replyMessageId,
          };
          break;
      }

      // Note: This would need a proper API endpoint to be implemented
      toast.info('Gmail action creation would be implemented here');
      console.log('Gmail Action Data:', {
        serverId: selectedServer,
        actionType: formData.actionType,
        metadata,
      });

      setShowAddForm(false);
      resetForm();
    } catch (error: any) {
      toast.error('Failed to create Gmail action: ' + (error.response?.data?.message || error.message));
    }
  };

  const resetForm = () => {
    setFormData({
      actionType: 'GmailSend',
      to: '',
      subject: '',
      body: '',
      cc: '',
      bcc: '',
      replyMessageId: '',
      replyAll: false,
      labelIds: [],
      markAsRead: true,
      archive: false,
    });
  };

  const handleLabelToggle = (label: string) => {
    setFormData(prev => ({
      ...prev,
      labelIds: prev.labelIds.includes(label)
        ? prev.labelIds.filter(l => l !== label)
        : [...prev.labelIds, label]
    }));
  };

  const renderActionMetadata = () => {
    const currentAction = actionTypes.find(a => a.value === formData.actionType);

    if (!currentAction?.requiresMetadata) {
      return null;
    }

    switch (formData.actionType) {
      case 'GmailSend':
        return (
          <div className="space-y-4">
            <FormInput
              label="To"
              name="to"
              placeholder="recipient@example.com"
              onChange={(e) => setFormData(prev => ({ ...prev, to: e.target.value }))}
            />
            <FormInput
              label="Subject"
              name="subject"
              placeholder="Email subject"
              onChange={(e) => setFormData(prev => ({ ...prev, subject: e.target.value }))}
            />
            <div>
              <label className="block text-sm font-medium mb-2">Body</label>
              <textarea
                name="body"
                placeholder="Email content..."
                rows={6}
                className="w-full p-2 border border-gray-300 rounded-md"
                onChange={(e) => setFormData(prev => ({ ...prev, body: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormInput
                label="CC (optional)"
                name="cc"
                placeholder="cc@example.com"
                onChange={(e) => setFormData(prev => ({ ...prev, cc: e.target.value }))}
              />
              <FormInput
                label="BCC (optional)"
                name="bcc"
                placeholder="bcc@example.com"
                onChange={(e) => setFormData(prev => ({ ...prev, bcc: e.target.value }))}
              />
            </div>
          </div>
        );

      case 'GmailReply':
        return (
          <div className="space-y-4">
            <FormInput
              label="Message ID to Reply To"
              name="replyMessageId"
              placeholder="Gmail message ID"
              onChange={(e) => setFormData(prev => ({ ...prev, replyMessageId: e.target.value }))}
            />
            <div className="flex items-center">
              <input
                type="checkbox"
                id="replyAll"
                checked={formData.replyAll}
                onChange={(e) => setFormData(prev => ({ ...prev, replyAll: e.target.checked }))}
                className="mr-2"
              />
              <label htmlFor="replyAll">Reply to all recipients</label>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Reply Body</label>
              <textarea
                name="body"
                placeholder="Reply content..."
                rows={6}
                className="w-full p-2 border border-gray-300 rounded-md"
                onChange={(e) => setFormData(prev => ({ ...prev, body: e.target.value }))}
              />
            </div>
          </div>
        );

      case 'GmailAddLabel':
      case 'GmailRemoveLabel':
        return (
          <div className="space-y-4">
            <FormInput
              label="Message ID"
              name="messageId"
              placeholder="Gmail message ID"
              onChange={(e) => setFormData(prev => ({ ...prev, replyMessageId: e.target.value }))}
            />
            <div>
              <label className="block text-sm font-medium mb-2">Labels</label>
              <div className="flex flex-wrap gap-2">
                {commonLabels.map(label => (
                  <button
                    key={label}
                    onClick={() => handleLabelToggle(label)}
                    className={`px-2 py-1 text-xs rounded-full border ${formData.labelIds.includes(label)
                        ? 'bg-blue-100 border-blue-300 text-blue-800'
                        : 'bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200'
                      }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        );

      case 'GmailMarkRead':
        return (
          <div className="space-y-4">
            <FormInput
              label="Message ID"
              name="messageId"
              placeholder="Gmail message ID"
              onChange={(e) => setFormData(prev => ({ ...prev, replyMessageId: e.target.value }))}
            />
            <div className="flex items-center">
              <input
                type="checkbox"
                id="markAsRead"
                checked={formData.markAsRead}
                onChange={(e) => setFormData(prev => ({ ...prev, markAsRead: e.target.checked }))}
                className="mr-2"
              />
              <label htmlFor="markAsRead">Mark as read (uncheck to mark as unread)</label>
            </div>
          </div>
        );

      case 'GmailArchive':
        return (
          <div className="space-y-4">
            <FormInput
              label="Message ID"
              name="messageId"
              placeholder="Gmail message ID"
              onChange={(e) => setFormData(prev => ({ ...prev, replyMessageId: e.target.value }))}
            />
          </div>
        );

      default:
        return null;
    }
  };

  useEffect(() => {
    fetchGmailServers();
  }, []);

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Gmail Actions</h2>
        <div className="flex gap-4">
          <select
            value={selectedServer}
            onChange={(e) => setSelectedServer(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md"
          >
            <option value="">Select Gmail Server</option>
            {servers.map(server => (
              <option key={server.id} value={server.id}>{server.name}</option>
            ))}
          </select>
          <Button
            variant="primary"
            onClick={() => setShowAddForm(!showAddForm)}
          >
            {showAddForm ? 'Cancel' : 'Add Action'}
          </Button>
        </div>
      </div>

      {showAddForm && (
        <div className="bg-white p-6 rounded-lg shadow-md mb-6">
          <h3 className="text-lg font-semibold mb-4">Create Gmail Action</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-2">Action Type</label>
              <select
                value={formData.actionType}
                onChange={(e) => setFormData(prev => ({ ...prev, actionType: e.target.value }))}
                className="w-full p-2 border border-gray-300 rounded-md"
              >
                {actionTypes.map(action => (
                  <option key={action.value} value={action.value}>
                    {action.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-600 mt-1">
                {actionTypes.find(a => a.value === formData.actionType)?.description}
              </p>
            </div>
          </div>

          {renderActionMetadata()}

          <div className="flex gap-2 mt-6">
            <Button variant="primary" onClick={createGmailAction}>
              Create Action
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
          <p className="mt-2 text-gray-600">Loading Gmail actions...</p>
        </div>
      ) : actions.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <p>No Gmail actions configured yet.</p>
          <p className="text-sm mt-2">Select a Gmail server and create actions to start email automations.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {actions.map((action) => (
            <div key={action.id} className="bg-white p-6 rounded-lg shadow-md">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-semibold capitalize">
                    {action.actionType.replace('Gmail', '').toLowerCase()} Action
                  </h3>
                  <p className="text-sm text-gray-600">
                    Used in Zap: {action.zap.name}
                  </p>
                </div>
                <Button
                  variant="link"
                  onClick={() => {
                    // Delete action logic would go here
                    toast.info('Delete action functionality would be implemented');
                  }}
                >
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

export default GmailActionConfig;
