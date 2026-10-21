const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const TestRenderer = require('react-test-renderer');

function loadTsModule(relativePath, mocks = {}) {
  const filePath = path.resolve(__dirname, '..', relativePath);
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;

  const mod = { exports: {} };
  const customRequire = (id) => {
    if (id in mocks) return mocks[id];
    if (id === 'react') return React;
    if (id === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (id.startsWith('@/')) {
      const aliasRel = id.slice(2);
      const webRoot = path.resolve(__dirname, '..');
      const candidateBase = path.resolve(webRoot, aliasRel);
      for (const ext of ['', '.tsx', '.ts', '.js', '/index.ts', '/index.tsx']) {
        if (fs.existsSync(candidateBase + ext) && fs.statSync(candidateBase + ext).isFile()) {
          return loadTsModule(path.relative(webRoot, candidateBase + ext), mocks);
        }
      }
    }
    if (id.startsWith('.')) {
      const resolved = path.resolve(path.dirname(filePath), id);
      for (const ext of ['.tsx', '.ts', '.js', '/index.ts', '/index.tsx']) {
        if (fs.existsSync(resolved + ext)) {
          return loadTsModule(path.relative(path.resolve(__dirname, '..'), resolved + ext), mocks);
        }
      }
    }
    return require(id);
  };

  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', transpiled);
  fn(mod.exports, customRequire, mod, filePath, path.dirname(filePath));
  return mod.exports;
}

const mockStub = () => null;
const baseMocks = {
  axios: { get: async () => ({ data: {} }), post: async () => ({ data: {} }) },
  'react-toastify': { toast: { error: () => {}, success: () => {} } },
  '@/lib/config': { API_URL: 'http://localhost:3005' },
  '@/lib/oauth': { redirectToOAuth: () => {}, savePendingSelection: () => {} },
  './metadata': {
    AiMetaData: mockStub,
    EmailMetaData: mockStub,
    SolanaMetaData: mockStub,
    WebhookMetaData: mockStub,
    GmailMetaData: mockStub,
    GoogleSheetsMetaData: mockStub,
    GoogleCalendarMetaData: mockStub,
    ScheduleMetaData: mockStub,
    GitHubMetaData: mockStub,
    DiscordMetaData: mockStub,
    WhatsAppMetaData: mockStub,
    TelegramMetaData: mockStub,
  },
};

test('Modal Seam: doesStepRequireMetadata routes all configurable triggers and actions to Step 3', () => {
  const { doesStepRequireMetadata } = loadTsModule('components/Modal.tsx', baseMocks);

  for (const type of [
    'Gmail New Email',
    'Gmail Labeled',
    'Gmail Starred',
    'Gmail From Sender',
    'Google Sheets Updated Row',
    'Google Calendar New Event',
    'GitHub Push',
    'GitHub Pull Request',
    'Webhook',
    'Schedule Every Day',
    'AI Transform',
    'Email',
    'Solana',
    'WhatsApp Send Message',
    'Telegram Send Message',
    'Discord Send Message',
  ]) {
    assert.equal(doesStepRequireMetadata(type), true, `Expected ${type} to require Step 3 metadata`);
  }

  // Trigger-only account selectors finish at Step 2 with their connected serverId/botId
  assert.equal(doesStepRequireMetadata('WhatsApp Message Received'), false);
  assert.equal(doesStepRequireMetadata('Telegram New Message'), false);
});

test('WhatsAppMetaData Seam: validates recipient, message, and credentials and emits metadata', () => {
  const { WhatsAppMetaData, canSaveWhatsAppMetadata } = loadTsModule(
    'components/metadata/WhatsAppMetaData.tsx'
  );

  assert.equal(canSaveWhatsAppMetadata({ to: '+14155552671', message: 'Hi', serverId: 'srv-1' }), true);
  assert.equal(
    canSaveWhatsAppMetadata({
      to: '{from}',
      message: 'Reply',
      phoneNumberId: 'pn-1',
      accessToken: 'tok-1',
    }),
    true
  );
  assert.equal(canSaveWhatsAppMetadata({ to: '', message: 'Hi', serverId: 'srv-1' }), false);
  assert.equal(canSaveWhatsAppMetadata({ to: '+14155552671', message: 'Hi' }), false);

  let saved = null;
  let renderer;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(
      React.createElement(WhatsAppMetaData, {
        preSelectedServerId: 'srv-wa-9',
        initialData: { to: '{from}', message: 'Hello {fromName}' },
        handleClick: (data) => {
          saved = data;
        },
      })
    );
  });

  const saveBtn = renderer.root.findByProps({ className: 'meta-form__block-btn' });
  assert.equal(saveBtn.props.disabled, false);
  TestRenderer.act(() => {
    saveBtn.props.onClick();
  });
  assert.deepEqual(saved, {
    to: '{from}',
    message: 'Hello {fromName}',
    serverId: 'srv-wa-9',
  });
});

test('TelegramMetaData Seam: validates chatId, message, and bot credentials and emits metadata', () => {
  const { TelegramMetaData, canSaveTelegramMetadata } = loadTsModule(
    'components/metadata/TelegramMetaData.tsx'
  );

  assert.equal(canSaveTelegramMetadata({ chatId: '{chatId}', message: 'Pong', botId: 'bot-1' }), true);
  assert.equal(canSaveTelegramMetadata({ chatId: '12345', message: 'Pong', botToken: 'tok' }), true);
  assert.equal(canSaveTelegramMetadata({ chatId: '', message: 'Pong', botId: 'bot-1' }), false);
  assert.equal(canSaveTelegramMetadata({ chatId: '12345', message: 'Pong' }), false);

  let saved = null;
  let renderer;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(
      React.createElement(TelegramMetaData, {
        preSelectedServerId: 'bot-tg-1',
        initialData: { chatId: '{chatId}', message: 'Welcome {firstName}', parseMode: 'Markdown' },
        handleClick: (data) => {
          saved = data;
        },
      })
    );
  });

  const saveBtn = renderer.root.findByProps({ className: 'meta-form__block-btn' });
  assert.equal(saveBtn.props.disabled, false);
  TestRenderer.act(() => {
    saveBtn.props.onClick();
  });
  assert.deepEqual(saved, {
    chatId: '{chatId}',
    message: 'Welcome {firstName}',
    parseMode: 'Markdown',
    botId: 'bot-tg-1',
  });
});

test('WebhookMetaData Seam: supports both inbound trigger secret mode and outbound action mode', () => {
  const { default: WebhookMetaData, parseJsonField } = loadTsModule(
    'components/metadata/WebhookMetaData.tsx'
  );

  assert.deepEqual(parseJsonField('{"Authorization":"Bearer x"}', {}), {
    Authorization: 'Bearer x',
  });

  let triggerSaved = null;
  let triggerRenderer;
  TestRenderer.act(() => {
    triggerRenderer = TestRenderer.create(
      React.createElement(WebhookMetaData, {
        mode: 'trigger',
        initialData: { secret: 'my-hmac-secret' },
        handleClick: (d) => {
          triggerSaved = d;
        },
      })
    );
  });
  const triggerBtn = triggerRenderer.root.findByType('button');
  TestRenderer.act(() => {
    triggerBtn.props.onClick();
  });
  assert.deepEqual(triggerSaved, { secret: 'my-hmac-secret' });

  let actionSaved = null;
  let actionRenderer;
  TestRenderer.act(() => {
    actionRenderer = TestRenderer.create(
      React.createElement(WebhookMetaData, {
        mode: 'action',
        initialData: {
          url: 'https://api.example.com/hook',
          method: 'POST',
          headers: '{"X-Env":"prod"}',
          body: '{"id":"{id}"}',
        },
        handleClick: (d) => {
          actionSaved = d;
        },
      })
    );
  });
  const actionBtn = actionRenderer.root.findByType('button');
  TestRenderer.act(() => {
    actionBtn.props.onClick();
  });
  assert.deepEqual(actionSaved, {
    url: 'https://api.example.com/hook',
    method: 'POST',
    headers: { 'X-Env': 'prod' },
    body: { id: '{id}' },
  });
});

test('EmailMetaData, SolanaMetaData, and GmailMetaData Seams: rehydrate initialData and emit serverId', () => {
  const { default: EmailMetaData } = loadTsModule('components/metadata/EmailMetaData.tsx');
  const { default: SolanaMetaData } = loadTsModule('components/metadata/SolanaMetaData.tsx');
  const { default: GmailMetaData } = loadTsModule('components/metadata/GmailMetaData.tsx');

  let emailSaved = null;
  let emailRenderer;
  TestRenderer.act(() => {
    emailRenderer = TestRenderer.create(
      React.createElement(EmailMetaData, {
        initialData: { to: '{email}', subject: 'Hi', body: 'World' },
        handleClick: (d) => {
          emailSaved = d;
        },
      })
    );
  });
  TestRenderer.act(() => {
    emailRenderer.root.findByType('button').props.onClick();
  });
  assert.deepEqual(emailSaved, { to: '{email}', subject: 'Hi', body: 'World' });

  let solanaSaved = null;
  let solanaRenderer;
  TestRenderer.act(() => {
    solanaRenderer = TestRenderer.create(
      React.createElement(SolanaMetaData, {
        initialData: { address: 'So11111111111111111111111111111111111111112', amount: '0.25' },
        handleClick: (d) => {
          solanaSaved = d;
        },
      })
    );
  });
  TestRenderer.act(() => {
    solanaRenderer.root.findByType('button').props.onClick();
  });
  assert.deepEqual(solanaSaved, {
    address: 'So11111111111111111111111111111111111111112',
    amount: '0.25',
  });

  let gmailSaved = null;
  let gmailRenderer;
  TestRenderer.act(() => {
    gmailRenderer = TestRenderer.create(
      React.createElement(GmailMetaData, {
        selectedType: 'Gmail Labeled',
        preSelectedServerId: 'gmail-srv-42',
        initialData: { watchedLabels: ['INBOX', 'VIP'] },
        handleClick: (d) => {
          gmailSaved = d;
        },
      })
    );
  });
  TestRenderer.act(() => {
    gmailRenderer.root.findByType('button').props.onClick();
  });
  assert.equal(gmailSaved.serverId, 'gmail-srv-42');
  assert.equal(gmailSaved.watchedLabels, 'INBOX,VIP');
});
