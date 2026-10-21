'use client';
import { useState } from 'react';
import FormInput from '../FormInput';
import Button from '../Button';
import { MetaDataFormProps } from '../modal/types';

/**
 * A4 — Webhook ACTION builder (docs/ask-matt/actions/webhook.md, round 14).
 * Distinct from the T5 catch-hook trigger config: this configures an outbound
 * HTTP request (five verbs, none/basic/bearer/api-key auth, json/form/raw body,
 * per-step status override, private-network opt-in).
 */
const VERBS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const AUTH_TYPES = [
  { value: 'none', label: 'No auth' },
  { value: 'bearer', label: 'Bearer token' },
  { value: 'basic', label: 'Basic (username/password)' },
  { value: 'api_key', label: 'API key (header or query)' },
];
const BODY_MODES = [
  { value: 'json', label: 'JSON' },
  { value: 'form', label: 'Form (x-www-form-urlencoded)' },
  { value: 'raw', label: 'Raw text' },
];

const WebhookActionMetaData = ({ handleClick }: MetaDataFormProps) => {
  const [form, setForm] = useState({
    method: 'POST',
    url: '',
    headers: '',
    query: '',
    authType: 'none',
    username: '',
    password: '',
    token: '',
    apiKey: '',
    apiKeyName: 'X-API-Key',
    apiKeyIn: 'header',
    bodyMode: 'json',
    body: '',
    timeoutMs: '30000',
    acceptStatuses: '',
    allowPrivateNetwork: false,
  });
  const [error, setError] = useState('');

  const update = (e: any) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const parsePairs = (raw: string, label: string) => {
    const out: Record<string, string> = {};
    raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        const index = line.indexOf(':');
        if (index === -1) throw new Error(`${label} must be "Key: value" per line`);
        out[line.slice(0, index).trim()] = line.slice(index + 1).trim();
      });
    return out;
  };

  const save = () => {
    try {
      if (!form.url.trim()) throw new Error('Request URL is required.');
      const hasBody = !['GET', 'DELETE'].includes(form.method) && form.bodyMode !== 'none';
      const metadata: Record<string, any> = {
        method: form.method,
        url: form.url.trim(),
        bodyMode: hasBody ? form.bodyMode : 'none',
        timeoutMs: Number(form.timeoutMs) || 30000,
      };
      const headers = parsePairs(form.headers, 'Headers');
      if (Object.keys(headers).length) metadata.headers = headers;
      const query = parsePairs(form.query, 'Query params');
      if (Object.keys(query).length) metadata.query = query;

      if (form.authType === 'bearer') metadata.auth = { type: 'bearer', token: form.token };
      if (form.authType === 'basic')
        metadata.auth = { type: 'basic', username: form.username, password: form.password };
      if (form.authType === 'api_key')
        metadata.auth = {
          type: 'api_key',
          apiKey: form.apiKey,
          apiKeyName: form.apiKeyName,
          in: form.apiKeyIn,
        };

      if (hasBody) {
        if (form.bodyMode === 'json') {
          try {
            metadata.body = form.body.trim() ? JSON.parse(form.body) : {};
          } catch {
            throw new Error('Body is set to JSON but is not valid JSON.');
          }
        } else if (form.bodyMode === 'form') {
          metadata.body = form.body;
        } else {
          metadata.body = form.body;
        }
      }
      if (form.acceptStatuses.trim()) metadata.acceptStatuses = form.acceptStatuses.trim();
      if (form.allowPrivateNetwork) metadata.allowPrivateNetwork = true;

      handleClick(metadata);
    } catch (err: any) {
      setError(err?.message ?? 'Invalid configuration.');
    }
  };

  return (
    <div className="meta-form">
      <label className="meta-form__label">Method</label>
      <select className="meta-form__input" name="method" value={form.method} onChange={update}>
        {VERBS.map((verb) => (
          <option key={verb} value={verb}>
            {verb}
          </option>
        ))}
      </select>

      <FormInput
        label="URL (mapped fields like {{previousOutput.fields.id}} are supported)"
        name="url"
        onChange={update}
      />

      <label className="meta-form__label">Query params (Key: value, one per line)</label>
      <textarea className="meta-form__textarea" rows={3} name="query" onChange={update} />

      <label className="meta-form__label">Headers (Key: value, one per line)</label>
      <textarea className="meta-form__textarea" rows={3} name="headers" onChange={update} />

      <label className="meta-form__label">Auth</label>
      <select className="meta-form__input" name="authType" value={form.authType} onChange={update}>
        {AUTH_TYPES.map((auth) => (
          <option key={auth.value} value={auth.value}>
            {auth.label}
          </option>
        ))}
      </select>

      {form.authType === 'bearer' && (
        <FormInput label="Bearer token" name="token" onChange={update} />
      )}
      {form.authType === 'basic' && (
        <>
          <FormInput label="Username" name="username" onChange={update} />
          <FormInput label="Password" name="password" onChange={update} />
        </>
      )}
      {form.authType === 'api_key' && (
        <>
          <FormInput label="API key" name="apiKey" onChange={update} />
          <FormInput label="Key name" name="apiKeyName" onChange={update} />
          <label className="meta-form__label">Send key in</label>
          <select
            className="meta-form__input"
            name="apiKeyIn"
            value={form.apiKeyIn}
            onChange={update}
          >
            <option value="header">Header</option>
            <option value="query">Query string</option>
          </select>
        </>
      )}

      {!['GET', 'DELETE'].includes(form.method) && (
        <>
          <label className="meta-form__label">Body</label>
          <select
            className="meta-form__input"
            name="bodyMode"
            value={form.bodyMode}
            onChange={update}
          >
            {BODY_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </select>
          <textarea
            className="meta-form__textarea"
            rows={6}
            name="body"
            placeholder={
              form.bodyMode === 'json' ? '{ "sku": "{{previousOutput.fields.sku}}" }' : 'Body'
            }
            onChange={update}
          />
        </>
      )}

      <FormInput label="Timeout (ms)" name="timeoutMs" onChange={update} />
      <FormInput
        label="Accept statuses (empty = 2xx only; e.g. 404,409 or 'any')"
        name="acceptStatuses"
        onChange={update}
      />

      <label className="meta-form__label">
        <input
          type="checkbox"
          name="allowPrivateNetwork"
          checked={form.allowPrivateNetwork}
          onChange={update}
        />{' '}
        Allow private / loopback targets (advanced — SSRF risk)
      </label>

      <p className="meta-form__hint">
        POST/PATCH are never retried (duplicate side effects); GET/PUT/DELETE retry 5xx and
        timeouts. Auth secrets are redacted from logs and run output.
      </p>

      {error && <p className="meta-form__error-text">{error}</p>}
      <Button variant="secondary" onClick={save}>
        Save
      </Button>
    </div>
  );
};

export default WebhookActionMetaData;
