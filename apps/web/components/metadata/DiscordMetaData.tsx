'use client';

import { useState } from 'react';
import axios from 'axios';
import FormInput from '../FormInput';
import Button from '../Button';
import { MetaDataFormProps } from '../modal/types';

const DISCORD_WEBHOOK_PATTERN = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/;

const COMMON_PLACEHOLDERS = [
  '{trigger.data.txHash}',
  '{trigger.data.amount}',
  '{trigger.data.from}',
  '{trigger.data.email}',
  '{trigger.data.subject}',
];

interface EmbedFieldState {
  name: string;
  value: string;
  inline?: boolean;
}

export const DiscordMetaData = ({ handleClick, initialData }: MetaDataFormProps & { initialData?: any }) => {
  const [webhookUrl, setWebhookUrl] = useState(initialData?.webhookUrl || '');
  const [content, setContent] = useState(initialData?.content || '');

  // Sender Identity customization
  const [showIdentity, setShowIdentity] = useState(Boolean(initialData?.username || initialData?.avatarUrl));
  const [username, setUsername] = useState(initialData?.username || '');
  const [avatarUrl, setAvatarUrl] = useState(initialData?.avatarUrl || '');

  // Embed toggle and fields
  const [showEmbed, setShowEmbed] = useState(Boolean(initialData?.embed));
  const [embedTitle, setEmbedTitle] = useState(initialData?.embed?.title || '');
  const [embedDescription, setEmbedDescription] = useState(initialData?.embed?.description || '');
  const [embedColor, setEmbedColor] = useState(initialData?.embed?.color || '#5865F2');
  const [embedUrl, setEmbedUrl] = useState(initialData?.embed?.url || '');
  const [embedFields, setEmbedFields] = useState<EmbedFieldState[]>(
    Array.isArray(initialData?.embed?.fields) ? initialData.embed.fields : []
  );

  // Testing feedback
  const [testLoading, setTestLoading] = useState(false);
  const [testMessage, setTestMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const isValidUrl = webhookUrl.trim().length > 0 && DISCORD_WEBHOOK_PATTERN.test(webhookUrl.trim());
  const canSave =
    isValidUrl &&
    (content.trim().length > 0 || (showEmbed && (embedTitle.trim().length > 0 || embedDescription.trim().length > 0)));

  const handleAddField = () => {
    if (embedFields.length >= 10) return;
    setEmbedFields([...embedFields, { name: '', value: '', inline: true }]);
  };

  const handleRemoveField = (index: number) => {
    setEmbedFields(embedFields.filter((_, i) => i !== index));
  };

  const handleUpdateField = (index: number, key: keyof EmbedFieldState, value: any) => {
    const updated = [...embedFields];
    if (updated[index]) {
      updated[index] = { ...updated[index], [key]: value } as EmbedFieldState;
      setEmbedFields(updated);
    }
  };

  const handleInsertPlaceholder = (placeholder: string) => {
    setContent((prev: string) => (prev ? `${prev} ${placeholder}` : placeholder));
  };

  const handleTestWebhook = async () => {
    if (!isValidUrl) {
      setTestMessage({ type: 'error', text: 'Enter a valid Discord webhook URL first.' });
      return;
    }

    setTestLoading(true);
    setTestMessage(null);

    const testPayload: Record<string, any> = {
      content: content.trim() || '🧪 Test message from ZapMate! Your webhook is configured correctly.',
    };

    if (showIdentity && username.trim()) {
      testPayload.username = username.trim();
    }
    if (showIdentity && avatarUrl.trim()) {
      testPayload.avatar_url = avatarUrl.trim();
    }

    if (showEmbed) {
      testPayload.embeds = [
        {
          title: embedTitle.trim() || 'Sample Embed Title',
          description: embedDescription.trim() || 'Sample rich embed description from ZapMate test run.',
          color: parseInt(embedColor.replace(/^#/, ''), 16) || 5793266,
          url: embedUrl.trim() || undefined,
          fields: embedFields.filter((f) => f.name.trim() && f.value.trim()),
        },
      ];
    }

    try {
      await axios.post(`${webhookUrl}?wait=true`, testPayload, { timeout: 8000 });
      setTestMessage({ type: 'success', text: '✅ Test message sent to your Discord channel!' });
    } catch (err: any) {
      const errMsg = err.response?.data?.message || err.message || 'Failed to deliver test message';
      setTestMessage({ type: 'error', text: `❌ Discord error: ${errMsg}` });
    } finally {
      setTestLoading(false);
    }
  };

  const handleSave = () => {
    if (!canSave) return;

    const metadata: Record<string, any> = {
      webhookUrl: webhookUrl.trim(),
    };

    if (content.trim()) {
      metadata.content = content.trim();
    }

    if (showIdentity && username.trim()) {
      metadata.username = username.trim();
    }

    if (showIdentity && avatarUrl.trim()) {
      metadata.avatarUrl = avatarUrl.trim();
    }

    if (showEmbed) {
      const validFields = embedFields.filter((f) => f.name.trim().length > 0 && f.value.trim().length > 0);
      metadata.embed = {
        title: embedTitle.trim() || undefined,
        description: embedDescription.trim() || undefined,
        color: embedColor,
        url: embedUrl.trim() || undefined,
        fields: validFields.length > 0 ? validFields : undefined,
      };
    }

    handleClick(metadata);
  };

  return (
    <div className="meta-form">
      <div>
        <FormInput
          label="Discord Webhook URL"
          name="webhookUrl"
          value={webhookUrl}
          placeholder="https://discord.com/api/webhooks/123.../abc..."
          onChange={(e: any) => setWebhookUrl(e.target.value)}
        />
        {webhookUrl.length > 0 && !isValidUrl && (
          <p className="text-xs text-red-400 mt-1">
            Must be a valid Discord webhook URL (e.g. https://discord.com/api/webhooks/...)
          </p>
        )}
      </div>

      <div>
        <div className="flex justify-between items-center mb-1">
          <label className="meta-form__label">Message Content</label>
          <span className={`text-xs ${content.length > 2000 ? 'text-red-400 font-semibold' : 'text-slate-400'}`}>
            {content.length}/2000
          </span>
        </div>
        <textarea
          name="content"
          value={content}
          rows={3}
          maxLength={2000}
          className="meta-form__input w-full resize-y font-mono text-sm"
          placeholder="New event! Amount: {trigger.data.amount} SOL from {trigger.data.from}"
          onChange={(e) => setContent(e.target.value)}
        />

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-400">Insert variable:</span>
          {COMMON_PLACEHOLDERS.map((ph) => (
            <button
              key={ph}
              type="button"
              onClick={() => handleInsertPlaceholder(ph)}
              className="text-xs bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 px-2 py-0.5 rounded transition-colors"
            >
              {ph}
            </button>
          ))}
        </div>
      </div>

      {/* Rich Embed Section */}
      <div className="border border-slate-800 rounded-lg p-3 bg-slate-900/50">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-slate-200 cursor-pointer flex items-center gap-2">
            <input
              type="checkbox"
              checked={showEmbed}
              onChange={(e) => setShowEmbed(e.target.checked)}
              className="rounded border-slate-700 text-indigo-500 focus:ring-indigo-400"
            />
            Attach Rich Embed
          </label>
          <span className="text-xs text-slate-400">Structured card with accent colors</span>
        </div>

        {showEmbed && (
          <div className="mt-3 space-y-3 pt-3 border-t border-slate-800">
            <FormInput
              label="Embed Title"
              name="embedTitle"
              value={embedTitle}
              placeholder="e.g. Transaction Confirmed"
              onChange={(e: any) => setEmbedTitle(e.target.value)}
            />

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="meta-form__label">Embed Description</label>
                <span className={`text-xs ${embedDescription.length > 4096 ? 'text-red-400 font-semibold' : 'text-slate-400'}`}>
                  {embedDescription.length}/4096
                </span>
              </div>
              <textarea
                name="embedDescription"
                value={embedDescription}
                rows={3}
                maxLength={4096}
                className="meta-form__input w-full resize-y font-mono text-sm"
                placeholder="Detailed summary or markdown description..."
                onChange={(e) => setEmbedDescription(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="meta-form__label">Accent Color</label>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="color"
                    value={embedColor.startsWith('#') ? embedColor : '#5865F2'}
                    onChange={(e) => setEmbedColor(e.target.value)}
                    className="w-9 h-9 rounded cursor-pointer border border-slate-700 bg-transparent p-0.5"
                  />
                  <input
                    type="text"
                    value={embedColor}
                    onChange={(e) => setEmbedColor(e.target.value)}
                    className="meta-form__input flex-1 text-sm font-mono"
                    placeholder="#5865F2"
                  />
                </div>
              </div>
              <FormInput
                label="Embed URL (Optional)"
                name="embedUrl"
                value={embedUrl}
                placeholder="https://..."
                onChange={(e: any) => setEmbedUrl(e.target.value)}
              />
            </div>

            {/* Embed Fields */}
            <div className="pt-2 border-t border-slate-800">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-300">Embed Fields</span>
                <button
                  type="button"
                  onClick={handleAddField}
                  disabled={embedFields.length >= 10}
                  className="text-xs text-indigo-400 hover:text-indigo-300 font-medium"
                >
                  + Add Field
                </button>
              </div>

              {embedFields.map((field, idx) => (
                <div key={idx} className="flex items-center gap-2 mb-2 bg-slate-950/40 p-2 rounded border border-slate-800">
                  <input
                    type="text"
                    placeholder="Field Name"
                    value={field.name}
                    onChange={(e) => handleUpdateField(idx, 'name', e.target.value)}
                    className="meta-form__input text-xs flex-1"
                  />
                  <input
                    type="text"
                    placeholder="Field Value"
                    value={field.value}
                    onChange={(e) => handleUpdateField(idx, 'value', e.target.value)}
                    className="meta-form__input text-xs flex-1"
                  />
                  <label className="text-xs text-slate-400 flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={field.inline ?? true}
                      onChange={(e) => handleUpdateField(idx, 'inline', e.target.checked)}
                      className="rounded border-slate-700"
                    />
                    Inline
                  </label>
                  <button
                    type="button"
                    onClick={() => handleRemoveField(idx)}
                    className="text-red-400 hover:text-red-300 text-xs px-1"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Sender Identity Section (Collapsible) */}
      <div className="border border-slate-800 rounded-lg p-3 bg-slate-900/50">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-slate-200 cursor-pointer flex items-center gap-2">
            <input
              type="checkbox"
              checked={showIdentity}
              onChange={(e) => setShowIdentity(e.target.checked)}
              className="rounded border-slate-700 text-indigo-500 focus:ring-indigo-400"
            />
            Customize Sender Identity
          </label>
          <span className="text-xs text-slate-400">Override name and avatar</span>
        </div>

        {showIdentity && (
          <div className="mt-3 pt-3 border-t border-slate-800 grid grid-cols-2 gap-3">
            <FormInput
              label="Sender Name Override (Optional)"
              name="username"
              value={username}
              placeholder="e.g. ZapMate Alerts"
              onChange={(e: any) => setUsername(e.target.value)}
            />
            <FormInput
              label="Avatar URL (Optional)"
              name="avatarUrl"
              value={avatarUrl}
              placeholder="https://.../avatar.png"
              onChange={(e: any) => setAvatarUrl(e.target.value)}
            />
          </div>
        )}
      </div>

      {testMessage && (
        <div
          className={`p-2.5 rounded text-xs ${
            testMessage.type === 'success'
              ? 'bg-emerald-950/70 border border-emerald-800 text-emerald-300'
              : 'bg-red-950/70 border border-red-800 text-red-300'
          }`}
        >
          {testMessage.text}
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={handleTestWebhook}
          disabled={!isValidUrl || testLoading}
          className="px-3 py-2 text-xs font-medium rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {testLoading ? 'Sending test...' : '🧪 Send Test Message'}
        </button>

        <Button variant="secondary" onClick={handleSave} disabled={!canSave}>
          Save Discord Action
        </Button>
      </div>
    </div>
  );
};

export default DiscordMetaData;
