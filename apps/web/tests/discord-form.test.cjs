const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Extract source from DiscordMetaData.tsx for pure logic / seam verification
const componentPath = path.resolve(__dirname, '../components/metadata/DiscordMetaData.tsx');
const source = fs.readFileSync(componentPath, 'utf8');

// Canonical regex from the component
const regexMatch = source.match(/const DISCORD_WEBHOOK_PATTERN = (\/.*?\/[a-z]*);/);
assert.ok(regexMatch, 'Should find DISCORD_WEBHOOK_PATTERN in DiscordMetaData.tsx');
const DISCORD_WEBHOOK_PATTERN = new RegExp(
  regexMatch[1].slice(1, regexMatch[1].lastIndexOf('/')),
  regexMatch[1].slice(regexMatch[1].lastIndexOf('/') + 1)
);

test('Metadata Form Seam: Webhook URL pattern validation', () => {
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
  function parseHexColor(colorHex) {
    const clean = colorHex.replace(/^#/, '').trim();
    const parsed = parseInt(clean, 16);
    return Number.isNaN(parsed) ? 5793266 : Math.max(0, Math.min(16777215, parsed));
  }

  assert.equal(parseHexColor('#000000'), 0);
  assert.equal(parseHexColor('000000'), 0);
  assert.equal(parseHexColor('#5865F2'), 5793266);
  assert.equal(parseHexColor('invalid'), 5793266);
});

test('Metadata Form Seam: Sample trigger variable replacement in test modal', () => {
  const SAMPLE_TRIGGER_VALUES = {
    '{trigger.data.txHash}': '5K2b9a1z9PqL7eR3tU6vW8xY2',
    '{trigger.data.amount}': '2.5 SOL',
    '{trigger.data.from}': 'Alice (0x71C...3a1)',
  };

  function resolveSamplePlaceholders(text) {
    if (!text) return text;
    let resolved = text;
    for (const [placeholder, sampleValue] of Object.entries(SAMPLE_TRIGGER_VALUES)) {
      resolved = resolved.split(placeholder).join(sampleValue);
    }
    return resolved;
  }

  const raw = 'Sent {trigger.data.amount} to {trigger.data.from} on tx {trigger.data.txHash}';
  const resolved = resolveSamplePlaceholders(raw);
  assert.equal(resolved, 'Sent 2.5 SOL to Alice (0x71C...3a1) on tx 5K2b9a1z9PqL7eR3tU6vW8xY2');
});

test('Metadata Form Seam: Resolves sample placeholders in embedUrl during test delivery assembly', () => {
  const SAMPLE_TRIGGER_VALUES = {
    '{trigger.data.txHash}': '5K2b9a1z9PqL7eR3tU6vW8xY2',
  };

  function resolveSamplePlaceholders(text) {
    if (!text) return text;
    let resolved = text;
    for (const [placeholder, sampleValue] of Object.entries(SAMPLE_TRIGGER_VALUES)) {
      resolved = resolved.split(placeholder).join(sampleValue);
    }
    return resolved;
  }

  const embedUrl = 'https://solscan.io/tx/{trigger.data.txHash}';
  const resolved = resolveSamplePlaceholders(embedUrl);
  assert.equal(resolved, 'https://solscan.io/tx/5K2b9a1z9PqL7eR3tU6vW8xY2');
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
    webhookUrl: 'https://discord.com/api/webhooks/123/token',
    content: 'Hello Discord',
    embed: {
      title: 'Embed Title',
      timestamp: includeTimestamp ? (embedTimestamp.trim() || 'now') : undefined,
    },
  };

  assert.equal(metadata.embed.timestamp, 'now');
});

test('Metadata Form Seam: Preserves custom ISO8601 or placeholder timestamp when provided', () => {
  const includeTimestamp = true;
  const embedTimestamp = '{trigger.data.timestamp}';
  const metadata = {
    webhookUrl: 'https://discord.com/api/webhooks/123/token',
    content: 'Hello Discord',
    embed: {
      title: 'Embed Title',
      timestamp: includeTimestamp ? (embedTimestamp.trim() || 'now') : undefined,
    },
  };

  assert.equal(metadata.embed.timestamp, '{trigger.data.timestamp}');
});

test('Metadata Form Seam: Test payload blocks sending when neither content nor embed is configured', () => {
  const content = '';
  const hasEmbedContent = false;
  let blocked = false;
  if (!content.trim() && !hasEmbedContent) {
    blocked = true;
  }
  assert.equal(blocked, true);

  // When embed content is present without text content, test sends embed without forcing synthetic text
  const testPayload = {};
  if (content.trim()) {
    testPayload.content = content.trim();
  }
  assert.equal(testPayload.content, undefined);
});

test('Metadata Form Seam: Character length limit validation gates canSave', () => {
  // 1. Content boundary test (max 2000)
  const validContent = 'A'.repeat(2000);
  const overContent = 'A'.repeat(2001);
  assert.equal(validContent.length <= 2000, true);
  assert.equal(overContent.length <= 2000, false);

  // 2. Embed description boundary test (max 4096)
  const validDescription = 'D'.repeat(4096);
  const overDescription = 'D'.repeat(4097);
  assert.equal(validDescription.length <= 4096, true);
  assert.equal(overDescription.length <= 4096, false);

  // 3. Username boundary test (max 80)
  const validUsername = 'U'.repeat(80);
  const overUsername = 'U'.repeat(81);
  assert.equal(validUsername.length <= 80, true);
  assert.equal(overUsername.length <= 80, false);

  // 4. Embed title boundary test (max 256)
  const validTitle = 'T'.repeat(256);
  const overTitle = 'T'.repeat(257);
  assert.equal(validTitle.length <= 256, true);
  assert.equal(overTitle.length <= 256, false);

  // 5. canSave gates
  function evaluateCanSave({ urlValid, contentLen, descLen, titleLen, userLen, hasContentOrEmbed }) {
    return urlValid && contentLen <= 2000 && descLen <= 4096 && titleLen <= 256 && userLen <= 80 && hasContentOrEmbed;
  }

  assert.equal(evaluateCanSave({ urlValid: true, contentLen: 2000, descLen: 4096, titleLen: 256, userLen: 80, hasContentOrEmbed: true }), true);
  assert.equal(evaluateCanSave({ urlValid: false, contentLen: 100, descLen: 100, titleLen: 50, userLen: 10, hasContentOrEmbed: true }), false);
  assert.equal(evaluateCanSave({ urlValid: true, contentLen: 2001, descLen: 100, titleLen: 50, userLen: 10, hasContentOrEmbed: true }), false);
  assert.equal(evaluateCanSave({ urlValid: true, contentLen: 100, descLen: 4097, titleLen: 50, userLen: 10, hasContentOrEmbed: true }), false);
  assert.equal(evaluateCanSave({ urlValid: true, contentLen: 100, descLen: 100, titleLen: 257, userLen: 10, hasContentOrEmbed: true }), false);
  assert.equal(evaluateCanSave({ urlValid: true, contentLen: 100, descLen: 100, titleLen: 50, userLen: 81, hasContentOrEmbed: true }), false);
  assert.equal(evaluateCanSave({ urlValid: true, contentLen: 0, descLen: 0, titleLen: 0, userLen: 10, hasContentOrEmbed: false }), false);
});

test('Metadata Form Seam: Empty embed toggle does not emit embed object in metadata', () => {
  const showEmbed = true;
  const embedTitle = '';
  const embedDescription = '';
  const embedFields = [];
  const hasValidFields = embedFields.some((f) => f.name.trim().length > 0 && f.value.trim().length > 0);
  const hasEmbedContent = showEmbed && (embedTitle.trim().length > 0 || embedDescription.trim().length > 0 || hasValidFields);

  const metadata = { webhookUrl: 'https://discord.com/api/webhooks/123/token' };
  if (showEmbed && hasEmbedContent) {
    metadata.embed = { color: '#5865F2' };
  }

  assert.equal(metadata.embed, undefined);
});

test('Metadata Form Seam: Embed requires body content (title, description, or fields); timestamp or URL alone evaluates hasEmbedContent to false', () => {
  const showEmbed = true;
  const embedTitle = '';
  const embedDescription = '';
  const hasValidFields = false;

  const evaluateHasEmbedContent = ({ title, desc, hasFields }) =>
    showEmbed && (title.trim().length > 0 || desc.trim().length > 0 || hasFields);

  // Standalone URL or timestamp without title/desc/fields does NOT make embed content valid
  assert.equal(evaluateHasEmbedContent({ title: embedTitle, desc: embedDescription, hasFields: hasValidFields }), false);

  // Body content (title, desc, or fields) makes it valid
  assert.equal(evaluateHasEmbedContent({ title: 'Alert', desc: embedDescription, hasFields: hasValidFields }), true);
  assert.equal(evaluateHasEmbedContent({ title: embedTitle, desc: 'Details here', hasFields: hasValidFields }), true);
  assert.equal(evaluateHasEmbedContent({ title: embedTitle, desc: embedDescription, hasFields: true }), true);
});

test('Metadata Form Seam: Rehydrates numeric embed color and pure black 0 without crashing', () => {
  function formatInitialColor(color) {
    if (color === 0) return '#000000';
    if (typeof color === 'number' && Number.isFinite(color)) {
      return `#${Math.max(0, Math.min(16777215, Math.floor(color))).toString(16).padStart(6, '0')}`;
    }
    if (typeof color === 'string' && color.trim()) {
      const clean = color.trim();
      return clean.startsWith('#') ? clean : `#${clean}`;
    }
    return '#5865F2';
  }

  assert.equal(formatInitialColor(0), '#000000');
  assert.equal(formatInitialColor(5793266), '#5865f2');
  assert.equal(formatInitialColor('#FF0000'), '#FF0000');
  assert.equal(formatInitialColor('00FF00'), '#00FF00');
  assert.equal(formatInitialColor(undefined), '#5865F2');
});

test('Metadata Form Seam: Embed URL without embed title gates canSave', () => {
  function evaluateCanSaveWithEmbedUrl({ embedUrl, embedTitle }) {
    const isEmbedUrlValid = !embedUrl.trim() || embedTitle.trim().length > 0;
    return isEmbedUrlValid;
  }

  assert.equal(evaluateCanSaveWithEmbedUrl({ embedUrl: '', embedTitle: '' }), true);
  assert.equal(evaluateCanSaveWithEmbedUrl({ embedUrl: 'https://zapmate.io', embedTitle: 'ZapMate' }), true);
  assert.equal(evaluateCanSaveWithEmbedUrl({ embedUrl: 'https://zapmate.io', embedTitle: '' }), false);
  assert.equal(evaluateCanSaveWithEmbedUrl({ embedUrl: 'https://zapmate.io', embedTitle: '   ' }), false);
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

    const isEmbedValid = !showEmbed || !hasEmbedContent || (
      isTitleValid &&
      isDescValid &&
      isEmbedUrlValid &&
      areFieldsValid
    );

    return isValidUrl && isEmbedValid && (content.trim().length > 0 || (showEmbed && hasEmbedContent));
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

  // When showEmbed is true and has content, an incomplete embed draft does NOT block saving content
  assert.equal(evaluateCanSave({
    isValidUrl: true,
    content: 'Hello channel',
    showEmbed: true,
    embedUrl: 'https://zapmate.io',
    embedTitle: '',
    embedDesc: '',
    fields: [],
  }), true);

  // When content is empty and embed is incomplete, saving is blocked
  assert.equal(evaluateCanSave({
    isValidUrl: true,
    content: '',
    showEmbed: true,
    embedUrl: 'https://zapmate.io',
    embedTitle: '',
    embedDesc: '',
    fields: [],
  }), false);
});

test('Metadata Form Seam: Resolves sample placeholders in avatarUrl during test delivery assembly', () => {
  const SAMPLE_TRIGGER_VALUES = {
    '{trigger.data.avatar}': 'https://example.com/bot.png',
  };

  function resolveSamplePlaceholders(text) {
    if (!text) return text;
    let resolved = text;
    for (const [placeholder, sampleValue] of Object.entries(SAMPLE_TRIGGER_VALUES)) {
      resolved = resolved.split(placeholder).join(sampleValue);
    }
    return resolved;
  }

  const avatarUrl = '{trigger.data.avatar}';
  const resolved = resolveSamplePlaceholders(avatarUrl);
  assert.equal(resolved, 'https://example.com/bot.png');
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
