'use client';
import { useEffect, useState } from 'react';
import axios from 'axios';
import FormInput from '../FormInput';
import Button from '../Button';
import { MetaDataFormProps } from '../modal/types';
import { API_URL } from '@/lib/config';

/**
 * A6 — Telegram Send action builder (docs/ask-matt/actions/telegram.md, round 16).
 * Text or photo/document, parse mode off by default (HTML / MarkdownV2
 * selectable), numeric ids or @usernames, previews off by default, silent and
 * reply-to options. The bot token comes from the shared connection's bot.
 */
interface TelegramBot {
  id: string;
  botUsername?: string;
  botName?: string;
}

const TelegramActionMetaData = ({
  handleClick,
  botId,
}: MetaDataFormProps & { botId?: string }) => {
  const [bots, setBots] = useState<TelegramBot[]>([]);
  const [selectedBot, setSelectedBot] = useState(botId ?? '');
  const [form, setForm] = useState({
    chatId: '',
    text: '',
    parseMode: 'none',
    linkPreview: false,
    silent: false,
    replyToMessageId: '',
    mediaKind: 'photo',
    mediaSource: '',
    caption: '',
  });
  const [error, setError] = useState('');

  const update = (e: any) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get(`${API_URL}/api/telegram/bots`, { withCredentials: true });
        const list: TelegramBot[] = res?.data?.bots ?? res?.data?.servers ?? [];
        setBots(list);
        setSelectedBot((prev) => prev || list[0]?.id || '');
      } catch {
        setBots([]);
      }
    })();
  }, []);

  const [useMedia, setUseMedia] = useState(false);

  const save = () => {
    if (!selectedBot) {
      setError('Connect a Telegram bot first.');
      return;
    }
    if (!form.chatId.trim()) {
      setError('A chat id or @username is required.');
      return;
    }
    if (!useMedia && !form.text.trim()) {
      setError('Message text is required (or send media with a caption).');
      return;
    }
    if (useMedia && !form.mediaSource.trim()) {
      setError('Media needs a URL or a file_id.');
      return;
    }
    if (!useMedia && form.text.length > 4096) {
      setError(`Telegram allows 4096 characters; this message is ${form.text.length}.`);
      return;
    }

    handleClick({
      botId: selectedBot,
      chatId: form.chatId.trim(),
      ...(useMedia
        ? {
            media: {
              kind: form.mediaKind,
              source: form.mediaSource.trim(),
              ...(form.caption.trim() ? { caption: form.caption } : {}),
            },
          }
        : { text: form.text }),
      ...(form.parseMode !== 'none' ? { parseMode: form.parseMode } : {}),
      ...(form.linkPreview ? { linkPreview: true } : {}),
      ...(form.silent ? { silent: true } : {}),
      ...(form.replyToMessageId.trim()
        ? { replyToMessageId: Number(form.replyToMessageId) }
        : {}),
    });
  };

  return (
    <div className="meta-form">
      <label className="meta-form__label">Bot</label>
      <select
        className="meta-form__input"
        name="botId"
        value={selectedBot}
        onChange={(e) => setSelectedBot(e.target.value)}
      >
        {bots.length === 0 && <option value="">No connected Telegram bot</option>}
        {bots.map((bot) => (
          <option key={bot.id} value={bot.id}>
            @{bot.botUsername || bot.botName || bot.id}
          </option>
        ))}
      </select>

      <FormInput
        label="Chat (numeric id like -1001234567890, or @username)"
        name="chatId"
        onChange={update}
      />

      <label className="meta-form__label">
        <input
          type="checkbox"
          checked={useMedia}
          onChange={(e) => setUseMedia(e.target.checked)}
        />{' '}
        Send media (photo or document) instead of text
      </label>

      {useMedia ? (
        <>
          <label className="meta-form__label">Media kind</label>
          <select className="meta-form__input" name="mediaKind" value={form.mediaKind} onChange={update}>
            <option value="photo">Photo</option>
            <option value="document">Document</option>
          </select>
          <FormInput label="Media URL or file_id" name="mediaSource" onChange={update} />
          <FormInput label={`Caption (max 1024 chars)`} name="caption" onChange={update} />
        </>
      ) : (
        <>
          <label className="meta-form__label">Text (max 4096 chars, never truncated)</label>
          <textarea
            className="meta-form__textarea"
            rows={6}
            name="text"
            placeholder="Order {{previousOutput.fields.id}} shipped 📦"
            onChange={update}
          />
        </>
      )}

      <label className="meta-form__label">Parse mode</label>
      <select className="meta-form__input" name="parseMode" value={form.parseMode} onChange={update}>
        <option value="none">None (safest — mapped data cannot break parsing)</option>
        <option value="HTML">HTML</option>
        <option value="MarkdownV2">MarkdownV2</option>
      </select>

      <label className="meta-form__label">
        <input type="checkbox" name="linkPreview" checked={form.linkPreview} onChange={update} />{' '}
        Show link previews (off by default)
      </label>
      <label className="meta-form__label">
        <input type="checkbox" name="silent" checked={form.silent} onChange={update} /> Send
        silently
      </label>
      <FormInput label="Reply to message id (optional)" name="replyToMessageId" onChange={update} />

      <p className="meta-form__hint">
        The bot must be a member/admin of the target group or channel, and DM recipients must have
        started the bot — Telegram returns 403 otherwise.
      </p>

      {error && <p className="meta-form__error-text">{error}</p>}
      <Button variant="secondary" onClick={save}>
        Save
      </Button>
    </div>
  );
};

export default TelegramActionMetaData;
