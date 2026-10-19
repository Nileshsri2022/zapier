'use client';
import React, { useState } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import FormInput from './FormInput';
import Button from './Button';
import { Spinner } from './ui/spinner';
import { API_URL } from '@/lib/config';
import { redirectToOAuth } from '@/lib/oauth';

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

      const response = await axios.get(`${API_URL}/api/gmail/servers`, {
        withCredentials: true,
      });

      setServers(response.data.gmailServers || []);
    } catch (error: any) {
      toast.error(
        'Failed to fetch Gmail servers: ' + (error.response?.data?.message || error.message)
      );
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
      const response = await axios.post(
        `${API_URL}/api/gmail/auth/initiate`,
        {
          name: newServerName,
        },
        {
          withCredentials: true,
        }
      );

      // Redirect to Gmail OAuth with state preservation
      redirectToOAuth(response.data.authUrl);
    } catch (error: any) {
      toast.error(
        'Failed to initiate Gmail auth: ' + (error.response?.data?.message || error.message)
      );
    }
  };

  const testGmailConnection = async (serverId: string) => {
    try {
      await axios.post(
        `${API_URL}/api/gmail/servers/${serverId}/test`,
        {},
        {
          withCredentials: true,
        }
      );

      toast.success('Gmail connection successful!');
    } catch (error: any) {
      toast.error('Gmail connection failed: ' + (error.response?.data?.message || error.message));
    }
  };

  const deleteGmailServer = async (serverId: string) => {
    if (
      !confirm(
        'Are you sure you want to delete this Gmail server? This will also delete all associated triggers and actions.'
      )
    ) {
      return;
    }

    try {
      await axios.delete(`${API_URL}/api/gmail/servers/${serverId}`, {
        withCredentials: true,
      });

      toast.success('Gmail server deleted successfully');
      fetchGmailServers(); // Refresh the list
    } catch (error: any) {
      toast.error(
        'Failed to delete Gmail server: ' + (error.response?.data?.message || error.message)
      );
    }
  };

  const toggleServerStatus = async (serverId: string, isActive: boolean) => {
    try {
      await axios.put(
        `${API_URL}/api/gmail/servers/${serverId}`,
        {
          isActive: !isActive,
        },
        {
          withCredentials: true,
        }
      );

      toast.success(`Gmail server ${!isActive ? 'enabled' : 'disabled'} successfully`);
      fetchGmailServers(); // Refresh the list
    } catch (error: any) {
      toast.error(
        'Failed to update Gmail server: ' + (error.response?.data?.message || error.message)
      );
    }
  };

  React.useEffect(() => {
    fetchGmailServers();
  }, []);

  return (
    <div className="gmail-panel">
      <div className="gmail-panel__head">
        <h2 className="gmail-panel__title">Gmail Servers</h2>
        <Button variant="primary" onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? 'Cancel' : 'Add Gmail Server'}
        </Button>
      </div>

      {showAddForm && (
        <div className="gmail-form-card">
          <h3 className="gmail-card__title">Connect Gmail Account</h3>
          <div className="gmail-form-row">
            <div className="gmail-form-row__field">
              <FormInput
                label="Server Name"
                name="serverName"
                placeholder="My Gmail Account"
                onChange={(e) => setNewServerName(e.target.value)}
              />
            </div>
            <Button variant="primary" onClick={initiateGmailAuth}>
              Connect Gmail
            </Button>
          </div>
          <p className="gmail-card__note">
            This will redirect you to Gmail to authorize access to your account.
          </p>
        </div>
      )}

      {isLoading ? (
        <div className="gmail-empty">
          <Spinner color="primary" />
          <p className="gmail-empty__text">Loading Gmail servers...</p>
        </div>
      ) : servers.length === 0 ? (
        <div className="gmail-empty">
          <p>No Gmail servers configured yet.</p>
          <p className="gmail-empty__text">
            Add a Gmail server to start creating email automations.
          </p>
        </div>
      ) : (
        <div className="gmail-list">
          {servers.map((server) => (
            <div key={server.id} className="gmail-card">
              <div className="gmail-card__head">
                <div>
                  <h3 className="gmail-card__title">{server.name}</h3>
                  <p className="gmail-card__meta">
                    Created: {new Date(server.createdAt).toLocaleDateString()}
                  </p>
                  <p className="gmail-card__meta">
                    Triggers: {server.gmailTriggers.length} | Actions: {server.gmailActions.length}
                  </p>
                </div>
                <div className="gmail-card__actions">
                  <span className="gmail-pill" data-tone={server.isActive ? 'ok' : 'alert'}>
                    {server.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>

              <div className="gmail-card__footer">
                <Button variant="outline" size="md" onClick={() => testGmailConnection(server.id)}>
                  Test Connection
                </Button>
                <Button
                  variant={server.isActive ? 'secondary' : 'primary'}
                  size="md"
                  onClick={() => toggleServerStatus(server.id, server.isActive)}
                >
                  {server.isActive ? 'Disable' : 'Enable'}
                </Button>
                <Button variant="link" size="md" onClick={() => deleteGmailServer(server.id)}>
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
