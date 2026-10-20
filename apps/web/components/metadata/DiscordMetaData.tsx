'use client';

import { useState } from 'react';
import axios from 'axios';
import FormInput from '../FormInput';
import Button from '../Button';
import { MetaDataFormProps } from '../modal/types';

// Canonical Discord webhook pattern, anchored to prevent trailing path bypass
const DISCORD_WEBHOOK_PATTERN = /^https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/;

const COMMON_PLACEHOLDERS = [
  '{trigger.data.txHash}',
  '{trigger.data.amount}',
  '{trigger.data.from}',
  '{trigger.data.email}',
  '{trigger.data.subject}',
];

const SAMPLE_TRIGGER_VALUES: Record<string, string> = {
  '{trigger.data.txHash}': '5K2b9a1z9PqL7eR3tU6vW8xY2',
  '{trigger.data.amount}': '2.5 SOL',
  '{trigger.data.from}': 'Alice (0x71C...3a1)',
  '{trigger.data.email}': 'user@example.com',
  '{trigger.data.subject}': 'Payment Notification',
  '{trigger.data.timestamp}': new Date().toISOString(),
};

function resolveSamplePlaceholders(text: string): string {
  if (!text) return text;
  let resolved = text;
  for (const [placeholder, sampleValue] of Object.entries(SAMPLE_TRIGGER_VALUES)) {
    resolved = resolved.split(placeholder).join(sampleValue);
  }
  return resolved;
}

function parseHexColor(colorHex: string): number {
  const clean = colorHex.replace(/^#/, '').trim();
  const parsed = parseInt(clean, 16);
  // Pure black (#000000 -> 0) is valid; only fall back to blurple if not a number
  return Number.isNaN(parsed) ? 5793266 : Math.max(0, Math.min(16777215, parsed));
}

function formatInitialColor(color?: string | number): string {
  if (color === 0) return '#000000';
  if (typeof color === 'number' && Number.isFinite(color)) {
    return `#${Math.max(0, Math.min(16777215, Math.floor(color))).toString(16).padStart(6, '0')}`;
  }
  if (typeof color === 'string' && color.trim()) {
    const clean = color.trim();
    return clean.startsWith('#') ? clean : `#${clean}`;
  }
  return '#5865F2';
}

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
  const [embedColor, setEmbedColor] = useState(() => formatInitialColor(initialData?.embed?.color));
  const [embedUrl, setEmbedUrl] = useState(initialData?.embed?.url || '');
  const [includeTimestamp, setIncludeTimestamp] = useState(Boolean(initialData?.embed?.timestamp));
  const [embedTimestamp, setEmbedTimestamp] = useState(
    initialData?.embed?.timestamp && initialData.embed.timestamp !== 'now'
      ? String(initialData.embed.timestamp)
      : ''
  );
  const [embedFields, setEmbedFields] = useState<EmbedFieldState[]>(
    Array.isArray(initialData?.embed?.fields) ? initialData.embed.fields : []
  );

  // Testing feedback
  const [testLoading, setTestLoading] = useState(false);
  const [testMessage, setTestMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const isValidUrl = webhookUrl.trim().length > 0 && DISCORD_WEBHOOK_PATTERN.test(webhookUrl.trim());
  const isDescriptionValid = embedDescription.length <= 4096;
  const isTitleValid = embedTitle.length <= 256;
  const isContentValid = content.length <= 2000;
  const isUsernameValid = username.length <= 80;
  const isEmbedUrlValid = !embedUrl.trim() || embedTitle.trim().length > 0;
  const areFieldsValid = embedFields.every((f) => f.name.length <= 256 && f.value.length <= 1024);

  // Rich embed is valid if it has title, description, or valid fields (spec §23, §72; url requires title)
  const hasValidFields = embedFields.some((f) => f.name.trim().length > 0 && f.value.trim().length > 0);
  const hasEmbedContent =
    showEmbed && (
      embedTitle.trim().length > 0 ||
      embedDescription.trim().length > 0 ||
      hasValidFields
    );

  const isEmbedValid = !showEmbed || (
    hasEmbedContent &&
    isTitleValid &&
    isDescriptionValid &&
    isEmbedUrlValid &&
    areFieldsValid
  );

  const canSave =
    isValidUrl &&
    isContentValid &&
    isUsernameValid &&
    isEmbedValid &&
    (content.trim().length > 0 || hasEmbedContent);

  const handleAddField = () => {
    // Discord allows up to 25 fields per embed
    if (embedFields.length >= 25) return;
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

    if (!content.trim() && !hasEmbedContent) {
      setTestMessage({ type: 'error', text: 'Enter message content or configure an embed to test.' });
      return;
    }

    if (showEmbed && embedUrl.trim() && !embedTitle.trim()) {
      setTestMessage({ type: 'error', text: 'Discord requires an Embed Title to link an Embed URL.' });
      return;
    }

    setTestLoading(true);
    setTestMessage(null);

    const resolvedContent = resolveSamplePlaceholders(content.trim());
    const testPayload: Record<string, any> = {};

    if (resolvedContent) {
      testPayload.content = resolvedContent;
    }

    if (showIdentity && username.trim()) {
      testPayload.username = resolveSamplePlaceholders(username.trim()).slice(0, 80);
    }
    if (showIdentity && avatarUrl.trim()) {
      testPayload.avatar_url = avatarUrl.trim();
    }

    if (showEmbed && hasEmbedContent) {
      const validFields = embedFields
        .filter((f) => f.name.trim() && f.value.trim())
        .slice(0, 25)
        .map((f) => ({
          name: resolveSamplePlaceholders(f.name.trim()).slice(0, 256),
          value: resolveSamplePlaceholders(f.value.trim()).slice(0, 1024),
          inline: Boolean(f.inline),
        }));

      let testTimestamp: string | undefined = undefined;
      if (includeTimestamp) {
        if (!embedTimestamp.trim() || embedTimestamp.trim() === 'now') {
          testTimestamp = new Date().toISOString();
        } else {
          const resolved = resolveSamplePlaceholders(embedTimestamp.trim());
          const parsedMs = Date.parse(resolved);
          if (!Number.isNaN(parsedMs)) {
            testTimestamp = new Date(parsedMs).toISOString();
          }
        }
      }

      testPayload.embeds = [
        {
          title: embedTitle.trim() ? resolveSamplePlaceholders(embedTitle.trim()).slice(0, 256) : undefined,
          description: embedDescription.trim()
            ? resolveSamplePlaceholders(embedDescription.trim()).slice(0, 4096)
            : undefined,
          color: parseHexColor(embedColor),
          url: embedTitle.trim() && embedUrl.trim() ? resolveSamplePlaceholders(embedUrl.trim()) : undefined,
          timestamp: testTimestamp,
          fields: validFields.length > 0 ? validFields : undefined,
        },
      ];
    }

    try {
      const url = new URL(webhookUrl.trim());
      url.searchParams.set('wait', 'true');
      await axios.post(url.toString(), testPayload, { timeout: 10000 });
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
      metadata.username = username.trim().slice(0, 80);
    }

    if (showIdentity && avatarUrl.trim()) {
      metadata.avatarUrl = avatarUrl.trim();
    }

    if (showEmbed && hasEmbedContent) {
      const validFields = embedFields
        .filter((f) => f.name.trim().length > 0 && f.value.trim().length > 0)
        .slice(0, 25)
        .map((f) => ({
          name: f.name.trim().slice(0, 256),
          value: f.value.trim().slice(0, 1024),
          inline: Boolean(f.inline),
        }));

      const resolvedEmbedTimestamp = includeTimestamp
        ? (embedTimestamp.trim() || 'now')
        : undefined;

      metadata.embed = {
        title: embedTitle.trim() ? embedTitle.trim().slice(0, 256) : undefined,
        description: embedDescription.trim() ? embedDescription.trim().slice(0, 4096) : undefined,
        color: embedColor,
        url: embedTitle.trim() && embedUrl.trim() ? embedUrl.trim() : undefined,
        timestamp: resolvedEmbedTimestamp,
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
          <p className="meta-form__error-text">
            Must be a valid Discord webhook URL (e.g. https://discord.com/api/webhooks/&#123;id&#125;/&#123;token&#125;)
          </p>
        )}
      </div>

      <div>
        <div className="meta-form__row">
          <label className="meta-form__label">Message Content</label>
          <span className={content.length > 2000 ? 'meta-form__counter meta-form__counter--danger' : 'meta-form__counter'}>
            {content.length}/2000
          </span>
        </div>
        <textarea
          name="content"
          value={content}
          rows={3}
          className="meta-form__textarea"
          placeholder="New event! Amount: {trigger.data.amount} SOL from {trigger.data.from}"
          onChange={(e) => setContent(e.target.value)}
        />
        {content.length > 2000 && (
          <p className="meta-form__error-text">Message content exceeds Discord&apos;s 2,000-character limit.</p>
        )}

        <div className="meta-form__pills">
          <span className="meta-form__hint">Insert variable:</span>
          {COMMON_PLACEHOLDERS.map((ph) => (
            <button
              key={ph}
              type="button"
              onClick={() => handleInsertPlaceholder(ph)}
              className="meta-form__pill-btn"
            >
              {ph}
            </button>
          ))}
        </div>
      </div>

      {/* Rich Embed Section */}
      <div className="meta-form__card">
        <div className="meta-form__card-header">
          <label className="meta-form__checkbox-label">
            <input
              type="checkbox"
              checked={showEmbed}
              onChange={(e) => setShowEmbed(e.target.checked)}
            />
            Attach Rich Embed
          </label>
          <span className="meta-form__hint">Structured card with accent colors</span>
        </div>

        {showEmbed && (
          <div className="meta-form__section">
            <div>
              <div className="meta-form__row">
                <label className="meta-form__label">Embed Title</label>
                <span className={embedTitle.length > 256 ? 'meta-form__counter meta-form__counter--danger' : 'meta-form__counter'}>
                  {embedTitle.length}/256
                </span>
              </div>
              <input
                type="text"
                name="embedTitle"
                value={embedTitle}
                className="meta-form__input"
                placeholder="e.g. Transaction Confirmed"
                onChange={(e: any) => setEmbedTitle(e.target.value)}
              />
              {embedTitle.length > 256 && (
                <p className="meta-form__error-text">Embed title exceeds Discord&apos;s 256-character limit.</p>
              )}
            </div>

            <div>
              <div className="meta-form__row">
                <label className="meta-form__label">Embed Description</label>
                <span className={embedDescription.length > 4096 ? 'meta-form__counter meta-form__counter--danger' : 'meta-form__counter'}>
                  {embedDescription.length}/4096
                </span>
              </div>
              <textarea
                name="embedDescription"
                value={embedDescription}
                rows={3}
                className="meta-form__textarea"
                placeholder="Detailed summary or markdown description..."
                onChange={(e) => setEmbedDescription(e.target.value)}
              />
              {embedDescription.length > 4096 && (
                <p className="meta-form__error-text">Embed description exceeds Discord&apos;s 4,096-character limit.</p>
              )}
            </div>

            <div className="meta-form__grid">
              <div>
                <label className="meta-form__label">Accent Color</label>
                <div className="meta-form__color-row">
                  <input
                    type="color"
                    value={typeof embedColor === 'string' && embedColor.startsWith('#') ? embedColor : '#5865F2'}
                    onChange={(e) => setEmbedColor(e.target.value)}
                    className="meta-form__color-picker"
                  />
                  <input
                    type="text"
                    value={embedColor}
                    onChange={(e) => setEmbedColor(e.target.value)}
                    className="meta-form__input"
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
              {embedUrl.trim().length > 0 && !embedTitle.trim() && (
                <p className="meta-form__error-text">
                  Discord requires an Embed Title to link an Embed URL.
                </p>
              )}
            </div>

            <div>
              <label className="meta-form__checkbox-label">
                <input
                  type="checkbox"
                  checked={includeTimestamp}
                  onChange={(e) => {
                    setIncludeTimestamp(e.target.checked);
                    if (!e.target.checked) setEmbedTimestamp('');
                  }}
                />
                Include timestamp on embed
              </label>
              {includeTimestamp && (
                <div className="meta-form__subgroup">
                  <FormInput
                    label="Custom Timestamp (ISO8601 or placeholder, optional)"
                    name="embedTimestamp"
                    value={embedTimestamp}
                    placeholder="Leave blank for dynamic run time ('now'), or {trigger.data.timestamp}"
                    onChange={(e: any) => setEmbedTimestamp(e.target.value)}
                  />
                </div>
              )}
            </div>

            {/* Embed Fields */}
            <div>
              <div className="meta-form__row">
                <span className="meta-form__label">
                  Embed Fields ({embedFields.length}/25)
                </span>
                <button
                  type="button"
                  onClick={handleAddField}
                  disabled={embedFields.length >= 25}
                  className="meta-form__btn-ghost"
                >
                  + Add Field
                </button>
              </div>

              {embedFields.map((field, idx) => (
                <div key={idx}>
                  <div className="meta-form__field-row">
                    <input
                      type="text"
                      placeholder="Field Name (max 256)"
                      value={field.name}
                      onChange={(e) => handleUpdateField(idx, 'name', e.target.value)}
                      className="meta-form__input"
                    />
                    <input
                      type="text"
                      placeholder="Field Value (max 1024)"
                      value={field.value}
                      onChange={(e) => handleUpdateField(idx, 'value', e.target.value)}
                      className="meta-form__input"
                    />
                    <label className="meta-form__checkbox-label">
                      <input
                        type="checkbox"
                        checked={field.inline ?? true}
                        onChange={(e) => handleUpdateField(idx, 'inline', e.target.checked)}
                      />
                      Inline
                    </label>
                    <button
                      type="button"
                      onClick={() => handleRemoveField(idx)}
                      className="meta-form__btn-ghost"
                    >
                      ✕
                    </button>
                  </div>
                  {field.name.length > 256 && (
                    <p className="meta-form__error-text">Field name exceeds 256 characters ({field.name.length}/256).</p>
                  )}
                  {field.value.length > 1024 && (
                    <p className="meta-form__error-text">Field value exceeds 1,024 characters ({field.value.length}/1024).</p>
                  )}
                </div>
              ))}
            </div>

            {showEmbed && !hasEmbedContent && (
              <p className="meta-form__error-text">
                An embed requires a title, description, or at least one field to be attached.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Sender Identity Section (Collapsible) */}
      <div className="meta-form__card">
        <div className="meta-form__card-header">
          <label className="meta-form__checkbox-label">
            <input
              type="checkbox"
              checked={showIdentity}
              onChange={(e) => setShowIdentity(e.target.checked)}
            />
            Customize Sender Identity
          </label>
          <span className="meta-form__hint">Override name and avatar</span>
        </div>

        {showIdentity && (
          <div className="meta-form__grid">
            <div>
              <div className="meta-form__row">
                <label className="meta-form__label">Sender Name Override (Optional)</label>
                <span className={username.length > 80 ? 'meta-form__counter meta-form__counter--danger' : 'meta-form__counter'}>
                  {username.length}/80
                </span>
              </div>
              <input
                type="text"
                name="username"
                value={username}
                className="meta-form__input"
                placeholder="e.g. ZapMate Alerts"
                onChange={(e: any) => setUsername(e.target.value)}
              />
              {username.length > 80 && (
                <p className="meta-form__error-text">Sender name exceeds Discord&apos;s 80-character limit.</p>
              )}
            </div>
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
          className={
            testMessage.type === 'success'
              ? 'meta-form__feedback--success'
              : 'meta-form__feedback--error'
          }
        >
          {testMessage.text}
        </div>
      )}

      <div className="meta-form__actions">
        <button
          type="button"
          onClick={handleTestWebhook}
          disabled={!isValidUrl || testLoading}
          className="meta-form__btn-ghost"
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
