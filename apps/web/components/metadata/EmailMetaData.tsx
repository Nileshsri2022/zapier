'use client';
import { useState } from 'react';
import FormInput from '../FormInput';
import Button from '../Button';
import { MetaDataFormProps } from '../modal/types';

/**
 * A2 — Email action builder (docs/ask-matt/actions/email.md, Q-EMAIL-02).
 * Full field set: to/cc/bcc, subject, bodyPlain (required) + bodyHtml,
 * fromName/fromEmail (constrained to owned Gmail identities), replyTo and
 * URL attachments (≤ 5 MB, fetched at run time). Fields accept mapped inputs.
 */
const EmailMetaData = ({ handleClick }: MetaDataFormProps) => {
  const [formData, setFormData] = useState({
    to: '',
    cc: '',
    bcc: '',
    subject: '',
    bodyPlain: '',
    bodyHtml: '',
    fromName: '',
    fromEmail: '',
    replyTo: '',
  });
  const [attachments, setAttachments] = useState<{ url: string; filename: string }[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState('');

  const handleFormDataChange = (e: any) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const save = () => {
    if (!formData.to.trim()) {
      setError('At least one recipient is required.');
      return;
    }
    if (!formData.subject.trim()) {
      setError('A subject is required.');
      return;
    }
    if (!formData.bodyPlain.trim()) {
      setError('A plain-text body is required.');
      return;
    }
    const cleaned = attachments.filter((a) => a.url.trim());
    handleClick({ ...formData, attachments: cleaned });
  };

  return (
    <div className="meta-form">
      <FormInput label="To (comma separated)" name="to" onChange={handleFormDataChange} />
      <FormInput label="Subject" name="subject" onChange={handleFormDataChange} />
      <label className="meta-form__label">Body (plain text, required)</label>
      <textarea
        className="meta-form__textarea"
        placeholder="Email content... mapped fields like {{previousOutput.fields.name}} are supported"
        rows={8}
        name="bodyPlain"
        onChange={handleFormDataChange}
      />
      <label className="meta-form__label">Body (HTML, optional)</label>
      <textarea
        className="meta-form__textarea"
        placeholder="<p>Optional HTML version</p>"
        rows={5}
        name="bodyHtml"
        onChange={handleFormDataChange}
      />

      <Button variant="secondary" onClick={() => setShowAdvanced(!showAdvanced)}>
        {showAdvanced ? 'Hide advanced' : 'Advanced (cc, bcc, reply-to, from, attachments)'}
      </Button>

      {showAdvanced && (
        <>
          <FormInput label="Cc (comma separated)" name="cc" onChange={handleFormDataChange} />
          <FormInput label="Bcc (comma separated)" name="bcc" onChange={handleFormDataChange} />
          <FormInput label="Reply-To" name="replyTo" onChange={handleFormDataChange} />
          <FormInput label="From name" name="fromName" onChange={handleFormDataChange} />
          <FormInput
            label="From email (must be the connected mailbox or a verified alias)"
            name="fromEmail"
            onChange={handleFormDataChange}
          />

          <label className="meta-form__label">Attachments (URL, max 5 MB each)</label>
          {attachments.map((attachment, index) => (
            <div key={index} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                className="meta-form__input"
                placeholder="https://example.com/report.pdf"
                value={attachment.url}
                onChange={(e) => {
                  const next = [...attachments];
                  next[index] = {
                    url: e.target.value,
                    filename: next[index]?.filename ?? '',
                  };
                  setAttachments(next);
                }}
              />
              <input
                className="meta-form__input"
                placeholder="filename (optional)"
                value={attachment.filename}
                onChange={(e) => {
                  const next = [...attachments];
                  next[index] = {
                    url: next[index]?.url ?? '',
                    filename: e.target.value,
                  };
                  setAttachments(next);
                }}
              />
              <Button
                variant="secondary"
                onClick={() => setAttachments(attachments.filter((_, i) => i !== index))}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            onClick={() => setAttachments([...attachments, { url: '', filename: '' }])}
          >
            Add attachment URL
          </Button>
        </>
      )}

      {error && <p className="meta-form__error-text">{error}</p>}
      <Button variant="secondary" onClick={save}>
        Save
      </Button>
    </div>
  );
};

export default EmailMetaData;
