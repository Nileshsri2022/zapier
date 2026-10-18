import React from 'react';
import { SignupForm } from '@/components/AuthForm';
import Link from 'next/link';
import { Check } from 'lucide-react';

const POINTS = [
  'Easy setup, no coding required',
  'Free forever for core features',
  '14-day trial of premium features & apps',
];

const page = () => {
  return (
    <div className="auth-shell">
      <h1 className="auth-brand">
        <Link href={'/'}>ZapMate</Link>
      </h1>

      <div className="auth-aside">
        <h2>Join millions worldwide who automate their work using ZapMate.</h2>
        <ul className="auth-points">
          {POINTS.map((point) => (
            <li key={point} className="auth-point">
              <Check className="auth-point__icon" aria-hidden="true" />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="auth-main">
        <h2>Create your account</h2>
        <SignupForm />
      </div>
    </div>
  );
};

export default page;
