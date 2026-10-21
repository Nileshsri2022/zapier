import { APP_META, offeredActions, type ActionApp } from '@repo/actions';
import { App } from './types';

/**
 * How the picker groups what the database offers.
 *
 * The catalog decides *which* action types exist (server seeds it, worker
 * dispatches it); this table only decides which app card they appear under, in
 * what order, and with which icon. Action apps therefore derive both their
 * types and their display data from `@repo/actions` — only the trigger apps,
 * which are not in the action catalog, keep their own prefix rules.
 */

/** Computed once at module load, not per render. */
const ACTION_TYPES_BY_APP = Object.fromEntries(
  Object.keys(APP_META).map((app) => [
    app,
    offeredActions()
      .filter((entry) => entry.app === app)
      .map((entry) => entry.type),
  ])
) as Record<ActionApp, string[]>;

const actionApp = (app: ActionApp): App => ({
  id: app,
  name: APP_META[app].name,
  icon: APP_META[app].image,
  types: ACTION_TYPES_BY_APP[app],
});

export const APPS: App[] = [
  actionApp('ai'),
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
  actionApp('email'),
  actionApp('solana'),
  {
    id: 'github',
    name: 'GitHub',
    icon: '/apps/github.svg',
    prefix: 'GitHub',
  },
  actionApp('webhook'),
  actionApp('whatsapp'),
  actionApp('telegram'),
  actionApp('discord'),
  {
    id: 'schedule',
    name: 'Schedule',
    icon: '/apps/schedule.svg',
    prefix: 'Schedule',
    category: 'flow-controls',
  },
];
