'use client';
import React, { useState } from 'react';
import GmailServerConfig from './GmailServerConfig';
import GmailTriggerConfig from './GmailTriggerConfig';
import GmailActionConfig from './GmailActionConfig';
import GmailStatusMonitor from './GmailStatusMonitor';

type TabType = 'servers' | 'triggers' | 'actions' | 'monitor';

const GmailDashboard = () => {
  const [activeTab, setActiveTab] = useState<TabType>('servers');

  const tabs = [
    { id: 'servers' as TabType, label: 'Gmail Servers', icon: '🏠' },
    { id: 'triggers' as TabType, label: 'Email Triggers', icon: '⚡' },
    { id: 'actions' as TabType, label: 'Email Actions', icon: '🎯' },
    { id: 'monitor' as TabType, label: 'Status Monitor', icon: '📊' },
  ];

  const renderContent = () => {
    switch (activeTab) {
      case 'servers':
        return <GmailServerConfig />;
      case 'triggers':
        return <GmailTriggerConfig />;
      case 'actions':
        return <GmailActionConfig />;
      case 'monitor':
        return <GmailStatusMonitor />;
      default:
        return <GmailServerConfig />;
    }
  };

  return (
    <div className="gmail-dashboard">
      {/* Header */}
      <div className="gmail-dashboard__bar">
        <div className="gmail-shell">
          <div className="gmail-dashboard__head">
            <div>
              <h1 className="gmail-dashboard__title">Gmail Integration</h1>
              <p className="gmail-dashboard__subtitle">
                Connect your Gmail accounts and create powerful email automations
              </p>
            </div>
            <div className="gmail-dashboard__meta">
              <div className="gmail-dashboard__meta-block">
                <p className="gmail-dashboard__meta-title">Gmail MCP Server</p>
                <p className="gmail-dashboard__meta-note">Real-time email automation</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="gmail-tabs-bar">
        <div className="gmail-shell">
          <nav className="gmail-tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="gmail-tab"
                data-active={activeTab === tab.id}
              >
                <span className="gmail-tab__icon">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Main Content */}
      <main className="gmail-shell gmail-main">{renderContent()}</main>

      {/* Footer */}
      <footer className="gmail-footer">
        <div className="gmail-shell gmail-footer__inner">
          <div className="gmail-footer__grid">
            <div>
              <h3 className="gmail-footer__title">Gmail Integration</h3>
              <p className="gmail-footer__text">
                Connect your Gmail accounts to create powerful email automation workflows.
              </p>
            </div>
            <div>
              <h3 className="gmail-footer__title">Features</h3>
              <ul className="gmail-footer__list">
                <li>• Real-time email triggers</li>
                <li>• Advanced email actions</li>
                <li>• Rate limiting & error handling</li>
                <li>• OAuth 2.0 authentication</li>
              </ul>
            </div>
            <div>
              <h3 className="gmail-footer__title">Support</h3>
              <p className="gmail-footer__text">
                Gmail API integration with comprehensive monitoring and error handling.
              </p>
            </div>
          </div>
          <div className="gmail-footer__bottom">
            <p className="gmail-footer__note">
              © 2024 ZapMate Gmail Integration. Built with Gmail API.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default GmailDashboard;
