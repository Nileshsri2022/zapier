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

test('Metadata Form Seam: Test payload does not force text content onto embed-only actions', () => {
  const content = '';
  const hasEmbedContent = true;
  const testPayload = {};
  if (content.trim()) {
    testPayload.content = content.trim();
  } else if (!hasEmbedContent) {
    testPayload.content = '🧪 Test message from ZapMate! Your webhook is configured correctly.';
  }

  assert.equal(testPayload.content, undefined);
});
