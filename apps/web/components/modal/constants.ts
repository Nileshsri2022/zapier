import { App } from './types';

export const APPS: App[] = [
  {
    id: 'gmail',
    name: 'Gmail',
    icon: '/apps-v2/gmail.svg',
    prefix: 'Gmail',
  },
  {
    id: 'sheets',
    name: 'Google Sheets',
    icon: '/apps-v2/sheets.svg',
    prefix: 'Google Sheets',
  },
  {
    id: 'calendar',
    name: 'Google Calendar',
    icon: '/apps-v2/calendar.svg',
    prefix: 'Google Calendar',
  },
  {
    id: 'email',
    name: 'Email',
    icon: '/apps-v2/email.svg',
    exact: 'Email',
  },
  {
    id: 'solana',
    name: 'Solana',
    icon: '/apps-v2/Solana.svg',
    exact: 'Solana',
  },
  {
    id: 'github',
    name: 'GitHub',
    icon: '/apps-v2/github.svg',
    prefix: 'GitHub',
  },
  {
    id: 'webhook',
    name: 'Webhook',
    icon: '/apps-v2/webhook.svg',
    exact: 'Webhook',
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    icon: '/apps-v2/whatsapp.svg',
    prefix: 'WhatsApp',
  },
  {
    id: 'telegram',
    name: 'Telegram',
    icon: '/apps-v2/telegram.svg',
    prefix: 'Telegram',
  },
  {
    id: 'schedule',
    name: 'Schedule',
    icon: '/apps-v2/schedule.svg',
    prefix: 'Schedule',
    category: 'flow-controls',
  },
];
