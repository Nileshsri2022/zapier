'use client';
import React, { useState } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import FormInput from './FormInput';
import Button from './Button';
import { API_URL } from '@/lib/config';

interface GmailServer {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  gmailTriggers: any[];
  gmailActions: any[];
  watchHistory: any[];
}

const GmailServerConfig = () => {
  const [servers, setServers] = useState<GmailServer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newServerName, setNewServerName] = useState('');

  const fetchGmailServers = async () => {
    try {
      setIsLoading(true);
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
    } finally {
      setIsLoading(false);
    }
  };

  const initiateGmailAuth = async () => {
    if (!newServerName.trim()) {
      toast.error('Please enter a server name');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        toast.error('No authentication token found');
        return;
      }

      const response = await axios.post(`${API_URL}/api/gmail/auth/initiate`, {
        name: newServerName
      }, {
        headers: { Authorization: token }
      });

      // Redirect to Gmail OAuth
      window.location.href = response.data.authUrl;
    } catch (error: any) {
      toast.error('Failed to initiate Gmail auth: ' + (error.response?.data?.message || error.message));
    }
  };

  const testGmailConnection = async (serverId: string) => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        toast.error('No authentication token found');
        return;
      }

      await axios.post(`${API_URL}/api/gmail/servers/${serverId}/test`, {}, {
        headers: { Authorization: token }
      });

      toast.success('Gmail connection successful!');
    } catch (error: any) {
      toast.error('Gmail connection failed: ' + (error.response?.data?.message || error.message));
    }
  };

  const deleteGmailServer = async (serverId: string) => {
    if (!confirm('Are you sure you want to delete this Gmail server? This will also delete all associated triggers and actions.')) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        toast.error('No authentication token found');
        return;
      }

      await axios.delete(`${API_URL}/api/gmail/servers/${serverId}`, {
        headers: { Authorization: token }
      });

      toast.success('Gmail server deleted successfully');
      fetchGmailServers(); // Refresh the list
    } catch (error: any) {
      toast.error('Failed to delete Gmail server: ' + (error.response?.data?.message || error.message));
    }
  };

  const toggleServerStatus = async (serverId: string, isActive: boolean) => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        toast.error('No authentication token found');
        return;
      }

      await axios.put(`${API_URL}/api/gmail/servers/${serverId}`, {
        isActive: !isActive
      }, {
        headers: { Authorization: token }
      });

      toast.success(`Gmail server ${!isActive ? 'enabled' : 'disabled'} successfully`);
      fetchGmailServers(); // Refresh the list
    } catch (error: any) {
      toast.error('Failed to update Gmail server: ' + (error.response?.data?.message || error.message));
    }
  };

  React.useEffect(() => {
    fetchGmailServers();
  }, []);

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Gmail Servers</h2>
        <Button
          variant="primary"
          onClick={() => setShowAddForm(!showAddForm)}
        >
          {showAddForm ? 'Cancel' : 'Add Gmail Server'}
        </Button>
      </div>

      {showAddForm && (
        <div className="bg-white p-6 rounded-lg shadow-md mb-6">
          <h3 className="text-lg font-semibold mb-4">Connect Gmail Account</h3>
          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <FormInput
                label="Server Name"
                name="serverName"
                placeholder="My Gmail Account"
                onChange={(e) => setNewServerName(e.target.value)}
              />
            </div>
            <Button
              variant="primary"
              onClick={initiateGmailAuth}
            >
              Connect Gmail
            </Button>
          </div>
          <p className="text-sm text-gray-600 mt-2">
            This will redirect you to Gmail to authorize access to your account.
          </p>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500 mx-auto"></div>
          <p className="mt-2 text-gray-600">Loading Gmail servers...</p>
        </div>
      ) : servers.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <p>No Gmail servers configured yet.</p>
          <p className="text-sm mt-2">Add a Gmail server to start creating email automations.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {servers.map((server) => (
            <div key={server.id} className="bg-white p-6 rounded-lg shadow-md">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-semibold">{server.name}</h3>
                  <p className="text-sm text-gray-600">
                    Created: {new Date(server.createdAt).toLocaleDateString()}
                  </p>
                  <p className="text-sm text-gray-600">
                    Triggers: {server.gmailTriggers.length} |
                    Actions: {server.gmailActions.length}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 text-xs rounded-full ${server.isActive
                    ? 'bg-green-100 text-green-800'
                    : 'bg-red-100 text-red-800'
                    }`}>
                    {server.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="md"
                  onClick={() => testGmailConnection(server.id)}
                >
                  Test Connection
                </Button>
                <Button
                  variant={server.isActive ? "secondary" : "primary"}
                  size="md"
                  onClick={() => toggleServerStatus(server.id, server.isActive)}
                >
                  {server.isActive ? 'Disable' : 'Enable'}
                </Button>
                <Button
                  variant="link"
                  size="md"
                  onClick={() => deleteGmailServer(server.id)}
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

export default GmailServerConfig;

