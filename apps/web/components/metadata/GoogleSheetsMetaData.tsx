'use client';
import { useState, useEffect } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import FormInput from '../FormInput';
import Button from '../Button';
import { API_URL } from '@/lib/config';
import { redirectToOAuth } from '@/lib/oauth';

export function extractSpreadsheetId(input: string): string {
  if (!input) return '';
  const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) {
    return match[1];
  }
  return input.trim();
}

export interface GoogleSheetsMetaDataProps {
  handleClick: (data: any) => void;
  selectedType: string;
  preSelectedServerId?: string;
  initialData?: {
    spreadsheetId?: string;
    sheetName?: string;
    serverId?: string;
  };
  initialServers?: Array<{ id: string; email: string }>;
  initialLoading?: boolean;
}

export const GoogleSheetsMetaData = ({
  handleClick,
  selectedType,
  preSelectedServerId,
  initialData,
  initialServers,
  initialLoading,
}: GoogleSheetsMetaDataProps) => {
  const [formData, setFormData] = useState({
    spreadsheetId: initialData?.spreadsheetId || '',
    sheetName: initialData?.sheetName || 'Sheet1',
    serverId:
      initialData?.serverId ||
      preSelectedServerId ||
      (initialServers && initialServers.length > 0 ? initialServers[0]!.id : ''),
  });
  const [servers, setServers] = useState<any[]>(initialServers || []);
  const [loading, setLoading] = useState(
    initialLoading !== undefined ? initialLoading : initialServers === undefined
  );
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    if (initialServers !== undefined) {
      if (preSelectedServerId) {
        setFormData((prev) => ({ ...prev, serverId: preSelectedServerId }));
      } else if (initialServers.length > 0 && !formData.serverId) {
        setFormData((prev) => ({ ...prev, serverId: initialServers[0]!.id }));
      }
      return;
    }

    const fetchServers = async () => {
      try {
        const response = await axios.get(`${API_URL}/api/sheets/servers`, {
          withCredentials: true, // Use httpOnly cookie for auth
        });

        const connectedServers = response?.data?.servers || [];
        setServers(connectedServers);

        if (preSelectedServerId) {
          setFormData((prev) => ({ ...prev, serverId: preSelectedServerId }));
        } else if (connectedServers.length > 0 && !formData.serverId) {
          setFormData((prev) => ({ ...prev, serverId: connectedServers[0].id }));
        }
      } catch (error) {
        console.error('Failed to fetch Google Sheets servers:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchServers();
  }, [preSelectedServerId, initialServers]);

  const handleConnectGoogle = async () => {
    try {
      setConnecting(true);
      localStorage.setItem('sheets_oauth_pending', 'true');

      const response = await axios.get(`${API_URL}/api/sheets/auth/initiate`, {
        withCredentials: true, // Use httpOnly cookie for auth
      });

      if (response?.data?.authUrl) {
        redirectToOAuth(response.data.authUrl);
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
    const rawValue = e.target.value;
    const value = e.target.name === 'spreadsheetId' ? extractSpreadsheetId(rawValue) : rawValue;
    setFormData({
      ...formData,
      [e.target.name]: value,
    });
  };

  const effectiveServerId = formData.serverId || (servers.length > 0 ? servers[0]!.id : '');
  const canSave = Boolean(formData.spreadsheetId?.trim() && effectiveServerId);

  if (loading) {
    return (
      <div className="meta-form">
        <p className="meta-form__text">Loading...</p>
      </div>
    );
  }

  if (servers.length === 0) {
    return (
      <div className="meta-form">
        <div className="meta-form__warning">
          <p className="meta-form__panel-title">📊 Connect Google Sheets</p>
          <p className="meta-form__panel-note">
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
    <div className="meta-form">
      {servers.length > 1 && (
        <div>
          <label className="meta-form__label">Google Account</label>
          <select
            name="serverId"
            value={effectiveServerId}
            onChange={handleFormDataChange}
            className="meta-form__input"
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
        value={formData.spreadsheetId}
        onChange={handleFormDataChange}
      />
      <p className="meta-form__hint">
        Find the ID in the URL: docs.google.com/spreadsheets/d/<strong>SPREADSHEET_ID</strong>/edit
      </p>
      <FormInput
        label="Sheet Name"
        name="sheetName"
        placeholder="Sheet1"
        value={formData.sheetName}
        onChange={handleFormDataChange}
      />
      <div className="meta-form__panel">
        <p className="meta-form__panel-title">📊 {selectedType}</p>
        <p className="meta-form__panel-note">
          This trigger fires when an existing row is modified. First poll seeds the state,
          subsequent polls detect changes.
        </p>
      </div>
      <Button
        variant="secondary"
        onClick={() => canSave && handleClick({ ...formData, serverId: effectiveServerId })}
        disabled={!canSave}
      >
        Save
      </Button>
    </div>
  );
};

export default GoogleSheetsMetaData;
