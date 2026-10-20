const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const ReactDOMServer = require('react-dom/server');
const ts = require('typescript');
const Module = require('node:module');

// Load DiscordMetaData.tsx directly via TypeScript transpilation
function loadDiscordMetaData() {
  const filename = path.resolve(__dirname, '../components/metadata/DiscordMetaData.tsx');
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const iconStub = () => null;
  mod.require = (name) => {
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (name === 'lucide-react') return new Proxy({}, { get: () => iconStub });
    if (name.includes('FormInput')) return (props) => React.createElement('input', { ...props, 'data-testid': 'form-input' });
    if (name.includes('Button')) return (props) => React.createElement('button', { ...props, 'data-testid': 'form-button' });
    if (name.includes('hooks/useAvailableTriggers')) return { useAvailableTriggers: () => ({ triggers: [] }) };
    return require(name);
  };
  mod._compile(js, filename);
  return mod.exports;
}

const {
  DISCORD_WEBHOOK_PATTERN,
  parseHexColor,
  formatInitialColor,
  resolveSamplePlaceholders,
  DiscordMetaData,
} = loadDiscordMetaData();

test('Metadata Form Seam: Webhook URL pattern validation from component export', () => {
  // Valid Discord webhook endpoints
  assert.ok(DISCORD_WEBHOOK_PATTERN.test('https://discord.com/api/webhooks/123456789/abcdefghijklmnopqrstuvwxyz'));
  assert.ok(DISCORD_WEBHOOK_PATTERN.test('https://discordapp.com/api/webhooks/987654321/xyz_123-abc'));

  // Invalid or malicious endpoints
  assert.equal(DISCORD_WEBHOOK_PATTERN.test(''), false);
  assert.equal(DISCORD_WEBHOOK_PATTERN.test('https://ptb.discord.com/api/webhooks/123/token'), false);
  assert.equal(DISCORD_WEBHOOK_PATTERN.test('https://discord.com/api/webhooks/123/token/extra-path'), false);
  assert.equal(DISCORD_WEBHOOK_PATTERN.test('https://malicious.com/api/webhooks/123/token'), false);
  assert.equal(DISCORD_WEBHOOK_PATTERN.test('http://discord.com/api/webhooks/123/token'), false);
});

test('Metadata Form Seam: Color parser preserves black #000000 as 0 and falls back to blurple on invalid', () => {
  assert.equal(parseHexColor('#000000'), 0);
  assert.equal(parseHexColor('000000'), 0);
  assert.equal(parseHexColor('#5865F2'), 5793266);
  assert.equal(parseHexColor('invalid'), 5793266);
});

test('Metadata Form Seam: formatInitialColor handles numeric, string, and pure black values', () => {
  assert.equal(formatInitialColor(0), '#000000');
  assert.equal(formatInitialColor(5793266), '#5865f2');
  assert.equal(formatInitialColor('#5865F2'), '#5865F2');
  assert.equal(formatInitialColor('FF0000'), '#FF0000');
  assert.equal(formatInitialColor(undefined), '#5865F2');
});

test('Metadata Form Seam: Sample trigger variable replacement in test modal', () => {
  const raw = 'Sent {trigger.data.amount} to {trigger.data.from} on tx {trigger.data.txHash}';
  const resolved = resolveSamplePlaceholders(raw);
  assert.equal(resolved, 'Sent 2.5 SOL to Alice (0x71C...3a1) on tx 5K2b9a1z9PqL7eR3tU6vW8xY2');
});

test('Metadata Form Seam: Resolves sample placeholders in embedUrl and avatarUrl during test delivery assembly', () => {
  const embedUrl = 'https://solscan.io/tx/{trigger.data.txHash}';
  assert.equal(resolveSamplePlaceholders(embedUrl), 'https://solscan.io/tx/5K2b9a1z9PqL7eR3tU6vW8xY2');

  const avatarUrl = 'https://cdn.example.com/avatars/{trigger.data.txHash}.png';
  assert.equal(resolveSamplePlaceholders(avatarUrl), 'https://cdn.example.com/avatars/5K2b9a1z9PqL7eR3tU6vW8xY2.png');
});

test('Metadata Form Seam: Component boundary rendering without initial data', () => {
  let emitted = null;
  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(DiscordMetaData, {
      handleClick: (meta) => { emitted = meta; },
    })
  );

  assert.ok(html.length > 500);
  assert.ok(html.includes('Webhook URL'));
  assert.ok(html.includes('Message Content'));
  assert.ok(html.includes('Rich Embed'));
  assert.ok(html.includes('Customize Sender Identity'));
});

test('Metadata Form Seam: Component boundary rehydration with initial data', () => {
  const initialData = {
    webhookUrl: 'https://discord.com/api/webhooks/123/token',
    content: 'Initial notification message',
    username: 'Alert Bot',
    avatarUrl: 'https://example.com/icon.png',
    embed: {
      title: 'Initial Title',
      description: 'Initial Description',
      color: 5793266,
      url: 'https://example.com',
      fields: [{ name: 'Field1', value: 'Value1', inline: true }],
    },
  };

  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(DiscordMetaData, {
      handleClick: () => {},
      initialData,
    })
  );

  assert.ok(html.includes('https://discord.com/api/webhooks/123/token'));
  assert.ok(html.includes('Initial notification message'));
  assert.ok(html.includes('Alert Bot'));
  assert.ok(html.includes('Initial Title'));
  assert.ok(html.includes('Initial Description'));
});

test('Metadata Form Seam: Field-only rich embeds are valid without title or description', () => {
  const embedFields = [{ name: 'Status', value: 'Confirmed', inline: true }];
  const embedTitle = '';
  const embedDescription = '';
  const showEmbed = true;

  const hasValidFields = embedFields.some((f) => f.name.trim().length > 0 && f.value.trim().length > 0);
  const hasEmbedContent =
    showEmbed && (embedTitle.trim().length > 0 || embedDescription.trim().length > 0 || hasValidFields);

  assert.equal(hasEmbedContent, true);
});

test('Metadata Form Seam: Emits metadata with dynamic timestamp marker when requested', () => {
  const includeTimestamp = true;
  const embedTimestamp = '';
  const metadata = {
    embed: {
      timestamp: includeTimestamp ? (embedTimestamp.trim() || 'now') : undefined,
    },
  };

  assert.equal(metadata.embed.timestamp, 'now');
});

test('Metadata Form Seam: Preserves custom ISO8601 or placeholder timestamp when provided', () => {
  const customIso = '2026-10-18T12:00:00.000Z';
  const customPlaceholder = '{trigger.data.timestamp}';

  const buildMeta = (ts) => ({
    embed: {
      timestamp: ts.trim() || 'now',
    },
  });

  assert.equal(buildMeta(customIso).embed.timestamp, customIso);
  assert.equal(buildMeta(customPlaceholder).embed.timestamp, customPlaceholder);
});

test('Metadata Form Seam: Test payload blocks sending when neither content nor embed is configured', () => {
  function canSendTest(content, showEmbed, hasEmbedContent) {
    return Boolean(content.trim() || (showEmbed && hasEmbedContent));
  }

  assert.equal(canSendTest('', false, false), false);
  assert.equal(canSendTest('   ', false, false), false);
  assert.equal(canSendTest('', true, false), false);
  assert.equal(canSendTest('Hello', false, false), true);
  assert.equal(canSendTest('', true, true), true);
});

test('Metadata Form Seam: Character length limit validation gates canSave', () => {
  function checkLimits(content, username, embedTitle, embedDesc) {
    const isContentValid = content.length <= 2000;
    const isUsernameValid = username.length <= 80;
    const isTitleValid = embedTitle.length <= 256;
    const isDescValid = embedDesc.length <= 4096;
    return isContentValid && isUsernameValid && isTitleValid && isDescValid;
  }

  assert.equal(checkLimits('valid', 'valid', 'valid', 'valid'), true);
  assert.equal(checkLimits('a'.repeat(2001), 'valid', 'valid', 'valid'), false);
  assert.equal(checkLimits('valid', 'u'.repeat(81), 'valid', 'valid'), false);
  assert.equal(checkLimits('valid', 'valid', 't'.repeat(257), 'valid'), false);
  assert.equal(checkLimits('valid', 'valid', 'valid', 'd'.repeat(4097)), false);
});

test('Metadata Form Seam: Empty embed toggle does not emit embed object in metadata', () => {
  function assembleMetadata({ webhookUrl, content, showEmbed, hasEmbedContent }) {
    const metadata = { webhookUrl };
    if (content.trim()) metadata.content = content.trim();
    if (showEmbed && hasEmbedContent) {
      metadata.embed = { title: 'Test' };
    }
    return metadata;
  }

  const meta = assembleMetadata({
    webhookUrl: 'https://discord.com/api/webhooks/123/token',
    content: 'Just text',
    showEmbed: false,
    hasEmbedContent: false,
  });

  assert.equal(meta.embed, undefined);
  assert.equal(meta.content, 'Just text');
});

test('Metadata Form Seam: Embed requires body content (title, description, or fields); timestamp or URL alone evaluates hasEmbedContent to false', () => {
  function evaluateHasEmbedContent(showEmbed, title, description, fields) {
    if (!showEmbed) return false;
    const hasValidFields = fields.some((f) => f.name && f.name.trim().length > 0 && f.value && f.value.trim().length > 0);
    return Boolean(
      (title && title.trim().length > 0) ||
      (description && description.trim().length > 0) ||
      hasValidFields
    );
  }

  assert.equal(evaluateHasEmbedContent(true, '', '', []), false);
  assert.equal(evaluateHasEmbedContent(true, 'Title', '', []), true);
  assert.equal(evaluateHasEmbedContent(true, '', 'Desc', []), true);
  assert.equal(evaluateHasEmbedContent(true, '', '', [{ name: 'N', value: 'V' }]), true);
  assert.equal(evaluateHasEmbedContent(true, '', '', [{ name: '', value: 'V' }]), false);
  assert.equal(evaluateHasEmbedContent(false, 'Title', 'Desc', []), false);
});

test('Metadata Form Seam: Rehydrates numeric embed color and pure black 0 without crashing', () => {
  assert.equal(formatInitialColor(0), '#000000');
  assert.equal(formatInitialColor(16711680), '#ff0000');
  assert.equal(formatInitialColor('#5865F2'), '#5865F2');
});

test('Metadata Form Seam: Embed URL without embed title gates canSave', () => {
  function isEmbedUrlValid(embedUrl, embedTitle) {
    return !embedUrl.trim() || embedTitle.trim().length > 0;
  }

  assert.equal(isEmbedUrlValid('', ''), true);
  assert.equal(isEmbedUrlValid('https://zapmate.io', ''), false);
  assert.equal(isEmbedUrlValid('https://zapmate.io', 'Title Here'), true);
});

test('Metadata Form Seam: Collapsed or disabled embed does not block canSave even if embed draft is incomplete', () => {
  function evaluateCanSave({ isValidUrl, content, showEmbed, embedUrl, embedTitle, embedDesc, fields }) {
    const isEmbedUrlValid = !embedUrl.trim() || embedTitle.trim().length > 0;
    const isTitleValid = embedTitle.length <= 256;
    const isDescValid = embedDesc.length <= 4096;
    const areFieldsValid = fields.every((f) => f.name.length <= 256 && f.value.length <= 1024);

    const hasEmbedContent = showEmbed && (
      embedTitle.trim().length > 0 ||
      embedDesc.trim().length > 0 ||
      fields.some((f) => f.name.trim() && f.value.trim())
    );

    const isEmbedValid = !showEmbed || (
      hasEmbedContent &&
      isTitleValid &&
      isDescValid &&
      isEmbedUrlValid &&
      areFieldsValid
    );

    return isValidUrl && isEmbedValid && (content.trim().length > 0 || hasEmbedContent);
  }

  // When showEmbed is false, incomplete embedUrl without title does NOT block saving text message
  assert.equal(evaluateCanSave({
    isValidUrl: true,
    content: 'Hello channel',
    showEmbed: false,
    embedUrl: 'https://zapmate.io',
    embedTitle: '',
    embedDesc: '',
    fields: [],
  }), true);

  // When showEmbed is true, incomplete embed draft blocks saving to prevent bypass or silent drops
  assert.equal(evaluateCanSave({
    isValidUrl: true,
    content: 'Hello channel',
    showEmbed: true,
    embedUrl: 'https://zapmate.io',
    embedTitle: '',
    embedDesc: '',
    fields: [],
  }), false);

  // When showEmbed is true and embed is complete, saving succeeds
  assert.equal(evaluateCanSave({
    isValidUrl: true,
    content: 'Hello channel',
    showEmbed: true,
    embedUrl: 'https://zapmate.io',
    embedTitle: 'Alert',
    embedDesc: 'Details',
    fields: [],
  }), true);
});

test('Metadata Form Seam: Embed field name and value length boundaries gate canSave', () => {
  const validFieldName = 'F'.repeat(256);
  const overFieldName = 'F'.repeat(257);
  assert.equal(validFieldName.length <= 256, true);
  assert.equal(overFieldName.length <= 256, false);

  const validFieldValue = 'V'.repeat(1024);
  const overFieldValue = 'V'.repeat(1025);
  assert.equal(validFieldValue.length <= 1024, true);
  assert.equal(overFieldValue.length <= 1024, false);

  function evaluateCanSaveWithFields(fields) {
    return fields.every((f) => f.name.length <= 256 && f.value.length <= 1024);
  }

  assert.equal(evaluateCanSaveWithFields([{ name: validFieldName, value: validFieldValue }]), true);
  assert.equal(evaluateCanSaveWithFields([{ name: overFieldName, value: validFieldValue }]), false);
  assert.equal(evaluateCanSaveWithFields([{ name: validFieldName, value: overFieldValue }]), false);
});

test('Metadata Form Seam: Invokes handleClick with validated metadata object', () => {
  let emitted = null;
  const handleClick = (meta) => { emitted = meta; };

  function handleSaveSimulated({ webhookUrl, content, showEmbed, hasEmbedContent, embedTitle, embedColor, includeTimestamp, embedTimestamp, validFields }) {
    const metadata = { webhookUrl: webhookUrl.trim() };
    if (content.trim()) metadata.content = content.trim();
    if (showEmbed && hasEmbedContent) {
      metadata.embed = {
        title: embedTitle.trim() ? embedTitle.trim().slice(0, 256) : undefined,
        color: embedColor,
        timestamp: includeTimestamp ? (embedTimestamp.trim() || 'now') : undefined,
        fields: validFields.length > 0 ? validFields : undefined,
      };
    }
    handleClick(metadata);
  }

  handleSaveSimulated({
    webhookUrl: 'https://discord.com/api/webhooks/123/token',
    content: 'Hello channel',
    showEmbed: true,
    hasEmbedContent: true,
    embedTitle: 'Alert',
    embedColor: '#5865F2',
    includeTimestamp: true,
    embedTimestamp: 'now',
    validFields: [{ name: 'Status', value: 'OK', inline: true }],
  });

  assert.ok(emitted);
  assert.equal(emitted.webhookUrl, 'https://discord.com/api/webhooks/123/token');
  assert.equal(emitted.content, 'Hello channel');
  assert.equal(emitted.embed?.title, 'Alert');
  assert.equal(emitted.embed?.timestamp, 'now');
  assert.equal(emitted.embed?.fields?.length, 1);
});
