/**
 * BUG: the dashboard shows a webhook URL (plus a "Copy URL" button) for EVERY
 * Zap, whatever its trigger type.
 *
 * apps/web/app/dashboard/page.tsx:191-192 (desktop table) and :378-379 (mobile
 * cards) build the same string unconditionally:
 *
 *   const url = `${HOOKS_URL}/hooks/${session?.user?.id}/${zap.id}`;
 *
 * and render it at :237-245 and :430-443. For a Schedule, Gmail, Google Sheets,
 * Google Calendar, GitHub, WhatsApp or Telegram trigger that URL is not the
 * Zap's trigger — it is the generic ingress endpoint
 * (`apps/hooks/src/index.ts:37 POST /hooks/:userId/:zapId`), which enqueues a run
 * for any zapId it is given. So the UI hands every user a copy-paste URL that
 * (a) does not describe their Zap's actual trigger and (b) injects arbitrary
 * trigger data into Zaps that were never meant to be webhook-driven.
 *
 * Expected (green): the hook URL is shown only for Zaps whose trigger is a
 * Webhook trigger; other trigger types show their own identity (schedule,
 * mailbox, sheet, bot, …) and no copyable ingress URL.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, React, Renderer, act } = require('./harness.cjs');

const stub = (name) => {
  const Component = (props) => React.createElement('div', { 'data-stub': name, ...props });
  Component.displayName = name;
  return Component;
};

const session = { user: { id: 42, email: 'ada@example.com', name: 'Ada' } };

const zaps = [
  {
    id: 'zap-webhook',
    name: 'Inbound Webhook Zap',
    triggerId: 't1',
    actions: [],
    isActive: true,
    createdDate: '2026-01-01T00:00:00.000Z',
    trigger: {
      id: 'tr1',
      metadata: null,
      triggerId: 't1',
      zapId: 'zap-webhook',
      trigger: { type: 'Webhook', image: '/apps/webhook.svg' },
    },
  },
  {
    id: 'zap-schedule',
    name: 'Hourly Digest Zap',
    triggerId: 't2',
    actions: [],
    isActive: true,
    createdDate: '2026-01-01T00:00:00.000Z',
    trigger: {
      id: 'tr2',
      metadata: null,
      triggerId: 't2',
      zapId: 'zap-schedule',
      trigger: { type: 'Schedule Every Hour', image: '/apps/schedule.svg' },
    },
  },
];

async function renderDashboard(t) {
  const axios = {
    get: async (url) => {
      if (url.includes('/api/zaps')) return { data: { data: { zaps, total: zaps.length } } };
      return { data: {} };
    },
    patch: async () => ({ data: {} }),
    delete: async () => ({ data: {} }),
    post: async () => ({ data: {} }),
  };

  const Page = load('../../apps/web/app/dashboard/page.tsx', {
    axios,
    'react-toastify': { toast: { error: () => {}, success: () => {} } },
    '@/components/MainSection': { __esModule: true, default: stub('MainSection') },
    '@/components/Button': { __esModule: true, default: stub('Button') },
    '@/components/Spinner': { __esModule: true, default: stub('Spinner') },
    '@/components/Tooltip': { __esModule: true, default: stub('Tooltip') },
    '@/components/ZapRunHistory': { __esModule: true, default: stub('ZapRunHistory') },
    '@/lib/config': { API_URL: '', HOOKS_URL: 'https://hooks.example.com' },
    '@/lib/appIcon': { appIcon: () => '/apps/x.svg' },
    'next/navigation': { useRouter: () => ({ push: () => {}, refresh: () => {} }) },
    'next/link': {
      __esModule: true,
      default: ({ children, href }) => React.createElement('a', { href }, children),
    },
    '../../helper': {
      getSessionDetails: () => session,
      formatDateTimeToCustomString: () => 'Jan 1, 2026',
    },
  }).default;

  let view;
  await act(async () => {
    view = Renderer.create(React.createElement(Page));
  });
  // Let the data fetch settle.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
  t.after(() => act(() => view.unmount()));
  return view;
}

const text = (node) => {
  try {
    return node.children.map((c) => (typeof c === 'string' ? c : text(c))).join('');
  } catch {
    return '';
  }
};

test('the hook URL is offered only for webhook-triggered Zaps', async (t) => {
  const view = await renderDashboard(t);
  const rendered = text(view.root);

  const hookUrls = rendered.match(/https:\/\/hooks\.example\.com\/hooks\/42\/zap-[a-z]+/g) || [];

  assert.ok(
    hookUrls.length > 0,
    'sanity: the dashboard should still show the hook URL for the Webhook Zap'
  );
  assert.ok(
    !hookUrls.some((u) => u.includes('zap-schedule')),
    `the Schedule Zap must not be given a webhook ingress URL, found: ${JSON.stringify(hookUrls)}`
  );
  assert.deepEqual(
    [...new Set(hookUrls)],
    ['https://hooks.example.com/hooks/42/zap-webhook']
  );
});
