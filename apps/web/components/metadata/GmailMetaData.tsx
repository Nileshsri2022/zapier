'use client';
import { useState } from 'react';
import FormInput from '../FormInput';
import Button from '../Button';

export interface GmailMetaDataProps {
  handleClick: (data: any) => void;
  selectedType: string;
  preSelectedServerId?: string;
  initialData?: {
    to?: string;
    subject?: string;
    body?: string;
    labelName?: string;
    replyMessage?: string;
    senderFilter?: string;
    subjectFilter?: string;
    watchedLabels?: string | string[];
    serverId?: string;
  };
}

const GmailMetaData = ({
  handleClick,
  selectedType,
  preSelectedServerId,
  initialData,
}: GmailMetaDataProps) => {
  const [formData, setFormData] = useState({
    to: initialData?.to || '',
    subject: initialData?.subject || '',
    body: initialData?.body || '',
    labelName: initialData?.labelName || '',
    replyMessage: initialData?.replyMessage || '',
    senderFilter: initialData?.senderFilter || '',
    subjectFilter: initialData?.subjectFilter || '',
    watchedLabels: Array.isArray(initialData?.watchedLabels)
      ? initialData.watchedLabels.join(',')
      : initialData?.watchedLabels || '',
  });

  const serverId = initialData?.serverId || preSelectedServerId || '';

  const emitSave = (payload: Record<string, any>) => {
    handleClick({
      ...payload,
      ...(serverId ? { serverId } : {}),
    });
  };

  const handleFormDataChange = (e: any) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const renderGmailForm = () => {
    switch (selectedType) {
      case 'Gmail Send Email':
        return (
          <div className="meta-form">
            <FormInput
              label="To"
              name="to"
              placeholder="recipient@example.com"
              value={formData.to}
              onChange={handleFormDataChange}
            />
            <FormInput
              label="Subject"
              name="subject"
              placeholder="Email subject"
              value={formData.subject}
              onChange={handleFormDataChange}
            />
            <textarea
              className="meta-form__textarea"
              placeholder="Email content..."
              rows={8}
              name="body"
              value={formData.body}
              onChange={handleFormDataChange}
            />
            <Button variant="secondary" onClick={() => emitSave(formData)}>
              Save
            </Button>
          </div>
        );
      case 'Gmail Reply':
        return (
          <div className="meta-form">
            <textarea
              className="meta-form__textarea"
              placeholder="Reply message..."
              rows={8}
              name="replyMessage"
              value={formData.replyMessage}
              onChange={handleFormDataChange}
            />
            <Button variant="secondary" onClick={() => emitSave(formData)}>
              Save
            </Button>
          </div>
        );
      case 'Gmail Add Label':
      case 'Gmail Remove Label':
        return (
          <div className="meta-form">
            <FormInput
              label={`${selectedType === 'Gmail Add Label' ? 'Add' : 'Remove'} Label`}
              name="labelName"
              placeholder="Label name"
              value={formData.labelName}
              onChange={handleFormDataChange}
            />
            <Button variant="secondary" onClick={() => emitSave(formData)}>
              Save
            </Button>
          </div>
        );
      case 'Gmail Mark as Read':
      case 'Gmail Archive':
        return (
          <div className="meta-form">
            <p className="meta-form__text">No additional configuration needed for this action.</p>
            <Button variant="secondary" onClick={() => emitSave({})}>
              Save
            </Button>
          </div>
        );
      case 'Gmail New Email':
        return (
          <div className="meta-form">
            <FormInput
              label="Sender Filter (optional)"
              name="senderFilter"
              placeholder="sender@example.com"
              value={formData.senderFilter}
              onChange={handleFormDataChange}
            />
            <FormInput
              label="Subject Filter (optional)"
              name="subjectFilter"
              placeholder="Contains keyword"
              value={formData.subjectFilter}
              onChange={handleFormDataChange}
            />
            <FormInput
              label="Watch Labels (optional)"
              name="watchedLabels"
              placeholder="INBOX,SENT,IMPORTANT"
              value={formData.watchedLabels}
              onChange={handleFormDataChange}
            />
            <Button variant="secondary" onClick={() => emitSave(formData)}>
              Save
            </Button>
          </div>
        );
      case 'Gmail Labeled':
        return (
          <div className="meta-form">
            <FormInput
              label="Watch Labels"
              name="watchedLabels"
              placeholder="INBOX,SENT,IMPORTANT"
              value={formData.watchedLabels}
              onChange={handleFormDataChange}
            />
            <Button variant="secondary" onClick={() => emitSave(formData)}>
              Save
            </Button>
          </div>
        );
      case 'Gmail Starred':
        return (
          <div className="meta-form">
            <p className="meta-form__text">
              No additional configuration needed for starred emails trigger.
            </p>
            <Button variant="secondary" onClick={() => emitSave({})}>
              Save
            </Button>
          </div>
        );
      case 'Gmail From Sender':
        return (
          <div className="meta-form">
            <FormInput
              label="Sender Email"
              name="senderFilter"
              placeholder="sender@example.com"
              value={formData.senderFilter}
              onChange={handleFormDataChange}
            />
            <Button variant="secondary" onClick={() => emitSave(formData)}>
              Save
            </Button>
          </div>
        );
      default:
        return (
          <div className="meta-form">
            <p className="meta-form__text">Unknown Gmail action type.</p>
            <Button variant="secondary" onClick={() => emitSave({})}>
              Save
            </Button>
          </div>
        );
    }
  };

  return renderGmailForm();
};

export default GmailMetaData;
