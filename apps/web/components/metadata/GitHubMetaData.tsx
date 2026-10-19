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
    <div className="meta-form__section">
      {/* Header */}
      <div className="meta-form__header">
        <h3 className="meta-form__title">GitHub Webhook Setup</h3>
        <p className="meta-form__subtitle">
          Configure your GitHub repository to send {getEventLabel().toLowerCase()} to this webhook.
        </p>
      </div>

      {/* Webhook URL */}
      <div>
        <label className="meta-form__label">Webhook URL</label>
        <div className="meta-form__row">
          <input type="text" value={webhookUrl} readOnly className="meta-form__readonly" />
          <button
            onClick={() => copyToClipboard(webhookUrl, 'url')}
            disabled={!zapId}
            className="meta-form__btn-primary"
          >
            {copied === 'url' ? '✓ Copied' : 'Copy'}
          </button>
        </div>
        {!zapId && (
          <p className="meta-form__hint-warning">Save the Zap first to get the webhook URL</p>
        )}
      </div>

      {/* Optional Webhook Secret */}
      <div>
        <label className="meta-form__label">Webhook Secret (Optional)</label>
        <div className="meta-form__row">
          <input
            type="text"
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            placeholder="Enter or generate a secret"
            className="meta-form__input"
          />
          <button onClick={generateSecret} className="meta-form__btn-ghost">
            Generate
          </button>
          {webhookSecret && (
            <button
              onClick={() => copyToClipboard(webhookSecret, 'secret')}
              className="meta-form__btn-primary"
            >
              {copied === 'secret' ? '✓ Copied' : 'Copy'}
            </button>
          )}
        </div>
        <p className="meta-form__hint">
          Add this secret in GitHub webhook settings for signature verification
        </p>
      </div>

      {/* Setup Instructions */}
      <div className="meta-form__panel">
        <h4 className="meta-form__panel-title">Setup Instructions</h4>
        <ol className="meta-form__steps">
          <li>Go to your GitHub repository → Settings → Webhooks</li>
          <li>Click &quot;Add webhook&quot;</li>
          <li>Paste the webhook URL above</li>
          <li>
            Set Content type to <code className="meta-form__code">application/json</code>
          </li>
          {webhookSecret && <li>Add the secret key for signature verification</li>}
          <li>
            Select events: <strong>{getEventLabel()}</strong>
          </li>
          <li>Click &quot;Add webhook&quot; to save</li>
        </ol>
      </div>

      {/* Event Type Badge */}
      <div className="meta-form__row">
        <span className="meta-form__text">Listening for:</span>
        <span className="meta-form__pill">{getEventLabel()}</span>
      </div>

      {/* Save Button */}
      <button onClick={handleSave} className="meta-form__block-btn">
        Save Configuration
      </button>
    </div>
  );
};
