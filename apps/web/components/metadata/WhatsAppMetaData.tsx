'use client';
import { useEffect, useState } from 'react';
import axios from 'axios';
import FormInput from '../FormInput';
import Button from '../Button';
import { MetaDataFormProps } from '../modal/types';
import { API_URL } from '@/lib/config';

/**
 * A5 — WhatsApp Send action builder (docs/ask-matt/actions/whatsapp.md, round 15).
 * Q-WA-A-06 sender picker limited to the connection's number ids ·
 * Q-WA-A-02 approved-template dropdown with positional params ·
 * Q-WA-A-01 template vs freeform (24h window) · Q-WA-A-03 media link + caption.
 */
interface WhatsAppServer {
  id: string;
  phoneNumberId: string;
  displayName?: string | null;
  phoneNumber?: string | null;
}

interface WhatsAppTemplate {
  name: string;
  language: string;
  paramCount: number;
}

const WhatsAppMetaData = ({ handleClick }: MetaDataFormProps) => {
  const [servers, setServers] = useState<WhatsAppServer[]>([]);
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [templateError, setTemplateError] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    fromPhoneNumberId: '',
    to: '',
    kind: 'template',
    templateName: '',
    templateLanguage: 'en_US',
    freeformText: '',
    mediaUrl: '',
    caption: '',
    previewUrl: false,
  });
  const [params, setParams] = useState<string[]>([]);

  const update = (e: any) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get(`${API_URL}/api/whatsapp/servers`, { withCredentials: true });
        const list: WhatsAppServer[] = res?.data?.servers ?? [];
        setServers(list);
        setForm((prev) => ({
          ...prev,
          fromPhoneNumberId: prev.fromPhoneNumberId || list[0]?.phoneNumberId || '',
        }));
      } catch {
        setServers([]);
      }
    })();
  }, []);

  useEffect(() => {
    if (!form.fromPhoneNumberId) return;
    (async () => {
      setTemplateError('');
      try {
        const server = servers.find((entry) => entry.phoneNumberId === form.fromPhoneNumberId);
        const res = await axios.get(`${API_URL}/api/whatsapp/templates`, {
          withCredentials: true,
          params: server ? { serverId: server.id } : {},
        });
        setTemplates(res?.data?.templates ?? []);
      } catch (err: any) {
        setTemplates([]);
        setTemplateError(
          err?.response?.data?.message ??
            'Could not load approved templates — check the connection token.'
        );
      }
    })();
  }, [form.fromPhoneNumberId, servers]);

  const selectedTemplate = templates.find((template) => template.name === form.templateName);
  const paramCount = selectedTemplate?.paramCount ?? params.length;

  useEffect(() => {
    if (form.kind !== 'template') return;
    setParams((prev) => {
      const next = [...prev];
      next.length = paramCount;
      return Array.from(next, (value) => value ?? '');
    });
  }, [paramCount, form.kind]);

  const save = () => {
    if (!form.fromPhoneNumberId) {
      setError('Connect and choose a WhatsApp sender number first.');
      return;
    }
    if (!form.to.trim()) {
      setError('A recipient phone number is required.');
      return;
    }
    if (form.kind === 'template') {
      if (!form.templateName) {
        setError('Select an approved template.');
        return;
      }
      if (params.some((param) => !param.trim())) {
        setError(`This template needs ${paramCount} parameter(s).`);
        return;
      }
      handleClick({
        fromPhoneNumberId: form.fromPhoneNumberId,
        to: form.to.trim(),
        kind: 'template',
        template: {
          name: form.templateName,
          language: form.templateLanguage,
          params,
          paramCount,
        },
      });
      return;
    }

    if (!form.freeformText.trim() && !form.mediaUrl.trim()) {
      setError('Freeform messages need text or media.');
      return;
    }
    handleClick({
      fromPhoneNumberId: form.fromPhoneNumberId,
      to: form.to.trim(),
      kind: 'freeform',
      freeform: {
        text: form.freeformText,
        mediaUrl: form.mediaUrl.trim() || null,
        caption: form.caption.trim() || null,
        previewUrl: form.previewUrl,
      },
    });
  };

  return (
    <div className="meta-form">
      <label className="meta-form__label">Sender number</label>
      <select
        className="meta-form__input"
        name="fromPhoneNumberId"
        value={form.fromPhoneNumberId}
        onChange={update}
      >
        {servers.length === 0 && <option value="">No connected WhatsApp number</option>}
        {servers.map((server) => (
          <option key={server.id} value={server.phoneNumberId}>
            {server.displayName || server.phoneNumber || server.phoneNumberId}
          </option>
        ))}
      </select>

      <FormInput
        label="Recipient phone (country code required, e.g. 919876543210)"
        name="to"
        onChange={update}
      />

      <label className="meta-form__label">Message kind</label>
      <select className="meta-form__input" name="kind" value={form.kind} onChange={update}>
        <option value="template">Approved template (any time)</option>
        <option value="freeform">Freeform text (last 24h only)</option>
      </select>

      {form.kind === 'template' ? (
        <>
          <label className="meta-form__label">Template</label>
          <select
            className="meta-form__input"
            name="templateName"
            value={form.templateName}
            onChange={(e) => {
              const chosen = templates.find((template) => template.name === e.target.value);
              setForm((prev) => ({
                ...prev,
                templateName: e.target.value,
                templateLanguage: chosen?.language ?? prev.templateLanguage,
              }));
            }}
          >
            <option value="">Select an approved template</option>
            {templates.map((template) => (
              <option key={`${template.name}:${template.language}`} value={template.name}>
                {template.name} ({template.language}) — {template.paramCount} param(s)
              </option>
            ))}
          </select>
          {templateError && <p className="meta-form__error-text">{templateError}</p>}

          {paramCount > 0 && (
            <>
              <label className="meta-form__label">
                Template parameters (positional {'{{1}}'}…{`{{${paramCount}}}`})
              </label>
              {Array.from({ length: paramCount }).map((_, index) => (
                <input
                  key={index}
                  className="meta-form__input"
                  placeholder={`Parameter ${index + 1}`}
                  value={params[index] ?? ''}
                  onChange={(e) => {
                    const next = [...params];
                    next[index] = e.target.value;
                    setParams(next);
                  }}
                />
              ))}
            </>
          )}
        </>
      ) : (
        <>
          <label className="meta-form__label">Message text</label>
          <textarea
            className="meta-form__textarea"
            rows={5}
            name="freeformText"
            placeholder="Your order shipped 📦 — mapped fields like {{previousOutput.fields.name}} work"
            onChange={update}
          />
          <FormInput
            label="Media URL (optional, ≤ image/document/video/audio link)"
            name="mediaUrl"
            onChange={update}
          />
          <FormInput label="Media caption (optional)" name="caption" onChange={update} />
          <label className="meta-form__label">
            <input type="checkbox" name="previewUrl" checked={form.previewUrl} onChange={update} />{' '}
            Show link preview
          </label>
          <p className="meta-form__hint">
            Freeform messages only reach customers who messaged in the last 24 hours. Outside that
            window the run fails with <code>outside_session_window</code> — send an approved
            template instead.
          </p>
        </>
      )}

      {error && <p className="meta-form__error-text">{error}</p>}
      <Button variant="secondary" onClick={save}>
        Save
      </Button>
    </div>
  );
};

export default WhatsAppMetaData;
