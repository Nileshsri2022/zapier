'use client';
import { useState } from 'react';
import FormInput from '../FormInput';
import Button from '../Button';
import { MetaDataFormProps } from '../modal/types';

export interface WebhookMetaDataProps extends MetaDataFormProps {
  mode?: 'trigger' | 'action';
  initialData?: {
    url?: string;
    method?: string;
    headers?: string | Record<string, string>;
    body?: string | Record<string, any>;
    secret?: string;
  };
}

export function parseJsonField<T>(raw: string | T | undefined, fallback: T): T {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw !== 'string') return raw;
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return raw as unknown as T;
  }
}

const WebhookMetaData = ({
  handleClick,
  mode = 'action',
  initialData,
}: WebhookMetaDataProps) => {
  const [formData, setFormData] = useState({
    url: initialData?.url || '',
    method: initialData?.method || 'POST',
    headers:
      typeof initialData?.headers === 'object' && initialData?.headers !== null
        ? JSON.stringify(initialData.headers)
        : initialData?.headers || '{}',
    body:
      typeof initialData?.body === 'object' && initialData?.body !== null
        ? JSON.stringify(initialData.body, null, 2)
        : initialData?.body || '',
    secret: initialData?.secret || '',
  });

  const handleFormDataChange = (e: any) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  if (mode === 'trigger') {
    return (
      <div className="meta-form">
        <div className="meta-form__header">
          <h3 className="meta-form__title">Webhook Trigger</h3>
          <p className="meta-form__subtitle">
            Send HTTP POST requests with a JSON body to your Zap webhook URL to trigger runs.
          </p>
        </div>
        <FormInput
          label="Webhook Secret (Optional)"
          name="secret"
          placeholder="Optional shared secret or HMAC key"
          value={formData.secret}
          onChange={handleFormDataChange}
        />
        <p className="meta-form__hint">
          When set, callers must provide <code>X-Webhook-Signature</code> (HMAC-SHA256) or{' '}
          <code>X-Webhook-Secret</code>. Include <code>event_id</code> in the JSON body for
          automatic 24h deduplication.
        </p>
        <Button
          variant="secondary"
          onClick={() =>
            handleClick(formData.secret.trim() ? { secret: formData.secret.trim() } : {})
          }
        >
          Save
        </Button>
      </div>
    );
  }

  return (
    <div className="meta-form">
      <FormInput
        label="Webhook URL"
        name="url"
        placeholder="https://your-app.com/webhook"
        value={formData.url}
        onChange={handleFormDataChange}
      />
      <div>
        <label className="meta-form__label">Method</label>
        <select
          name="method"
          value={formData.method}
          onChange={handleFormDataChange}
          className="meta-form__input"
        >
          <option value="POST">POST</option>
          <option value="GET">GET</option>
          <option value="PUT">PUT</option>
          <option value="PATCH">PATCH</option>
          <option value="DELETE">DELETE</option>
        </select>
      </div>
      <FormInput
        label="Headers (JSON)"
        name="headers"
        placeholder='{"Content-Type": "application/json"}'
        value={formData.headers}
        onChange={handleFormDataChange}
      />
      {formData.method !== 'GET' && (
        <div>
          <label className="meta-form__label">Request Body (JSON or Template)</label>
          <textarea
            className="meta-form__textarea"
            name="body"
            rows={5}
            placeholder='{"event": "{event}", "message": "{text}"}'
            value={formData.body}
            onChange={handleFormDataChange}
          />
        </div>
      )}
      <Button
        variant="secondary"
        onClick={() =>
          handleClick({
            url: formData.url.trim(),
            method: formData.method,
            headers: parseJsonField<Record<string, string>>(formData.headers, {}),
            ...(formData.method !== 'GET' && formData.body.trim()
              ? { body: parseJsonField<any>(formData.body, formData.body) }
              : {}),
          })
        }
      >
        Save
      </Button>
    </div>
  );
};

export default WebhookMetaData;
