'use client';
import axios from 'axios';
import React, { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { toast } from 'react-toastify';
import { API_URL } from '@/lib/config';

// Import types and constants from modal/
import { App, AvailableItem } from './modal/types';
import { APPS } from './modal/constants';

// Import metadata components
import {
  EmailMetaData,
  SolanaMetaData,
  WebhookMetaData,
  GmailMetaData,
  GoogleSheetsMetaData,
  GoogleCalendarMetaData,
  ScheduleMetaData,
  GitHubMetaData,
} from './metadata';

// APPS and types are now imported from ./modal/

const Modal = ({
  isVisible,
  setIsVisible,
  onClick,
}: {
  isVisible: number;
  setIsVisible: Dispatch<SetStateAction<number>>;
  onClick?: (selectedItem: any) => void;
}) => {
  const [availableItems, setAvailableItems] = useState<AvailableItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<any>();

  // New state for 3-step flow
  const [step, setStep] = useState<1 | 2 | 3>(1); // 1=App select, 2=Config, 3=Metadata
  const [selectedApp, setSelectedApp] = useState<App | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<string>('');

  // For Google Sheets/Gmail account connection
  const [connectedServers, setConnectedServers] = useState<any[]>([]);
  const [selectedServerId, setSelectedServerId] = useState<string>('');
  const [loadingServers, setLoadingServers] = useState(false);

  // For Telegram/WhatsApp bot connection
  const [showBotForm, setShowBotForm] = useState(false);
  const [botToken, setBotToken] = useState('');
  const [botName, setBotName] = useState('');
  const [connectingBot, setConnectingBot] = useState(false);

  const handleSaveMetaData = (data: any) => {
    onClick && onClick({ ...selectedItem, metadata: data });
    resetModal();
  };

  const resetModal = () => {
    setStep(1);
    setSelectedApp(null);
    setSelectedEvent('');
    setSelectedItem(null);
    setConnectedServers([]);
    setSelectedServerId('');
    setShowBotForm(false);
    setBotToken('');
    setBotName('');
  };

  const fetchAvailableTriggers = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/triggers`, {
        withCredentials: true, // Use httpOnly cookie for auth
      });
      setAvailableItems(response?.data?.avialableTriggers || []);
    } catch (error) {
      toast.error(error as string);
    }
  };

  const fetchAvailableActions = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/actions`, {
        withCredentials: true, // Use httpOnly cookie for auth
      });
      setAvailableItems(response?.data?.availableActions || []);
    } catch (error) {
      toast.error(error as string);
    }
  };

  // Fetch connected accounts for OAuth apps and bots
  const fetchConnectedAccounts = async (app: App) => {
    if (
      app.id !== 'sheets' &&
      app.id !== 'gmail' &&
      app.id !== 'calendar' &&
      app.id !== 'telegram' &&
      app.id !== 'whatsapp'
    ) {
      return;
    }

    setLoadingServers(true);
    try {
      let endpoint = '';
      if (app.id === 'sheets') endpoint = '/api/sheets/servers';
      else if (app.id === 'gmail') endpoint = '/api/gmail/servers';
      else if (app.id === 'calendar') endpoint = '/api/calendar/servers';
      else if (app.id === 'telegram') endpoint = '/api/telegram/bots';
      else if (app.id === 'whatsapp') endpoint = '/api/whatsapp/servers';

      const response = await axios.get(`${API_URL}${endpoint}`, {
        withCredentials: true, // Use httpOnly cookie for auth
      });

      const servers = response?.data?.servers || response?.data?.bots || [];
      setConnectedServers(servers);
      if (servers.length > 0) {
        setSelectedServerId(servers[0].id);
      }
    } catch (error) {
      console.error('Failed to fetch connected accounts:', error);
    } finally {
      setLoadingServers(false);
    }
  };

  useEffect(() => {
    if (step === 1 && isVisible !== 0) {
      if (isVisible === 1) {
        fetchAvailableTriggers();
      } else if (isVisible > 1) {
        fetchAvailableActions();
      }
    }

    return () => {
      if (isVisible === 0) {
        resetModal();
        setAvailableItems([]);
      }
    };
  }, [isVisible, step]);

  // Get events for a specific app
  const getEventsForApp = (app: App): AvailableItem[] => {
    return availableItems.filter((item) => {
      if (app.exact) {
        return item.type === app.exact;
      }
      if (app.prefix) {
        return item.type.startsWith(app.prefix);
      }
      return false;
    });
  };

  // Get available apps (only show apps that have events)
  const getAvailableApps = (): App[] => {
    return APPS.filter((app) => getEventsForApp(app).length > 0);
  };

  // Handle app selection
  const handleAppSelect = (app: App) => {
    setSelectedApp(app);
    setSelectedEvent('');
    fetchConnectedAccounts(app);
    setStep(2);
  };

  // Handle event selection from dropdown
  const handleEventChange = (eventId: string) => {
    setSelectedEvent(eventId);
    const event = availableItems.find((item) => item.id === eventId);
    if (event) {
      setSelectedItem(event);
    }
  };

  // Handle continue button
  const handleContinue = () => {
    if (!selectedItem) return;

    // Check if needs metadata form
    const needsMetadata =
      selectedItem.type.includes('Google Sheets') ||
      selectedItem.type.includes('Google Calendar') ||
      selectedItem.type.includes('Gmail') ||
      selectedItem.type === 'Email' ||
      selectedItem.type === 'Solana' ||
      selectedItem.type.startsWith('Schedule'); // Add Schedule

    if (needsMetadata) {
      // Add serverId to metadata for OAuth apps
      if (
        selectedApp?.id === 'sheets' ||
        selectedApp?.id === 'gmail' ||
        selectedApp?.id === 'calendar'
      ) {
        setSelectedItem({ ...selectedItem, serverId: selectedServerId });
      }
      setStep(3);
    } else {
      onClick && onClick(selectedItem);
      resetModal();
      setIsVisible(0);
    }
  };

  // Handle OAuth sign in
  const handleSignIn = async () => {
    if (!selectedApp) return;

    try {
      localStorage.setItem('oauth_pending', 'true');

      let endpoint = '/api/gmail/auth/initiate';
      let method: 'get' | 'post' = 'post';
      let body: any = { name: 'Gmail Account' };

      if (selectedApp.id === 'sheets') {
        endpoint = '/api/sheets/auth/initiate';
        method = 'get';
        body = null;
      } else if (selectedApp.id === 'calendar') {
        endpoint = '/api/calendar/auth/initiate';
        method = 'get';
        body = null;
      }

      const response =
        method === 'post'
          ? await axios.post(`${API_URL}${endpoint}`, body, {
              withCredentials: true, // Use httpOnly cookie for auth
            })
          : await axios.get(`${API_URL}${endpoint}`, {
              withCredentials: true, // Use httpOnly cookie for auth
            });

      if (response?.data?.authUrl) {
        window.location.href = response.data.authUrl;
      } else {
        toast.error('Failed to get OAuth URL');
      }
    } catch (error: any) {
      console.error('OAuth error:', error);
      toast.error(error?.response?.data?.message || 'Failed to connect');
    }
  };

  // Connect Telegram/WhatsApp bot with token
  const connectBot = async () => {
    if (!selectedApp || !botToken.trim() || !botName.trim()) {
      toast.error('Please enter bot name and token');
      return;
    }

    setConnectingBot(true);
    try {
      const endpoint =
        selectedApp.id === 'telegram' ? '/api/telegram/bots' : '/api/whatsapp/servers';
      const payload =
        selectedApp.id === 'telegram'
          ? { botToken: botToken.trim(), botName: botName.trim() }
          : {
              displayName: botName.trim(),
              accessToken: botToken.trim(),
              phoneNumberId: '',
              businessId: '',
              phoneNumber: '',
            };

      await axios.post(`${API_URL}${endpoint}`, payload, {
        withCredentials: true, // Use httpOnly cookie for auth
      });

      toast.success(`${selectedApp.name} connected successfully!`);
      setShowBotForm(false);
      setBotToken('');
      setBotName('');
      // Refresh the list
      fetchConnectedAccounts(selectedApp);
    } catch (error: any) {
      console.error('Bot connect error:', error);
      toast.error(error?.response?.data?.message || 'Failed to connect');
    } finally {
      setConnectingBot(false);
    }
  };

  // Check if can continue (event selected + account for OAuth apps)
  const canContinue = () => {
    if (!selectedEvent) return false;
    const needsAccountApps = ['sheets', 'gmail', 'calendar', 'telegram', 'whatsapp'];
    if (selectedApp && needsAccountApps.includes(selectedApp.id) && !selectedServerId) {
      return false;
    }
    return true;
  };

  // ============ STEP 1: App Selector ============
  const renderStep1 = () => (
    <div className="flex min-h-[400px]">
      {/* Left Sidebar - Hidden on very small screens */}
      <div className="hidden sm:block w-40 border-r border-gray-200 p-3 bg-gray-50">
        <div className="flex items-center gap-2 p-2 rounded bg-amber-100 text-amber-800 font-medium text-sm">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="w-4 h-4"
          >
            <path
              fillRule="evenodd"
              d="M4.25 2A2.25 2.25 0 0 0 2 4.25v2.5A2.25 2.25 0 0 0 4.25 9h2.5A2.25 2.25 0 0 0 9 6.75v-2.5A2.25 2.25 0 0 0 6.75 2h-2.5Zm0 9A2.25 2.25 0 0 0 2 13.25v2.5A2.25 2.25 0 0 0 4.25 18h2.5A2.25 2.25 0 0 0 9 15.75v-2.5A2.25 2.25 0 0 0 6.75 11h-2.5Zm9-9A2.25 2.25 0 0 0 11 4.25v2.5A2.25 2.25 0 0 0 13.25 9h2.5A2.25 2.25 0 0 0 18 6.75v-2.5A2.25 2.25 0 0 0 15.75 2h-2.5Zm0 9A2.25 2.25 0 0 0 11 13.25v2.5A2.25 2.25 0 0 0 13.25 18h2.5A2.25 2.25 0 0 0 18 15.75v-2.5A2.25 2.25 0 0 0 15.75 11h-2.5Z"
              clipRule="evenodd"
            />
          </svg>
          Apps
        </div>
      </div>

      {/* Right Panel - App List */}
      <div className="flex-1 p-4 overflow-y-auto">
        {getAvailableApps().length === 0 ? (
          <div className="text-center text-gray-500 py-4">Loading apps...</div>
        ) : (
          <div className="flex flex-col gap-1">
            {getAvailableApps().map((app) => (
              <div
                key={app.id}
                onClick={() => handleAppSelect(app)}
                className="flex items-center gap-3 p-3 cursor-pointer rounded-lg hover:bg-gray-100 transition-colors"
              >
                <img className="h-6 w-6" alt={app.name} src={app.icon} />
                <span className="font-medium">{app.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // ============ STEP 2: Configuration Panel ============
  const renderStep2 = () => {
    const events = selectedApp ? getEventsForApp(selectedApp) : [];
    const needsAccount =
      selectedApp?.id === 'sheets' ||
      selectedApp?.id === 'gmail' ||
      selectedApp?.id === 'calendar' ||
      selectedApp?.id === 'telegram' ||
      selectedApp?.id === 'whatsapp';

    return (
      <div className="p-4 min-h-[400px]">
        {/* App Selection */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">App *</label>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg flex-1">
              <img className="h-5 w-5" alt={selectedApp?.name} src={selectedApp?.icon} />
              <span>{selectedApp?.name}</span>
            </div>
            <button
              onClick={() => setStep(1)}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm font-medium"
            >
              Change
            </button>
          </div>
        </div>

        {/* Event Dropdown */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {isVisible === 1 ? 'Trigger event' : 'Action event'} *
          </label>
          <select
            value={selectedEvent}
            onChange={(e) => handleEventChange(e.target.value)}
            className="w-full p-3 border border-gray-300 rounded-lg text-gray-700 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
          >
            <option value="">Choose an event</option>
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.type}
              </option>
            ))}
          </select>
        </div>

        {/* Account Section (for OAuth apps and bots) */}
        {needsAccount && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {selectedApp?.id === 'telegram' || selectedApp?.id === 'whatsapp'
                ? 'Bot/Account *'
                : 'Account *'}
            </label>
            {loadingServers ? (
              <div className="text-gray-500 py-2">Loading accounts...</div>
            ) : connectedServers.length > 0 && !showBotForm ? (
              <div className="space-y-2">
                <select
                  value={selectedServerId}
                  onChange={(e) => setSelectedServerId(e.target.value)}
                  className="w-full p-3 border border-gray-300 rounded-lg text-gray-700 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                >
                  {connectedServers.map((server) => (
                    <option key={server.id} value={server.id}>
                      {server.email
                        ? server.email
                        : server.botUsername
                          ? `@${server.botUsername}`
                          : server.botName || server.displayName || server.name || 'Account'}
                    </option>
                  ))}
                </select>
                {(selectedApp?.id === 'telegram' || selectedApp?.id === 'whatsapp') && (
                  <button
                    onClick={() => setShowBotForm(true)}
                    className="text-sm text-purple-600 hover:text-purple-800"
                  >
                    + Add another {selectedApp.name}
                  </button>
                )}
              </div>
            ) : selectedApp?.id === 'telegram' || selectedApp?.id === 'whatsapp' ? (
              <div className="space-y-3">
                {showBotForm || connectedServers.length === 0 ? (
                  <>
                    <input
                      type="text"
                      placeholder={
                        selectedApp.id === 'telegram' ? 'Bot Name (e.g. MyZapBot)' : 'Display Name'
                      }
                      value={botName}
                      onChange={(e) => setBotName(e.target.value)}
                      className="w-full p-3 border border-gray-300 rounded-lg text-gray-700 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    />
                    <input
                      type="password"
                      placeholder={
                        selectedApp.id === 'telegram'
                          ? 'Bot Token from @BotFather'
                          : 'Access Token from Meta'
                      }
                      value={botToken}
                      onChange={(e) => setBotToken(e.target.value)}
                      className="w-full p-3 border border-gray-300 rounded-lg text-gray-700 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={connectBot}
                        disabled={connectingBot}
                        className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm font-medium disabled:opacity-50"
                      >
                        {connectingBot ? 'Connecting...' : `Connect ${selectedApp.name}`}
                      </button>
                      {connectedServers.length > 0 && (
                        <button
                          onClick={() => setShowBotForm(false)}
                          className="px-4 py-2 text-gray-600 hover:text-gray-800 text-sm"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">
                      {selectedApp.id === 'telegram'
                        ? 'Get your token from @BotFather in Telegram. The webhook will be configured automatically.'
                        : 'Get your token from Meta Developer Portal.'}
                    </p>
                  </>
                ) : null}
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-gray-500">
                  Connect {selectedApp?.name}
                </div>
                <button
                  onClick={handleSignIn}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm font-medium"
                >
                  Sign in
                </button>
              </div>
            )}
          </div>
        )}

        {/* Continue / Status Bar */}
        <div className="mt-6">
          {!canContinue() ? (
            <div className="bg-blue-50 border border-blue-200 text-blue-700 text-center py-3 rounded-lg text-sm">
              To continue, choose an event
              {needsAccount && connectedServers.length === 0 ? ' and connect your account' : ''}
            </div>
          ) : (
            <button
              onClick={handleContinue}
              className="w-full py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium"
            >
              Continue
            </button>
          )}
        </div>
      </div>
    );
  };

  // ============ STEP 3: Metadata Forms (existing) ============
  const renderStep3 = () => {
    if (isVisible === 1) {
      // Trigger metadata forms
      return (
        <div className="p-4">
          <button
            onClick={() => setStep(2)}
            className="flex items-center gap-1 text-purple-600 hover:text-purple-800 mb-4 text-sm"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-4 h-4"
            >
              <path
                fillRule="evenodd"
                d="M17 10a.75.75 0 0 1-.75.75H5.612l4.158 3.96a.75.75 0 1 1-1.04 1.08l-5.5-5.25a.75.75 0 0 1 0-1.08l5.5-5.25a.75.75 0 1 1 1.04 1.08L5.612 9.25H16.25A.75.75 0 0 1 17 10Z"
                clipRule="evenodd"
              />
            </svg>
            Back
          </button>
          {selectedItem?.type === 'Webhook' ? (
            <WebhookMetaData handleClick={handleSaveMetaData} />
          ) : selectedItem?.type?.includes('Google Sheets') ? (
            <GoogleSheetsMetaData
              handleClick={handleSaveMetaData}
              selectedType={selectedItem?.type}
              preSelectedServerId={selectedServerId}
            />
          ) : selectedItem?.type?.includes('Google Calendar') ? (
            <GoogleCalendarMetaData
              handleClick={handleSaveMetaData}
              selectedType={selectedItem?.type}
              preSelectedServerId={selectedServerId}
            />
          ) : selectedItem?.type?.startsWith('Schedule') ? (
            <ScheduleMetaData
              handleClick={handleSaveMetaData}
              scheduleType={selectedItem?.type
                ?.replace('Schedule ', '')
                .toLowerCase()
                .replace(' ', '')}
            />
          ) : selectedItem?.type?.startsWith('GitHub') ? (
            <GitHubMetaData handleClick={handleSaveMetaData} selectedType={selectedItem?.type} />
          ) : (
            <div className="text-center text-gray-500 py-4">No configuration needed</div>
          )}
        </div>
      );
    } else {
      // Action metadata forms
      return (
        <div className="p-4">
          <button
            onClick={() => setStep(2)}
            className="flex items-center gap-1 text-purple-600 hover:text-purple-800 mb-4 text-sm"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-4 h-4"
            >
              <path
                fillRule="evenodd"
                d="M17 10a.75.75 0 0 1-.75.75H5.612l4.158 3.96a.75.75 0 1 1-1.04 1.08l-5.5-5.25a.75.75 0 0 1 0-1.08l5.5-5.25a.75.75 0 1 1 1.04 1.08L5.612 9.25H16.25A.75.75 0 0 1 17 10Z"
                clipRule="evenodd"
              />
            </svg>
            Back
          </button>
          {selectedItem?.type === 'Email' ? (
            <EmailMetaData handleClick={handleSaveMetaData} />
          ) : selectedItem?.type === 'Solana' ? (
            <SolanaMetaData handleClick={handleSaveMetaData} />
          ) : selectedItem?.type?.includes('Gmail') ? (
            <GmailMetaData handleClick={handleSaveMetaData} selectedType={selectedItem?.type} />
          ) : (
            <div className="text-center text-gray-500 py-4">No configuration needed</div>
          )}
        </div>
      );
    }
  };

  return (
    <div className="absolute justify-center items-center bg-modal-bg h-screen w-screen top-0 left-0 flex transition-all">
      <div className="bg-white w-screen h-screen xs:w-[95vw] xs:h-auto xs:max-h-[95vh] xs:rounded-lg sm:w-[90vw] md:w-[40rem] min-h-96 shadow-xl animate-zoom_in overflow-hidden overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50">
          <h3 className="font-semibold text-lg">
            {step === 1
              ? `Select ${isVisible === 1 ? 'Trigger' : 'Action'}`
              : step === 2
                ? `${isVisible === 1 ? '1. Select the event' : 'Configure action'}`
                : 'Configure'}
          </h3>
          <svg
            onClick={() => {
              setIsVisible(0);
              resetModal();
            }}
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="#000000"
            className="size-6 cursor-pointer hover:bg-gray-200 rounded p-1"
          >
            <path
              fillRule="evenodd"
              d="M5.47 5.47a.75.75 0 0 1 1.06 0L12 10.94l5.47-5.47a.75.75 0 1 1 1.06 1.06L13.06 12l5.47 5.47a.75.75 0 1 1-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 0 1-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 0 1 0-1.06Z"
              clipRule="evenodd"
            />
          </svg>
        </div>

        {/* Content */}
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
      </div>
    </div>
  );
};

export default Modal;
