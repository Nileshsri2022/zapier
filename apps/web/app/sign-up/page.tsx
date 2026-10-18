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
      <h1 className="p-4 absolute text-2xl font-bold translate-y-[-4px] hover:text-primary-500 transition-all">
        <Link href={'/'}>ZapMate</Link>
      </h1>

      <div className="auth-aside">
        <h2>Join millions worldwide who automate their work using ZapMate.</h2>
        <ul className="flex flex-col gap-4">
          {POINTS.map((point) => (
            <li key={point} className="flex items-center gap-2">
              <Check className="size-5 shrink-0 text-success" aria-hidden="true" />
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
