'use client';
import { useEffect, useMemo, useState } from 'react';
import Button from '../Button';
import { MetaDataFormProps } from '../modal/types';
import { HOOKS_URL } from '@/lib/config';
import { getSessionDetails } from '../../helper';

interface WebhookMetaDataProps extends MetaDataFormProps {
  zapId?: string;
}

const FIVE_VERBS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const randomId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

/**
 * T5 — Catch Hook configuration (docs/ask-matt/triggers/webhook.md, round 7):
 * separate test/production URLs (generated ids, rotation = immediate revoke),
 * per-hook auth mode (none / static key / HMAC) + secret, method restrictions
 * (default: all five verbs).
 */
const WebhookMetaData = ({ handleClick, zapId }: WebhookMetaDataProps) => {
  const [authMode, setAuthMode] = useState<'none' | 'static' | 'hmac'>('none');
  const [secret, setSecret] = useState('');
  const [methods, setMethods] = useState<string[]>([...FIVE_VERBS]);
  const [prodHookId, setProdHookId] = useState<string>('');
  const [testHookId, setTestHookId] = useState<string>('');
  const [copied, setCopied] = useState<'prod' | 'test' | null>(null);

  // Provision URL ids client-side (no server dependency); stored in
  // Trigger.metadata on save. Rotation = new id + save ⇒ old URL 410s.
  useEffect(() => {
    setProdHookId((v) => v || randomId());
    setTestHookId((v) => v || randomId());
  }, []);

  const userId = getSessionDetails()?.user?.id as string | undefined;
  const canBuildUrls = Boolean(zapId && userId);

  const prodUrl = canBuildUrls ? `${HOOKS_URL}/hooks/${userId}/${zapId}/${prodHookId}` : '';
  const testUrl = canBuildUrls ? `${HOOKS_URL}/hooks/test/${userId}/${zapId}/${testHookId}` : '';

  const rotateUrls = () => {
    setProdHookId(randomId());
    setTestHookId(randomId());
  };

  const copy = async (value: string, key: 'prod' | 'test') => {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const toggleMethod = (m: string) => {
    setMethods((prev) =>
      prev.includes(m)
        ? prev.filter((x) => x !== m)
        : [...FIVE_VERBS.filter((x) => [...prev, m].includes(x))]
    );
  };

  const handleSave = () => {
    handleClick({
      authMode,
      ...(authMode !== 'none' ? { secret: secret || undefined } : { secret: undefined }),
      // Omit when all five are accepted (= default restriction)
      ...(methods.length === FIVE_VERBS.length ? {} : { methods }),
      prodHookId,
      testHookId,
    });
  };

  const hint = useMemo(
    () =>
      canBuildUrls
        ? undefined
        : 'Save the Zap first — your URLs appear on the dashboard and here on edit',
    [canBuildUrls]
  );

  return (
    <div className="meta-form__section">
      <div className="meta-form__header">
        <h3 className="meta-form__title">Catch Hook</h3>
        <p className="meta-form__subtitle">
          Any system that can make an HTTP request can trigger this Zap. Test and production
          URLs are separate — test stores samples and never runs the Zap.
        </p>
      </div>

      {/* Production URL */}
      <div>
        <label className="meta-form__label">Production URL</label>
        <div className="meta-form__row">
          <input
            type="text"
            value={prodUrl || '{Production URL after save}'}
            readOnly
            className="meta-form__readonly"
          />
          <button
            onClick={() => prodUrl && copy(prodUrl, 'prod')}
            disabled={!prodUrl}
            className="meta-form__btn-primary"
          >
            {copied === 'prod' ? '✓ Copied' : 'Copy'}
          </button>
        </div>
        <p className="meta-form__hint">Accepts GET, POST, PUT, PATCH, DELETE — replies 200 (empty) immediately.</p>
      </div>

      {/* Test URL */}
      <div>
        <label className="meta-form__label">Test URL</label>
        <div className="meta-form__row">
          <input
            type="text"
            value={testUrl || '{Test URL after save}'}
            readOnly
            className="meta-form__readonly"
          />
          <button
            onClick={() => testUrl && copy(testUrl, 'test')}
            disabled={!testUrl}
            className="meta-form__btn-primary"
          >
            {copied === 'test' ? '✓ Copied' : 'Copy'}
          </button>
        </div>
        <p className="meta-form__hint">Stores up to 10 recent samples for field mapping — never triggers the Zap.</p>
      </div>
      {hint && <p className="meta-form__hint-warning">{hint}</p>}

      {/* Auth mode (Q-WHT-02) */}
      <div>
        <label className="meta-form__label">Authentication</label>
        <select
          value={authMode}
          onChange={(e) => setAuthMode(e.target.value as any)}
          className="meta-form__input"
        >
          <option value="none">None — open hook (unguessable URL only)</option>
          <option value="static">Static key — x-webhook-secret or Bearer token</option>
          <option value="hmac">HMAC — x-webhook-signature: sha256=&lt;hex&gt;</option>
        </select>
      </div>

      {authMode !== 'none' && (
        <div>
          <label className="meta-form__label">Secret</label>
          <input
            type="text"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="Enter or generate a secret"
            className="meta-form__input"
          />
          <p className="meta-form__hint">
            {authMode === 'hmac'
              ? 'Send sha256=HMAC-SHA256(rawBody, this secret) in x-webhook-signature'
              : 'Send this value in x-webhook-secret or Authorization: Bearer'}
          </p>
        </div>
      )}

      {/* Method restrictions (default: all five) */}
      <div>
        <label className="meta-form__label">Accepted methods</label>
        <div className="meta-form__row" style={{ flexWrap: 'wrap', gap: '8px' }}>
          {FIVE_VERBS.map((m) => (
            <label key={m} style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={methods.includes(m)}
                onChange={() => toggleMethod(m)}
              />
              {m}
            </label>
          ))}
        </div>
      </div>

      {/* Rotation (Q-WHT-05: immediate revoke, no grace) */}
      <button type="button" onClick={rotateUrls} className="meta-form__btn-ghost">
        Rotate URLs
      </button>
      <p className="meta-form__hint">
        Rotation mints new ids — save to apply; old URLs stop working immediately.
      </p>

      <button onClick={handleSave} className="meta-form__block-btn">
        Save Configuration
      </button>
    </div>
  );
};

export default WebhookMetaData;
