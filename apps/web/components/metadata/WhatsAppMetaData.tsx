'use client';
import React, { useState } from 'react';
import { MetaDataFormProps } from '../modal/types';

export interface WhatsAppActionMetadataInput {
  to?: string;
  message?: string;
  serverId?: string;
  phoneNumberId?: string;
  accessToken?: string;
}

export interface WhatsAppMetaDataProps extends MetaDataFormProps {
  preSelectedServerId?: string;
  initialData?: WhatsAppActionMetadataInput;
}

const SAMPLE_PILLS = ['{from}', '{fromName}', '{text}', '{previousOutput.result}'];

export function canSaveWhatsAppMetadata(data: WhatsAppActionMetadataInput): boolean {
  const hasRecipient = Boolean(data.to && data.to.trim().length > 0);
  const hasMessage = Boolean(data.message && data.message.trim().length > 0);
  const hasAuth = Boolean(
    (data.serverId && data.serverId.trim().length > 0) ||
      (data.phoneNumberId &&
        data.phoneNumberId.trim().length > 0 &&
        data.accessToken &&
        data.accessToken.trim().length > 0)
  );
  return hasRecipient && hasMessage && hasAuth;
}

export const WhatsAppMetaData: React.FC<WhatsAppMetaDataProps> = ({
  handleClick,
  preSelectedServerId,
  initialData,
}) => {
  const [to, setTo] = useState(initialData?.to || '');
  const [message, setMessage] = useState(initialData?.message || '');
  const [serverId] = useState(initialData?.serverId || preSelectedServerId || '');
  const [phoneNumberId, setPhoneNumberId] = useState(initialData?.phoneNumberId || '');
  const [accessToken, setAccessToken] = useState(initialData?.accessToken || '');
  const [showCredentials, setShowCredentials] = useState(
    Boolean(!preSelectedServerId && !initialData?.serverId)
  );

  const insertPill = (pill: string) => {
    setMessage((prev) => (prev ? `${prev} ${pill}` : pill));
  };

  const payload: WhatsAppActionMetadataInput = {
    to: to.trim(),
    message: message.trim(),
    ...(serverId ? { serverId } : {}),
    ...(phoneNumberId.trim() ? { phoneNumberId: phoneNumberId.trim() } : {}),
    ...(accessToken.trim() ? { accessToken: accessToken.trim() } : {}),
  };

  const isValid = canSaveWhatsAppMetadata(payload);

  return (
    <div className="meta-form">
      <div className="meta-form__header">
        <h3 className="meta-form__title">WhatsApp Send Message</h3>
        <p className="meta-form__subtitle">
          Send an outbound WhatsApp message via Meta Cloud API using dynamic trigger variables.
        </p>
      </div>

      <div>
        <label className="meta-form__label" htmlFor="whatsapp-to">
          Recipient Phone Number (To)
        </label>
        <input
          id="whatsapp-to"
          name="to"
          type="text"
          className="meta-form__input"
          placeholder="e.g. +14155552671 or {from}"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <p className="meta-form__hint">
          Include country code or use a dynamic placeholder like <code>{'{from}'}</code>.
        </p>
      </div>

      <div>
        <div className="meta-form__field-row">
          <label className="meta-form__label" htmlFor="whatsapp-message">
            Message Text
          </label>
          <span className="meta-form__counter">{message.length} / 4096</span>
        </div>
        <textarea
          id="whatsapp-message"
          name="message"
          rows={5}
          className="meta-form__textarea"
          placeholder="Hello {fromName}, we received your request: {text}"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <div className="meta-form__pills">
          {SAMPLE_PILLS.map((pill) => (
            <button
              key={pill}
              type="button"
              className="meta-form__pill-btn"
              onClick={() => insertPill(pill)}
            >
              + {pill}
            </button>
          ))}
        </div>
      </div>

      <div className="meta-form__card">
        <div className="meta-form__card-header">
          <label className="meta-form__checkbox-label">
            <input
              type="checkbox"
              checked={showCredentials}
              onChange={(e) => setShowCredentials(e.target.checked)}
            />
            Custom Cloud API Credentials {serverId ? '(Optional Override)' : '(Required)'}
          </label>
        </div>
        {showCredentials && (
          <div className="meta-form__subgroup">
            <div>
              <label className="meta-form__label" htmlFor="whatsapp-phone-id">
                Phone Number ID
              </label>
              <input
                id="whatsapp-phone-id"
                name="phoneNumberId"
                type="text"
                className="meta-form__input"
                placeholder="Meta Phone Number ID"
                value={phoneNumberId}
                onChange={(e) => setPhoneNumberId(e.target.value)}
              />
            </div>
            <div>
              <label className="meta-form__label" htmlFor="whatsapp-access-token">
                Access Token
              </label>
              <input
                id="whatsapp-access-token"
                name="accessToken"
                type="password"
                className="meta-form__input"
                placeholder="Meta Graph API Access Token"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
              />
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        className="meta-form__block-btn"
        disabled={!isValid}
        onClick={() => isValid && handleClick(payload)}
      >
        Save WhatsApp Action
      </button>
    </div>
  );
};

export default WhatsAppMetaData;
