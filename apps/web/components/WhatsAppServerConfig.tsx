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
  webhookVerified: boolean;
  isActive: boolean;
  createdAt: string;
  triggers: any[];
}

const WhatsAppServerConfig = () => {
  const [servers, setServers] = useState<WhatsAppServer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({
    displayName: '',
    phoneNumberId: '',
    businessId: '',
    accessToken: '',
    phoneNumber: '',
  });

  const fetchWhatsAppServers = async () => {
    try {
      setIsLoading(true);
      const token = localStorage.getItem('token');
      if (!token) {
        toast.error('No authentication token found');
        return;
      }

      const response = await axios.get(`${API_URL}/api/whatsapp/servers`, {
        headers: { Authorization: token },
      });

      setServers(response.data.servers || []);
    } catch (error: any) {
      toast.error(
        'Failed to fetch WhatsApp servers: ' + (error.response?.data?.message || error.message)
      );
    } finally {
      setIsLoading(false);
    }
  };

  const createWhatsAppServer = async () => {
    if (
      !formData.displayName.trim() ||
      !formData.phoneNumberId.trim() ||
      !formData.accessToken.trim()
    ) {
      toast.error('Please fill in all required fields');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        toast.error('No authentication token found');
        return;
      }

      await axios.post(`${API_URL}/api/whatsapp/servers`, formData, {
        headers: { Authorization: token },
      });

      toast.success('WhatsApp server connected successfully!');
      setShowAddForm(false);
      setFormData({
        displayName: '',
        phoneNumberId: '',
        businessId: '',
        accessToken: '',
        phoneNumber: '',
      });
      fetchWhatsAppServers();
    } catch (error: any) {
      toast.error(
        'Failed to connect WhatsApp: ' + (error.response?.data?.message || error.message)
      );
    }
  };

  const testConnection = async (serverId: string) => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      await axios.post(
        `${API_URL}/api/whatsapp/servers/${serverId}/test`,
        {},
        {
          headers: { Authorization: token },
        }
      );

      toast.success('WhatsApp connection successful!');
    } catch (error: any) {
      toast.error('Connection test failed: ' + (error.response?.data?.message || error.message));
    }
  };

  const deleteServer = async (serverId: string) => {
    if (!confirm('Are you sure you want to delete this WhatsApp server?')) return;

    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      await axios.delete(`${API_URL}/api/whatsapp/servers/${serverId}`, {
        headers: { Authorization: token },
      });

      toast.success('WhatsApp server deleted successfully');
      fetchWhatsAppServers();
    } catch (error: any) {
      toast.error('Failed to delete server: ' + (error.response?.data?.message || error.message));
    }
  };

  const toggleStatus = async (serverId: string, isActive: boolean) => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      await axios.put(
        `${API_URL}/api/whatsapp/servers/${serverId}`,
        { isActive: !isActive },
        {
          headers: { Authorization: token },
        }
      );

      toast.success(`Server ${!isActive ? 'enabled' : 'disabled'} successfully`);
      fetchWhatsAppServers();
    } catch (error: any) {
      toast.error('Failed to update server: ' + (error.response?.data?.message || error.message));
    }
  };

  useEffect(() => {
    fetchWhatsAppServers();
  }, []);

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">WhatsApp Accounts</h2>
        <Button variant="primary" onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? 'Cancel' : 'Add WhatsApp Account'}
        </Button>
      </div>

      {showAddForm && (
        <div className="bg-white p-6 rounded-lg shadow-md mb-6">
          <h3 className="text-lg font-semibold mb-4">Connect WhatsApp Business Account</h3>
          <div className="grid gap-4">
            <FormInput
              label="Display Name *"
              name="displayName"
              placeholder="My WhatsApp Business"
              value={formData.displayName}
              onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
            />
            <FormInput
              label="Phone Number ID * (from Meta App Dashboard)"
              name="phoneNumberId"
              placeholder="123456789012345"
              value={formData.phoneNumberId}
              onChange={(e) => setFormData({ ...formData, phoneNumberId: e.target.value })}
            />
            <FormInput
              label="Business ID (from Meta App Dashboard)"
              name="businessId"
              placeholder="your_business_id"
              value={formData.businessId}
              onChange={(e) => setFormData({ ...formData, businessId: e.target.value })}
            />
            <FormInput
              label="Phone Number (for display)"
              name="phoneNumber"
              placeholder="+1234567890"
              value={formData.phoneNumber}
              onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
            />
            <FormInput
              label="Access Token * (Permanent Token)"
              name="accessToken"
              placeholder="EAAG..."
              type="password"
              value={formData.accessToken}
              onChange={(e) => setFormData({ ...formData, accessToken: e.target.value })}
            />
            <div className="flex gap-2">
              <Button variant="primary" onClick={createWhatsAppServer}>
                Connect WhatsApp
              </Button>
            </div>
          </div>
          <div className="mt-4 p-4 bg-blue-50 rounded-lg">
            <h4 className="font-semibold text-blue-800 mb-2">📋 How to get these values:</h4>
            <ol className="text-sm text-blue-700 list-decimal list-inside space-y-1">
              <li>
                Go to{' '}
                <a
                  href="https://developers.facebook.com/apps"
                  target="_blank"
                  className="underline"
                >
                  Meta Developers
                </a>
              </li>
              <li>Create or select your app</li>
              <li>Add WhatsApp product</li>
              <li>Go to WhatsApp → API Setup</li>
              <li>Copy the Phone Number ID and generate an Access Token</li>
            </ol>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500 mx-auto"></div>
          <p className="mt-2 text-gray-600">Loading WhatsApp accounts...</p>
        </div>
      ) : servers.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <p>No WhatsApp accounts connected yet.</p>
          <p className="text-sm mt-2">Add a WhatsApp account to start creating automations.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {servers.map((server) => (
            <div key={server.id} className="bg-white p-6 rounded-lg shadow-md">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <span className="text-green-500">📱</span>
                    {server.displayName}
                  </h3>
                  <p className="text-sm text-gray-600">Phone: {server.phoneNumber || 'Not set'}</p>
                  <p className="text-sm text-gray-600">
                    Created: {new Date(server.createdAt).toLocaleDateString()}
                  </p>
                  <p className="text-sm text-gray-600">Triggers: {server.triggers?.length || 0}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-1 text-xs rounded-full ${
                      server.webhookVerified
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-yellow-100 text-yellow-800'
                    }`}
                  >
                    {server.webhookVerified ? 'Webhook ✓' : 'Webhook Pending'}
                  </span>
                  <span
                    className={`px-2 py-1 text-xs rounded-full ${
                      server.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {server.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" size="md" onClick={() => testConnection(server.id)}>
                  Test Connection
                </Button>
                <Button
                  variant={server.isActive ? 'secondary' : 'primary'}
                  size="md"
                  onClick={() => toggleStatus(server.id, server.isActive)}
                >
                  {server.isActive ? 'Disable' : 'Enable'}
                </Button>
                <Button variant="link" size="md" onClick={() => deleteServer(server.id)}>
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

export default WhatsAppServerConfig;
