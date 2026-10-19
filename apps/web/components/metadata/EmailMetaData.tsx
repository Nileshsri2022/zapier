'use client';
import { useState } from 'react';
import FormInput from '../FormInput';
import Button from '../Button';
import { MetaDataFormProps } from '../modal/types';

const EmailMetaData = ({ handleClick }: MetaDataFormProps) => {
  const [formData, setFormData] = useState({
    to: '',
    subject: '',
    body: '',
  });

  const handleFormDataChange = (e: any) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  return (
    <div className="meta-form">
      <FormInput label="To" name="to" onChange={handleFormDataChange} />
      <FormInput label="Subject" name="subject" onChange={handleFormDataChange} />
      <textarea
        className="meta-form__textarea"
        placeholder="Email content..."
        rows={8}
        name="body"
        onChange={handleFormDataChange}
      />
      <Button variant="secondary" onClick={() => handleClick(formData)}>
        Save
      </Button>
    </div>
  );
};

export default EmailMetaData;
