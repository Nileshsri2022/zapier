'use client';
import React, { useState, useEffect } from 'react';
import { API_URL } from '@/lib/config';
import { MetaDataFormProps } from '../modal/types';

interface GitHubMetaDataProps extends MetaDataFormProps {
  zapId?: string;
  selectedType?: string;
}

/**
 * GitHub Trigger Configuration Component
 * Shows webhook URL and setup instructions for GitHub webhooks
 */
export const GitHubMetaData: React.FC<GitHubMetaDataProps> = ({
  handleClick,
  zapId,
  selectedType,
}) => {
  const [webhookUrl, setWebhookUrl] = useState<string>('');
  const [webhookSecret, setWebhookSecret] = useState<string>('');
  const [copied, setCopied] = useState<'url' | 'secret' | null>(null);

  // Generate webhook URL when zapId is available
  useEffect(() => {
    if (zapId) {
      setWebhookUrl(`${API_URL}/api/github/webhook/${zapId}`);
    } else {
      // Placeholder URL - will be generated after zap creation
      setWebhookUrl('{Will be generated after saving}');
    }
  }, [zapId]);

  // Generate a random webhook secret
  const generateSecret = () => {
    const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    setWebhookSecret(secret);
  };

  const copyToClipboard = async (text: string, type: 'url' | 'secret') => {
    await navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleSave = () => {
    handleClick({
      webhookSecret: webhookSecret || undefined,
      eventType: selectedType?.replace('GitHub ', '').toLowerCase(),
    });
  };

  // Get event type label
  const getEventLabel = () => {
    if (selectedType?.includes('Push')) return 'Push events';
    if (selectedType?.includes('Pull Request')) return 'Pull request events';
    if (selectedType?.includes('Issue')) return 'Issue events';
    if (selectedType?.includes('Release')) return 'Release events';
    return 'All events';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b pb-4">
        <h3 className="text-lg font-semibold text-gray-800">GitHub Webhook Setup</h3>
        <p className="text-sm text-gray-500 mt-1">
          Configure your GitHub repository to send {getEventLabel().toLowerCase()} to this webhook.
        </p>
      </div>

      {/* Webhook URL */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Webhook URL</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={webhookUrl}
            readOnly
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600 text-sm"
          />
          <button
            onClick={() => copyToClipboard(webhookUrl, 'url')}
            disabled={!zapId}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            {copied === 'url' ? '✓ Copied' : 'Copy'}
          </button>
        </div>
        {!zapId && (
          <p className="text-xs text-amber-600 mt-1">Save the Zap first to get the webhook URL</p>
        )}
      </div>

      {/* Optional Webhook Secret */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Webhook Secret (Optional)
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            placeholder="Enter or generate a secret"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
          <button
            onClick={generateSecret}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm"
          >
            Generate
          </button>
          {webhookSecret && (
            <button
              onClick={() => copyToClipboard(webhookSecret, 'secret')}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-sm"
            >
              {copied === 'secret' ? '✓ Copied' : 'Copy'}
            </button>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Add this secret in GitHub webhook settings for signature verification
        </p>
      </div>

      {/* Setup Instructions */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 className="font-medium text-blue-800 mb-2">Setup Instructions</h4>
        <ol className="text-sm text-blue-700 space-y-2 list-decimal list-inside">
          <li>Go to your GitHub repository → Settings → Webhooks</li>
          <li>Click &quot;Add webhook&quot;</li>
          <li>Paste the webhook URL above</li>
          <li>
            Set Content type to <code className="bg-blue-100 px-1 rounded">application/json</code>
          </li>
          {webhookSecret && <li>Add the secret key for signature verification</li>}
          <li>
            Select events: <strong>{getEventLabel()}</strong>
          </li>
          <li>Click &quot;Add webhook&quot; to save</li>
        </ol>
      </div>

      {/* Event Type Badge */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-600">Listening for:</span>
        <span className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm font-medium">
          {getEventLabel()}
        </span>
      </div>

      {/* Save Button */}
      <button
        onClick={handleSave}
        className="w-full py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium"
      >
        Save Configuration
      </button>
    </div>
  );
};
