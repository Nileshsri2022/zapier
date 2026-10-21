'use client';
import React, { useState } from 'react';
import { MetaDataFormProps } from '../modal/types';

export interface TelegramActionMetadataInput {
  chatId?: string;
  message?: string;
  botId?: string;
  botToken?: string;
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
}

export interface TelegramMetaDataProps extends MetaDataFormProps {
  preSelectedServerId?: string;
  initialData?: TelegramActionMetadataInput;
}

const SAMPLE_PILLS = ['{chatId}', '{firstName}', '{text}', '{commandArgs}', '{previousOutput.result}'];

export function canSaveTelegramMetadata(data: TelegramActionMetadataInput): boolean {
  const hasChatId = Boolean(data.chatId && String(data.chatId).trim().length > 0);
  const hasMessage = Boolean(data.message && data.message.trim().length > 0);
  const hasAuth = Boolean(
    (data.botId && data.botId.trim().length > 0) ||
      (data.botToken && data.botToken.trim().length > 0)
  );
  return hasChatId && hasMessage && hasAuth;
}

export const TelegramMetaData: React.FC<TelegramMetaDataProps> = ({
  handleClick,
  preSelectedServerId,
  initialData,
}) => {
  const [chatId, setChatId] = useState(initialData?.chatId ? String(initialData.chatId) : '');
  const [message, setMessage] = useState(initialData?.message || '');
  const [parseMode, setParseMode] = useState<'HTML' | 'Markdown' | 'MarkdownV2'>(
    initialData?.parseMode || 'HTML'
  );
  const [botId] = useState(initialData?.botId || preSelectedServerId || '');
  const [botToken, setBotToken] = useState(initialData?.botToken || '');
  const [showCustomToken, setShowCustomToken] = useState(
    Boolean(!preSelectedServerId && !initialData?.botId)
  );

  const insertPill = (pill: string) => {
    setMessage((prev) => (prev ? `${prev} ${pill}` : pill));
  };

  const payload: TelegramActionMetadataInput = {
    chatId: chatId.trim(),
    message: message.trim(),
    parseMode,
    ...(botId ? { botId } : {}),
    ...(botToken.trim() ? { botToken: botToken.trim() } : {}),
  };

  const isValid = canSaveTelegramMetadata(payload);

  return (
    <div className="meta-form">
      <div className="meta-form__header">
        <h3 className="meta-form__title">Telegram Send Message</h3>
        <p className="meta-form__subtitle">
          Deliver an automated message to a Telegram chat, group, or channel via your bot.
        </p>
      </div>

      <div>
        <label className="meta-form__label" htmlFor="telegram-chat-id">
          Target Chat ID
        </label>
        <input
          id="telegram-chat-id"
          name="chatId"
          type="text"
          className="meta-form__input"
          placeholder="e.g. 123456789, @channelusername, or {chatId}"
          value={chatId}
          onChange={(e) => setChatId(e.target.value)}
        />
        <p className="meta-form__hint">
          Use <code>{'{chatId}'}</code> to reply directly to the chat that triggered the Zap.
        </p>
      </div>

      <div>
        <div className="meta-form__field-row">
          <label className="meta-form__label" htmlFor="telegram-message">
            Message Text
          </label>
          <span className="meta-form__counter">{message.length} / 4096</span>
        </div>
        <textarea
          id="telegram-message"
          name="message"
          rows={5}
          className="meta-form__textarea"
          placeholder="Hi {firstName}! Here is your update: {text}"
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

      <div>
        <label className="meta-form__label" htmlFor="telegram-parse-mode">
          Parse Mode
        </label>
        <select
          id="telegram-parse-mode"
          name="parseMode"
          className="meta-form__input"
          value={parseMode}
          onChange={(e) => setParseMode(e.target.value as 'HTML' | 'Markdown' | 'MarkdownV2')}
        >
          <option value="HTML">HTML</option>
          <option value="Markdown">Markdown</option>
          <option value="MarkdownV2">MarkdownV2</option>
        </select>
      </div>

      <div className="meta-form__card">
        <div className="meta-form__card-header">
          <label className="meta-form__checkbox-label">
            <input
              type="checkbox"
              checked={showCustomToken}
              onChange={(e) => setShowCustomToken(e.target.checked)}
            />
            Custom Bot Token {botId ? '(Optional Override)' : '(Required)'}
          </label>
        </div>
        {showCustomToken && (
          <div className="meta-form__subgroup">
            <label className="meta-form__label" htmlFor="telegram-bot-token">
              Bot Token (@BotFather)
            </label>
            <input
              id="telegram-bot-token"
              name="botToken"
              type="password"
              className="meta-form__input"
              placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
            />
          </div>
        )}
      </div>

      <button
        type="button"
        className="meta-form__block-btn"
        disabled={!isValid}
        onClick={() => isValid && handleClick(payload)}
      >
        Save Telegram Action
      </button>
    </div>
  );
};

export default TelegramMetaData;
