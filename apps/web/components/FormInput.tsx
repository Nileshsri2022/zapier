import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * First-party FormInput — LOGIC ONLY (spec G2).
 * Structure comes from shadcn/ui Input + Label; the look lives in
 * styles/components/form-input.css (semantic `.form-input` class).
 */
const FormInput = ({
  label,
  name,
  onChange,
  placeholder,
  value,
  type,
}: {
  label: string;
  name: string;
  onChange: (e: any) => void;
  placeholder?: string;
  value?: string;
  type?: string;
}) => {
  return (
    <div className="form-input">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type={type || (label === 'Password' ? 'password' : 'text')}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
      />
    </div>
  );
};

export default FormInput;
