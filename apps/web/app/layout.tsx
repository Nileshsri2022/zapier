import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
/* Style files (spec: code/styles separation) — order matters: tokens → base → helpers → components */
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/utilities.css';
import '../styles/components/button.css';
import '../styles/components/form-input.css';
import '../styles/components/spinner.css';
import '../styles/components/tooltip.css';
import '../styles/pages/landing.css';
import '../styles/pages/app.css';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { Analytics } from '@vercel/analytics/react';
import PWAInstaller from '@/components/PWAInstaller';

const geistSans = localFont({
  src: './fonts/GeistVF.woff',
  variable: '--font-geist-sans',
  weight: '100 900',
});
const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-geist-mono',
  weight: '100 900',
});

export const metadata: Metadata = {
  title: 'ZapMate',
  description: 'Automate your workflows with ZapMate',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'ZapMate',
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    apple: '/icons/icon-192x192.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#FF4F00',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
        <link rel="apple-touch-icon" sizes="152x152" href="/icons/icon-152x152.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/icons/icon-180x180.png" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable}`}
      >
        {children}
        <PWAInstaller />
        <ToastContainer stacked />
        <Analytics />
      </body>
    </html>
  );
}
