'use client';
import { useState } from 'react';
import FormInput from '../FormInput';
import Button from '../Button';
import { MetaDataFormProps } from '../modal/types';

export interface EmailMetaDataProps extends MetaDataFormProps {
  initialData?: {
    to?: string;
    subject?: string;
    body?: string;
  };
}

const EmailMetaData = ({ handleClick, initialData }: EmailMetaDataProps) => {
  const [formData, setFormData] = useState({
    to: initialData?.to || '',
    subject: initialData?.subject || '',
    body: initialData?.body || '',
  });

  const handleFormDataChange = (e: any) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  return (
    <div className="meta-form">
      <FormInput
        label="To"
        name="to"
        placeholder="recipient@example.com or {email}"
        value={formData.to}
        onChange={handleFormDataChange}
      />
      <FormInput
        label="Subject"
        name="subject"
        placeholder="Notification: {subject}"
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
      <Button variant="secondary" onClick={() => handleClick(formData)}>
        Save
      </Button>
    </div>
  );
};

export default EmailMetaData;
