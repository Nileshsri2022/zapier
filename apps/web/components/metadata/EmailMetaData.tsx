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
    <div className="my-4 flex flex-col gap-4 text-secondary-500">
      <FormInput label="To" name="to" onChange={handleFormDataChange} />
      <FormInput label="Subject" name="subject" onChange={handleFormDataChange} />
      <textarea
        className="text-black rounded-sm border border-gray-400 p-2 bg-base-100"
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
