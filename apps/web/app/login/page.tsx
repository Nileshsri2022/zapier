import { LoginForm } from '@/components/AuthForm';
import Link from 'next/link';
import React from 'react';

const page = () => {
  return (
    <div className="auth-shell">
      <h1 className="p-4 absolute text-2xl font-bold translate-y-[-4px] hover:text-primary-500 transition-all">
        <Link href={'/'}>ZapMate</Link>
      </h1>
      <div className="auth-aside">
        <h2>Automate across your teams</h2>
        <p>
          Zapmate Enterprise empowers everyone in your business to securely automate their work in
          minutes, not months—no coding required.
        </p>
      </div>
      <div className="auth-main">
        <h2>Login to your account</h2>
        <LoginForm />
      </div>
    </div>
  );
};

export default page;
