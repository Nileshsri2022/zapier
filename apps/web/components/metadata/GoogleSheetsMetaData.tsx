'use client';
import { useState, useEffect } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import FormInput from '../FormInput';
import Button from '../Button';
import { API_URL } from '@/lib/config';

interface GoogleSheetsMetaDataProps {
  handleClick: (data: any) => void;
  selectedType: string;
  preSelectedServerId?: string;
}

const GoogleSheetsMetaData = ({
  handleClick,
  selectedType,
  preSelectedServerId,
}: GoogleSheetsMetaDataProps) => {
  const [formData, setFormData] = useState({
    spreadsheetId: '',
    sheetName: 'Sheet1',
    serverId: preSelectedServerId || '',
  });
  const [servers, setServers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    const fetchServers = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) return;

        const response = await axios.get(`${API_URL}/api/sheets/servers`, {
          headers: { Authorization: token },
        });

        const connectedServers = response?.data?.servers || [];
        setServers(connectedServers);

        if (preSelectedServerId) {
          setFormData((prev) => ({ ...prev, serverId: preSelectedServerId }));
        } else if (connectedServers.length > 0) {
          setFormData((prev) => ({ ...prev, serverId: connectedServers[0].id }));
        }
      } catch (error) {
        console.error('Failed to fetch Google Sheets servers:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchServers();
  }, [preSelectedServerId]);

  const handleConnectGoogle = async () => {
    try {
      setConnecting(true);
      const token = localStorage.getItem('token');
      if (!token) {
        toast.error('Please log in first');
        return;
      }

      localStorage.setItem('sheets_oauth_pending', 'true');

      const response = await axios.get(`${API_URL}/api/sheets/auth/initiate`, {
        headers: { Authorization: token },
      });

      if (response?.data?.authUrl) {
        window.location.href = response.data.authUrl;
      } else {
        toast.error('Failed to get OAuth URL');
      }
    } catch (error: any) {
      console.error('OAuth error:', error);
      toast.error(error?.response?.data?.error || 'Failed to connect Google');
    } finally {
      setConnecting(false);
    }
  };

  const handleFormDataChange = (e: any) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  if (loading) {
    return (
      <div className="my-4 flex flex-col gap-4 text-secondary-500">
        <p className="text-sm">Loading...</p>
      </div>
    );
  }

  if (servers.length === 0) {
    return (
      <div className="my-4 flex flex-col gap-4 text-secondary-500">
        <div className="bg-yellow-50 border border-yellow-200 rounded p-4 text-sm text-yellow-700">
          <p className="font-medium">📊 Connect Google Sheets</p>
          <p className="mt-1 text-xs">
            You need to connect your Google account to use Google Sheets triggers.
          </p>
        </div>
        <Button variant="secondary" onClick={connecting ? () => {} : handleConnectGoogle}>
          {connecting ? 'Connecting...' : '🔗 Connect Google Account'}
        </Button>
      </div>
    );
  }

  return (
    <div className="my-4 flex flex-col gap-4 text-secondary-500">
      {servers.length > 1 && (
        <div>
          <label className="block text-sm font-medium mb-1">Google Account</label>
          <select
            name="serverId"
            value={formData.serverId}
            onChange={handleFormDataChange}
            className="w-full p-2 border rounded text-sm"
          >
            {servers.map((server: any) => (
              <option key={server.id} value={server.id}>
                {server.email}
              </option>
            ))}
          </select>
        </div>
      )}
      <FormInput
        label="Spreadsheet ID"
        name="spreadsheetId"
        placeholder="Enter the ID from the spreadsheet URL"
        onChange={handleFormDataChange}
      />
      <p className="text-xs text-gray-500">
        Find the ID in the URL: docs.google.com/spreadsheets/d/<strong>SPREADSHEET_ID</strong>/edit
      </p>
      <FormInput
        label="Sheet Name"
        name="sheetName"
        placeholder="Sheet1"
        onChange={handleFormDataChange}
      />
      <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-700">
        <p className="font-medium">📊 {selectedType}</p>
        <p className="mt-1 text-xs">
          This trigger fires when an existing row is modified. First poll seeds the state,
          subsequent polls detect changes.
        </p>
      </div>
      <Button variant="secondary" onClick={() => handleClick(formData)}>
        Save
      </Button>
    </div>
  );
};

export default GoogleSheetsMetaData;
