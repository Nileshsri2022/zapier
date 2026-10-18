'use client';
import axios from 'axios';
import React, { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { toast } from 'react-toastify';
import { API_URL } from '@/lib/config';
import { redirectToOAuth, savePendingSelection } from '@/lib/oauth';

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

      // Save the pending selection before OAuth redirect
      savePendingSelection({
        selectedItem,
        selectedApp,
        modalFor: isVisible, // 1 = trigger, >1 = action index
      });

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
        redirectToOAuth(response.data.authUrl);
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
    <div className="flex min-h-[380px] max-h-[65vh]">
      {/* Left Sidebar - Hidden on very small screens */}
      <div className="hidden sm:block w-36 border-r border-border p-3 bg-muted/30">
        <div className="flex items-center gap-2 px-2.5 py-2 rounded-md bg-primary-500/10 text-primary-500 font-medium text-sm">
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
      <div className="flex-1 p-3 sm:p-4 overflow-y-auto">
        {getAvailableApps().length === 0 ? (
          <div className="text-center text-muted-foreground py-6 text-sm">Loading apps...</div>
        ) : (
          <div className="flex flex-col gap-1">
            {getAvailableApps().map((app) => (
              <div
                key={app.id}
                onClick={() => handleAppSelect(app)}
                className="flex items-center gap-3 p-2.5 cursor-pointer rounded-lg hover:bg-muted/70 transition-colors"
              >
                <img className="h-6 w-6 object-contain" alt={app.name} src={app.icon} />
                <span className="font-medium text-sm sm:text-base text-foreground">{app.name}</span>
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
      <div className="p-4 sm:p-5 min-h-[380px] max-h-[70vh] overflow-y-auto">
        {/* App Selection */}
        <div className="mb-4">
          <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
            App
          </label>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2.5 px-3 py-2 bg-muted/40 border border-border rounded-lg flex-1">
              <img className="h-5 w-5 object-contain" alt={selectedApp?.name} src={selectedApp?.icon} />
              <span className="font-medium text-sm text-foreground">{selectedApp?.name}</span>
            </div>
            <button
              type="button"
              onClick={() => setStep(1)}
              className="px-3.5 py-2 bg-muted hover:bg-muted/80 text-foreground border border-border rounded-lg transition-colors text-xs font-medium"
            >
              Change
            </button>
          </div>
        </div>

        {/* Event Dropdown */}
        <div className="mb-4">
          <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
            {isVisible === 1 ? 'Trigger Event' : 'Action Event'}
          </label>
          <select
            value={selectedEvent}
            onChange={(e) => handleEventChange(e.target.value)}
            className="w-full p-2.5 bg-background border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500"
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
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
              {selectedApp?.id === 'telegram' || selectedApp?.id === 'whatsapp'
                ? 'Bot Account'
                : 'Connected Account'}
            </label>
            {loadingServers ? (
              <div className="text-muted-foreground py-2 text-sm">Loading accounts...</div>
            ) : connectedServers.length > 0 && !showBotForm ? (
              <div className="space-y-2">
                <select
                  value={selectedServerId}
                  onChange={(e) => setSelectedServerId(e.target.value)}
                  className="w-full p-2.5 bg-background border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500"
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
                    type="button"
                    onClick={() => setShowBotForm(true)}
                    className="text-xs font-medium text-primary-500 hover:text-primary-600 transition-colors"
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
                      className="w-full p-2.5 bg-background border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500"
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
                      className="w-full p-2.5 bg-background border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={connectBot}
                        disabled={connectingBot}
                        className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors text-sm font-medium disabled:opacity-50"
                      >
                        {connectingBot ? 'Connecting...' : `Connect ${selectedApp.name}`}
                      </button>
                      {connectedServers.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setShowBotForm(false)}
                          className="px-4 py-2 text-muted-foreground hover:text-foreground text-sm"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {selectedApp.id === 'telegram'
                        ? 'Get your token from @BotFather in Telegram. The webhook will be configured automatically.'
                        : 'Get your token from Meta Developer Portal.'}
                    </p>
                  </>
                ) : null}
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="flex-1 px-3 py-2 border border-border rounded-lg text-muted-foreground text-sm bg-muted/20">
                  Connect {selectedApp?.name}
                </div>
                <button
                  type="button"
                  onClick={handleSignIn}
                  className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors text-sm font-medium shadow-sm"
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
            <div className="bg-muted/80 border border-border text-muted-foreground text-center py-2.5 px-3 rounded-lg text-xs font-medium">
              Choose an event
              {needsAccount && connectedServers.length === 0 ? ' and connect your account' : ''} to continue
            </div>
          ) : (
            <button
              type="button"
              onClick={handleContinue}
              className="w-full py-2.5 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors font-medium text-sm shadow-sm"
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
        <div className="p-4 sm:p-5 max-h-[70vh] overflow-y-auto">
          <button
            type="button"
            onClick={() => setStep(2)}
            className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground mb-4 text-xs font-medium transition-colors"
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
            Back to event selection
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
            <div className="text-center text-muted-foreground py-4 text-sm">No configuration needed</div>
          )}
        </div>
      );
    } else {
      // Action metadata forms
      return (
        <div className="p-4 sm:p-5 max-h-[70vh] overflow-y-auto">
          <button
            type="button"
            onClick={() => setStep(2)}
            className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground mb-4 text-xs font-medium transition-colors"
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
            Back to action selection
          </button>
          {selectedItem?.type === 'Email' ? (
            <EmailMetaData handleClick={handleSaveMetaData} />
          ) : selectedItem?.type === 'Solana' ? (
            <SolanaMetaData handleClick={handleSaveMetaData} />
          ) : selectedItem?.type?.includes('Gmail') ? (
            <GmailMetaData handleClick={handleSaveMetaData} selectedType={selectedItem?.type} />
          ) : (
            <div className="text-center text-muted-foreground py-4 text-sm">No configuration needed</div>
          )}
        </div>
      );
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 pt-16 sm:p-6 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setIsVisible(0);
          resetModal();
        }
      }}
    >
      <div className="bg-card border border-border text-foreground w-full max-w-xl max-h-[85vh] rounded-xl shadow-lift flex flex-col overflow-hidden my-auto animate-zoom_in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/40">
          <h3 className="font-semibold text-base sm:text-lg text-foreground tracking-tight">
            {step === 1
              ? `Select ${isVisible === 1 ? 'Trigger' : 'Action'}`
              : step === 2
                ? `${isVisible === 1 ? '1. Select Event' : 'Configure Action'}`
                : 'Configure Settings'}
          </h3>
          <button
            type="button"
            onClick={() => {
              setIsVisible(0);
              resetModal();
            }}
            className="size-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Close dialog"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="size-4"
            >
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 0 1 1.414 0L10 8.586l4.293-4.293a1 1 0 1 1 1.414 1.414L11.414 10l4.293 4.293a1 1 0 0 1-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 0 1-1.414-1.414L8.586 10 4.293 5.707a1 1 0 0 1 0-1.414Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
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
