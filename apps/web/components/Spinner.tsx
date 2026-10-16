import React from 'react';
import { Spinner as UISpinner } from '@/components/ui/spinner';

/**
 * First-party Spinner — LOGIC ONLY (spec G2/D4).
 * The ring animation lives in the vendor component; the color mapping is a
 * `data-color` hook styled by styles/components/spinner.css (token-based).
 */
const Spinner = ({ color }: { color: string }) => {
  return <UISpinner className="spinner" data-color={color} />;
};

export default Spinner;
