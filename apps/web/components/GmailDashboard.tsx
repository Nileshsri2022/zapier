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
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Gmail Integration</h1>
              <p className="mt-1 text-sm text-gray-600">
                Connect your Gmail accounts and create powerful email automations
              </p>
            </div>
            <div className="flex items-center space-x-4">
              <div className="text-right">
                <p className="text-sm font-medium text-gray-900">Gmail MCP Server</p>
                <p className="text-xs text-gray-500">Real-time email automation</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex space-x-8">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <span className="mr-2">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto py-6">
        {renderContent()}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Gmail Integration</h3>
              <p className="text-xs text-gray-600">
                Connect your Gmail accounts to create powerful email automation workflows.
              </p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Features</h3>
              <ul className="text-xs text-gray-600 space-y-1">
                <li>• Real-time email triggers</li>
                <li>• Advanced email actions</li>
                <li>• Rate limiting & error handling</li>
                <li>• OAuth 2.0 authentication</li>
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Support</h3>
              <p className="text-xs text-gray-600">
                Gmail API integration with comprehensive monitoring and error handling.
              </p>
            </div>
          </div>
          <div className="mt-8 pt-8 border-t border-gray-200">
            <p className="text-xs text-gray-500 text-center">
              © 2024 ZapMate Gmail Integration. Built with Gmail API.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default GmailDashboard;
