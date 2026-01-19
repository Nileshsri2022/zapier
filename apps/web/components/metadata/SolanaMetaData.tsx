'use client';
import { useState } from 'react';
import FormInput from '../FormInput';
import Button from '../Button';
import { MetaDataFormProps } from '../modal/types';

const SolanaMetaData = ({ handleClick }: MetaDataFormProps) => {
  const [formData, setFormData] = useState({
    address: '',
    amount: '',
  });

  const handleFormDataChange = (e: any) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  return (
    <div className="my-4 flex flex-col gap-4 text-secondary-500">
      <FormInput label="Address" name="address" onChange={handleFormDataChange} />
      <FormInput label="Amount" name="amount" onChange={handleFormDataChange} />
      <Button variant="secondary" onClick={() => handleClick(formData)}>
        Save
      </Button>
    </div>
  );
};

export default SolanaMetaData;
