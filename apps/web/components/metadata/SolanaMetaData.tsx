'use client';
import { useState } from 'react';
import FormInput from '../FormInput';
import Button from '../Button';
import { MetaDataFormProps } from '../modal/types';

/**
 * A3 — Solana action builder, READ-ONLY v1 (docs/ask-matt/actions/solana.md).
 * No wallet/secret-key fields exist anywhere: only the network (connection
 * scoped), an optional private RPC URL and the read operation's inputs.
 */
const OPERATIONS = [
  { value: 'getBalance', label: 'Get balance (SOL)' },
  { value: 'getTokenAccounts', label: 'Get token accounts (SPL)' },
  { value: 'getAccount', label: 'Get account / raw data' },
  { value: 'getLatestBlockhash', label: 'Get latest blockhash' },
  { value: 'getSlot', label: 'Get current slot' },
  { value: 'getVersion', label: 'Get node version' },
];

const SolanaMetaData = ({
  handleClick,
  initialData,
}: MetaDataFormProps & { initialData?: Record<string, any> }) => {
  const initial = (initialData ?? {}) as Record<string, any>;
  const [formData, setFormData] = useState({
    operation: initial.operation ?? 'getBalance',
    network: initial.network ?? 'mainnet-beta',
    rpcUrl: initial.rpcUrl ?? '',
    address: initial.address ?? '',
    owner: initial.owner ?? '',
    mint: initial.mint ?? '',
  });
  const [error, setError] = useState('');

  const handleFormDataChange = (e: any) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const needsAddress = ['getBalance', 'getAccount'].includes(formData.operation);
  const needsOwner = formData.operation === 'getTokenAccounts';

  const save = () => {
    if (needsAddress && !formData.address.trim()) {
      setError('An address is required for this operation.');
      return;
    }
    if (needsOwner && !(formData.owner.trim() || formData.address.trim())) {
      setError('An owner address is required for this operation.');
      return;
    }
    // Only send the inputs this operation uses.
    const payload: Record<string, string> = {
      operation: formData.operation,
      network: formData.network,
    };
    if (formData.rpcUrl.trim()) payload.rpcUrl = formData.rpcUrl.trim();
    if (needsAddress) payload.address = formData.address.trim();
    if (needsOwner) {
      payload.owner = (formData.owner || formData.address).trim();
      if (formData.mint.trim()) payload.mint = formData.mint.trim();
    }
    handleClick(payload);
  };

  return (
    <div className="meta-form">
      <label className="meta-form__label">Operation (read-only)</label>
      <select
        className="meta-form__input"
        name="operation"
        value={formData.operation}
        onChange={handleFormDataChange}
      >
        {OPERATIONS.map((op) => (
          <option key={op.value} value={op.value}>
            {op.label}
          </option>
        ))}
      </select>

      <label className="meta-form__label">Network</label>
      <select
        className="meta-form__input"
        name="network"
        value={formData.network}
        onChange={handleFormDataChange}
      >
        <option value="mainnet-beta">mainnet-beta</option>
        <option value="devnet">devnet</option>
        <option value="testnet">testnet</option>
      </select>

      <FormInput
        label="Custom RPC URL (optional — public endpoint used if empty)"
        name="rpcUrl"
        onChange={handleFormDataChange}
      />

      {needsAddress && <FormInput label="Address" name="address" onChange={handleFormDataChange} />}

      {needsOwner && (
        <>
          <FormInput label="Owner address" name="owner" onChange={handleFormDataChange} />
          <FormInput
            label="Mint (optional — empty returns all SPL token accounts)"
            name="mint"
            onChange={handleFormDataChange}
          />
        </>
      )}

      <p className="meta-form__hint">
        v1 only reads on-chain state. Sending SOL or tokens is not available: no keys are ever
        stored or handled by ZapMate.
      </p>

      {error && <p className="meta-form__error-text">{error}</p>}
      <Button variant="secondary" onClick={save}>
        Save
      </Button>
    </div>
  );
};

export default SolanaMetaData;
