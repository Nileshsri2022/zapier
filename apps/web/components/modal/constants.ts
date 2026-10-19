import { App } from './types';

export const APPS: App[] = [
  { id: 'ai', name: 'AI Transform', icon: '/apps/ai.svg', exact: 'AI Transform' },
  {
    id: 'gmail',
    name: 'Gmail',
    icon: '/apps/gmail.svg',
    prefix: 'Gmail',
  },
  {
    id: 'sheets',
    name: 'Google Sheets',
    icon: '/apps/sheets.svg',
    prefix: 'Google Sheets',
  },
  {
    id: 'calendar',
    name: 'Google Calendar',
    icon: '/apps/calendar.svg',
    prefix: 'Google Calendar',
  },
  {
    id: 'email',
    name: 'Email',
    icon: '/apps/email.svg',
    exact: 'Email',
  },
  {
    id: 'solana',
    name: 'Solana',
    icon: '/apps/Solana.svg',
    exact: 'Solana',
  },
  {
    id: 'github',
    name: 'GitHub',
    icon: '/apps/github.svg',
    prefix: 'GitHub',
  },
  {
    id: 'webhook',
    name: 'Webhook',
    icon: '/apps/webhook.svg',
    exact: 'Webhook',
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    icon: '/apps/whatsapp.svg',
    prefix: 'WhatsApp',
  },
  {
    id: 'telegram',
    name: 'Telegram',
    icon: '/apps/telegram.svg',
    prefix: 'Telegram',
  },
  {
    id: 'discord',
    name: 'Discord',
    icon: '/apps/discord.svg',
    prefix: 'Discord',
  },
  {
    id: 'schedule',
    name: 'Schedule',
    icon: '/apps/schedule.svg',
    prefix: 'Schedule',
    category: 'flow-controls',
  },
];
