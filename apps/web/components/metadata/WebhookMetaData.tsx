'use client';
import { useState } from 'react';
import FormInput from '../FormInput';
import Button from '../Button';
import { MetaDataFormProps } from '../modal/types';

const WebhookMetaData = ({ handleClick }: MetaDataFormProps) => {
  const [formData, setFormData] = useState({
    url: '',
    method: 'POST',
    headers: '{}',
  });

  const handleFormDataChange = (e: any) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  return (
    <div className="my-4 flex flex-col gap-4 text-secondary-500">
      <FormInput
        label="Webhook URL"
        name="url"
        placeholder="https://your-app.com/webhook"
        onChange={handleFormDataChange}
      />
      <div>
        <label className="block text-sm font-medium mb-1">Method</label>
        <select
          name="method"
          value={formData.method}
          onChange={handleFormDataChange}
          className="w-full p-2 border border-gray-300 rounded-md"
        >
          <option value="POST">POST</option>
          <option value="GET">GET</option>
          <option value="PUT">PUT</option>
          <option value="PATCH">PATCH</option>
        </select>
      </div>
      <FormInput
        label="Headers (JSON)"
        name="headers"
        placeholder='{"Content-Type": "application/json"}'
        onChange={handleFormDataChange}
      />
      <Button variant="secondary" onClick={() => handleClick(formData)}>
        Save
      </Button>
    </div>
  );
};

export default WebhookMetaData;
