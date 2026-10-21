'use client';
import { useState } from 'react';
import FormInput from '../FormInput';
import Button from '../Button';
import { MetaDataFormProps } from '../modal/types';

export interface SolanaMetaDataProps extends MetaDataFormProps {
  initialData?: {
    address?: string;
    amount?: string;
  };
}

const SolanaMetaData = ({ handleClick, initialData }: SolanaMetaDataProps) => {
  const [formData, setFormData] = useState({
    address: initialData?.address || '',
    amount: initialData?.amount || '',
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
        label="Address"
        name="address"
        placeholder="Solana recipient address or {address}"
        value={formData.address}
        onChange={handleFormDataChange}
      />
      <FormInput
        label="Amount"
        name="amount"
        placeholder="Amount in SOL (e.g. 0.1 or {amount})"
        value={formData.amount}
        onChange={handleFormDataChange}
      />
      <Button variant="secondary" onClick={() => handleClick(formData)}>
        Save
      </Button>
    </div>
  );
};

export default SolanaMetaData;
