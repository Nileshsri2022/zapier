'use client';
import { useState } from 'react';
import Button from '../Button';
import { MetaDataFormProps } from '../modal/types';

/**
 * T7 — Telegram trigger config (Q-TG-T-03): per-Zap chat-type filter,
 * multi-select private/group/channel (default all = no restriction).
 * Bot id is threaded separately via Modal's bot-connect flow.
 */
const CHAT_TYPES = [
  { value: 'private', label: 'Private chats' },
  { value: 'group', label: 'Groups (incl. supergroups)' },
  { value: 'channel', label: 'Channels' },
];

const TelegramMetaData = ({ handleClick }: MetaDataFormProps) => {
  const [selected, setSelected] = useState<string[]>(CHAT_TYPES.map((c) => c.value));

  const toggle = (value: string) => {
    setSelected((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  };

  const handleSave = () => {
    // All selected (or none) = no restriction — omit from metadata.
    const all = selected.length === CHAT_TYPES.length;
    handleClick({
      ...(all ? {} : { chatTypes: selected }),
    });
  };

  return (
    <div className="meta-form__section">
      <div className="meta-form__header">
        <h3 className="meta-form__title">Telegram Trigger</h3>
        <p className="meta-form__subtitle">
          Fire this Zap when the connected bot receives a message.
        </p>
      </div>

      <div>
        <label className="meta-form__label">Chat types</label>
        {CHAT_TYPES.map((t) => (
          <label
            key={t.value}
            style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' }}
          >
            <input
              type="checkbox"
              checked={selected.includes(t.value)}
              onChange={() => toggle(t.value)}
            />
            {t.label}
          </label>
        ))}
        <p className="meta-form__hint">
          Matching only — messages outside this selection are dropped (no run).
        </p>
      </div>

      <div className="meta-form__panel">
        <p className="meta-form__hint">
          Note: in groups, bots only see commands and replies unless privacy mode is
          disabled in BotFather (/setprivacy).
        </p>
      </div>

      <Button variant="secondary" onClick={handleSave}>
        Save Configuration
      </Button>
    </div>
  );
};

export default TelegramMetaData;
