'use client';
import axios from 'axios';
import React, { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { toast } from 'react-toastify';
import { API_URL } from '@/lib/config';
import { redirectToOAuth, savePendingSelection } from '@/lib/oauth';

// Import types and constants from modal/
import { App, AvailableItem } from './modal/types';
import { APPS } from './modal/constants';
import type { TSelectedAction } from '@repo/types';

// Import metadata components
import {
  AiMetaData,
  EmailMetaData,
  SolanaMetaData,
  WebhookMetaData,
  GmailMetaData,
  GoogleSheetsMetaData,
  GoogleCalendarMetaData,
  ScheduleMetaData,
  GitHubMetaData,
  DiscordMetaData,
} from './metadata';

// APPS and types are now imported from ./modal/

const Modal = ({
  isVisible,
  setIsVisible,
  onClick,
  initialAiAction,
  zapId,
}: {
  initialAiAction?: TSelectedAction;
  isVisible: number;
  setIsVisible: Dispatch<SetStateAction<number>>;
  onClick?: (selectedItem: any) => void;
  zapId?: string;
}) => {
  const [availableItems, setAvailableItems] = useState<AvailableItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<any>(
    initialAiAction ? { id: initialAiAction.availableActionId, type: 'AI Transform' } : undefined
  );

  // New state for 3-step flow
  const [step, setStep] = useState<1 | 2 | 3>(initialAiAction ? 3 : 1); // 1=App select, 2=Config, 3=Metadata
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

    // WhatsApp/Telegram have no metadata form, but the Zap needs the chosen
    // server/bot so createZap can persist the provider trigger row.
    let itemWithAccount = selectedItem;
    if (selectedServerId && selectedApp?.id === 'whatsapp') {
      itemWithAccount = {
        ...selectedItem,
        metadata: { ...(selectedItem.metadata || {}), serverId: selectedServerId },
      };
    } else if (selectedServerId && selectedApp?.id === 'telegram') {
      itemWithAccount = {
        ...selectedItem,
        metadata: { ...(selectedItem.metadata || {}), botId: selectedServerId },
      };
    }

    // Check if needs metadata form
    const needsMetadata =
      selectedItem.type.includes('Google Sheets') ||
      selectedItem.type.includes('Google Calendar') ||
      selectedItem.type.includes('Gmail') ||
      selectedItem.type === 'Email' ||
      selectedItem.type === 'Solana' ||
      selectedItem.type === 'AI Transform' ||
      selectedItem.type === 'Discord Send Message' ||
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
      onClick && onClick(itemWithAccount);
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
    <div className="modal-step1">
      {/* Left Sidebar */}
      <div className="modal-sidebar">
        <div className="modal-tab">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            width="16"
            height="16"
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
      <div className="modal-app-panel">
        {getAvailableApps().length === 0 ? (
          <div className="modal-notice">Loading apps...</div>
        ) : (
          <div className="modal-app-list">
            {getAvailableApps().map((app) => (
              <button
                type="button"
                key={app.id}
                onClick={() => handleAppSelect(app)}
                className="modal-app-item"
              >
                <img className="modal-app-icon" alt={app.name} src={app.icon} />
                <span className="modal-app-name">{app.name}</span>
              </button>
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
      <div className="modal-step2">
        {/* App Selection */}
        <div className="modal-field">
          <label className="modal-field-label">App</label>
          <div className="modal-selected-app">
            <div className="modal-app-pill">
              <img className="modal-app-icon" alt={selectedApp?.name} src={selectedApp?.icon} />
              <span className="modal-app-name">{selectedApp?.name}</span>
            </div>
            <button type="button" onClick={() => setStep(1)} className="modal-change-btn">
              Change
            </button>
          </div>
        </div>

        {/* Event Dropdown */}
        <div className="modal-field">
          <label className="modal-field-label">
            {isVisible === 1 ? 'Trigger Event' : 'Action Event'}
          </label>
          <select
            value={selectedEvent}
            onChange={(e) => handleEventChange(e.target.value)}
            className="modal-select"
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
          <div className="modal-field">
            <label className="modal-field-label">
              {selectedApp?.id === 'telegram' || selectedApp?.id === 'whatsapp'
                ? 'Bot Account'
                : 'Connected Account'}
            </label>
            {loadingServers ? (
              <div className="modal-help-text">Loading accounts...</div>
            ) : connectedServers.length > 0 && !showBotForm ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <select
                  value={selectedServerId}
                  onChange={(e) => setSelectedServerId(e.target.value)}
                  className="modal-select"
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
                    className="modal-link-btn"
                  >
                    + Add another {selectedApp.name}
                  </button>
                )}
              </div>
            ) : selectedApp?.id === 'telegram' || selectedApp?.id === 'whatsapp' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                {showBotForm || connectedServers.length === 0 ? (
                  <>
                    <input
                      type="text"
                      placeholder={
                        selectedApp.id === 'telegram' ? 'Bot Name (e.g. MyZapBot)' : 'Display Name'
                      }
                      value={botName}
                      onChange={(e) => setBotName(e.target.value)}
                      className="modal-input"
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
                      className="modal-input"
                    />
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        type="button"
                        onClick={connectBot}
                        disabled={connectingBot}
                        className="modal-btn-primary"
                      >
                        {connectingBot ? 'Connecting...' : `Connect ${selectedApp.name}`}
                      </button>
                      {connectedServers.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setShowBotForm(false)}
                          className="modal-btn-secondary"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                    <p className="modal-help-text">
                      {selectedApp.id === 'telegram'
                        ? 'Get your token from @BotFather in Telegram. The webhook will be configured automatically.'
                        : 'Get your token from Meta Developer Portal.'}
                    </p>
                  </>
                ) : null}
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div
                  className="modal-app-pill"
                  style={{ color: 'hsl(var(--muted-foreground))', fontSize: '0.875rem' }}
                >
                  Connect {selectedApp?.name}
                </div>
                <button type="button" onClick={handleSignIn} className="modal-btn-primary">
                  Sign in
                </button>
              </div>
            )}
          </div>
        )}

        {/* Continue / Status Bar */}
        <div style={{ marginTop: '0.75rem' }}>
          {!canContinue() ? (
            <div className="modal-notice">
              Choose an event
              {needsAccount && connectedServers.length === 0 ? ' and connect your account' : ''} to
              continue
            </div>
          ) : (
            <button type="button" onClick={handleContinue} className="modal-btn-continue">
              Continue
            </button>
          )}
        </div>
      </div>
    );
  };

  // ============ STEP 3: Metadata Forms ============
  const renderStep3 = () => {
    if (isVisible === 1) {
      // Trigger metadata forms
      return (
        <div className="modal-step3">
          <button type="button" onClick={() => setStep(2)} className="modal-back-btn">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              width="16"
              height="16"
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
            <WebhookMetaData handleClick={handleSaveMetaData} zapId={zapId} />
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
            <GitHubMetaData
              handleClick={handleSaveMetaData}
              selectedType={selectedItem?.type}
              zapId={zapId}
            />
          ) : selectedItem?.type?.includes('Gmail') ? (
            <GmailMetaData
              handleClick={handleSaveMetaData}
              selectedType={selectedItem?.type}
              preSelectedServerId={selectedServerId}
            />
          ) : (
            <div className="modal-notice">No configuration needed</div>
          )}
        </div>
      );
    } else {
      // Action metadata forms
      return (
        <div className="modal-step3">
          <button type="button" onClick={() => setStep(2)} className="modal-back-btn">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              width="16"
              height="16"
            >
              <path
                fillRule="evenodd"
                d="M17 10a.75.75 0 0 1-.75.75H5.612l4.158 3.96a.75.75 0 1 1-1.04 1.08l-5.5-5.25a.75.75 0 0 1 0-1.08l5.5-5.25a.75.75 0 1 1 1.04 1.08L5.612 9.25H16.25A.75.75 0 0 1 17 10Z"
                clipRule="evenodd"
              />
            </svg>
            Back to action selection
          </button>
          {selectedItem?.type === 'AI Transform' ? (
            <AiMetaData
              handleClick={handleSaveMetaData}
              initialData={initialAiAction?.actionMetaData}
            />
          ) : selectedItem?.type === 'Email' ? (
            <EmailMetaData handleClick={handleSaveMetaData} />
          ) : selectedItem?.type === 'Solana' ? (
            <SolanaMetaData handleClick={handleSaveMetaData} />
          ) : selectedItem?.type?.includes('Gmail') ? (
            <GmailMetaData handleClick={handleSaveMetaData} selectedType={selectedItem?.type} />
          ) : selectedItem?.type === 'Discord Send Message' ? (
            <DiscordMetaData handleClick={handleSaveMetaData} />
          ) : (
            <div className="modal-notice">No configuration needed</div>
          )}
        </div>
      );
    }
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setIsVisible(0);
          resetModal();
        }
      }}
    >
      <div className="modal-dialog">
        {/* Header */}
        <div className="modal-header">
          <h3 className="modal-title">
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
            className="modal-close-btn"
            aria-label="Close dialog"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              width="16"
              height="16"
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
