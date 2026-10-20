jest.mock('axios', () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));

import axios from 'axios';
import {
  sendDiscordMessage,
  resolveDiscordPlaceholders,
  maskDiscordWebhookUrl,
  isValidDiscordWebhookUrl,
  normalizeDiscordColor,
} from '../src/sendDiscord';

const post = axios.post as jest.Mock;

describe('sendDiscordMessage', () => {
  const validWebhookUrl = 'https://discord.com/api/webhooks/123456789/abcdefghijklmnopqrstuvwxyz';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('posts plain text message with wait=true query parameter and bounded timeout', async () => {
    post.mockResolvedValueOnce({
      data: {
        id: '987654321',
        channel_id: '123456789',
        content: 'Hello from ZapMate!',
        timestamp: '2026-10-20T00:00:00.000Z',
      },
    });

    const result = await sendDiscordMessage(validWebhookUrl, {
      content: 'Hello from ZapMate!',
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('987654321');
    expect(result.timestamp).toBe('2026-10-20T00:00:00.000Z');
    expect(post).toHaveBeenCalledTimes(1);

    const [calledUrl, calledBody, calledConfig] = post.mock.calls[0];
    expect(calledUrl).toBe(`${validWebhookUrl}?wait=true`);
    expect(calledBody).toEqual({
      content: 'Hello from ZapMate!',
    });
    expect(calledConfig.timeout).toBeGreaterThan(0);
    expect(calledConfig.timeout).toBeLessThanOrEqual(15_000);
  });

  it('fails gracefully and flags fatal when webhook URL is missing or invalid', async () => {
    const result = await sendDiscordMessage('not-a-valid-url', {
      content: 'Hello',
    });

    expect(result.success).toBe(false);
    expect(result.isFatal).toBe(true);
    expect(result.error).toMatch(/Invalid Discord webhook URL/i);
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects unanchored webhook URLs with trailing paths or invalid domains', () => {
    expect(isValidDiscordWebhookUrl('https://discord.com/api/webhooks/123/token/extra-path')).toBe(false);
    expect(isValidDiscordWebhookUrl('https://ptb.discord.com/api/webhooks/123/token')).toBe(false);
    expect(isValidDiscordWebhookUrl('https://malicious-site.com/api/webhooks/123/token')).toBe(false);
    expect(isValidDiscordWebhookUrl('https://discord.com/api/webhooks/123/token')).toBe(true);
    expect(isValidDiscordWebhookUrl('https://discordapp.com/api/webhooks/123/token')).toBe(true);
  });

  it('fails gracefully and flags fatal when neither content nor embed is provided', async () => {
    const result = await sendDiscordMessage(validWebhookUrl, {});

    expect(result.success).toBe(false);
    expect(result.isFatal).toBe(true);
    expect(result.error).toMatch(/content or embed is required/i);
    expect(post).not.toHaveBeenCalled();
  });

  it('captures Discord HTTP 400 error and fails immediately without retrying', async () => {
    post.mockRejectedValueOnce({
      response: {
        status: 400,
        data: { message: 'Invalid Webhook Token', code: 50027 },
      },
    });

    const result = await sendDiscordMessage(validWebhookUrl, {
      content: 'Testing error response',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid Webhook Token');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('captures Discord HTTP 404 Unknown Webhook and fails immediately without retrying', async () => {
    post.mockRejectedValueOnce({
      response: {
        status: 404,
        data: { message: 'Unknown Webhook', code: 10015 },
      },
    });

    const result = await sendDiscordMessage(validWebhookUrl, {
      content: 'Testing 404',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown Webhook');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('posts rich embed with hex color, timestamp, and identity overrides', async () => {
    post.mockResolvedValueOnce({
      data: { id: 'embed-msg-123' },
    });

    const result = await sendDiscordMessage(validWebhookUrl, {
      username: 'ZapMate Alerts',
      avatarUrl: 'https://example.com/icon.png',
      embed: {
        title: 'New Transaction Alert',
        description: 'Received 1.5 SOL from 8x...abc',
        color: '#5865F2', // Discord blurple = 5793266
        url: 'https://explorer.solana.com/tx/123',
        timestamp: '2026-10-20T05:00:00.000Z',
        fields: [
          { name: 'Amount', value: '1.5 SOL', inline: true },
          { name: 'Status', value: 'Confirmed', inline: true },
        ],
      },
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('embed-msg-123');

    const [calledUrl, calledBody] = post.mock.calls[0];
    expect(calledUrl).toBe(`${validWebhookUrl}?wait=true`);
    expect(calledBody.username).toBe('ZapMate Alerts');
    expect(calledBody.avatar_url).toBe('https://example.com/icon.png');
    expect(calledBody.embeds).toHaveLength(1);
    expect(calledBody.embeds[0]).toEqual({
      title: 'New Transaction Alert',
      description: 'Received 1.5 SOL from 8x...abc',
      color: 5793266,
      url: 'https://explorer.solana.com/tx/123',
      timestamp: '2026-10-20T05:00:00.000Z',
      fields: [
        { name: 'Amount', value: '1.5 SOL', inline: true },
        { name: 'Status', value: 'Confirmed', inline: true },
      ],
    });
  });

  it('normalizes pure black color #000000 to decimal 0 without treating it as falsy', () => {
    expect(normalizeDiscordColor('#000000')).toBe(0);
    expect(normalizeDiscordColor('000000')).toBe(0);
    expect(normalizeDiscordColor(0)).toBe(0);
    expect(normalizeDiscordColor('#FFFFFF')).toBe(16777215);
  });

  it('enforces character limits on long content, embed descriptions, and caps fields to 25', async () => {
    post.mockResolvedValueOnce({
      data: { id: 'trunc-123' },
    });

    const longContent = 'A'.repeat(2500);
    const longTitle = 'T'.repeat(300);
    const longDescription = 'D'.repeat(5000);
    const fields = Array.from({ length: 30 }, (_, i) => ({
      name: `Field ${i} `.repeat(30), // > 256 chars
      value: `Value ${i} `.repeat(150), // > 1024 chars
      inline: true,
    }));

    const result = await sendDiscordMessage(validWebhookUrl, {
      content: longContent,
      embed: {
        title: longTitle,
        description: longDescription,
        fields,
      },
    });

    expect(result.success).toBe(true);
    const [, calledBody] = post.mock.calls[0];
    expect(calledBody.content.length).toBe(2000);
    expect(calledBody.embeds[0].title.length).toBe(256);
    expect(calledBody.embeds[0].description.length).toBe(4096);
    expect(calledBody.embeds[0].fields).toHaveLength(25);
    expect(calledBody.embeds[0].fields[0].name.length).toBeLessThanOrEqual(256);
    expect(calledBody.embeds[0].fields[0].value.length).toBeLessThanOrEqual(1024);
  });

  it('interpolates nested placeholders across embed title, description, and fields', () => {
    const zapRunMetadata = {
      trigger: {
        data: {
          txHash: '5K2b...9a1',
          amount: 2.5,
          user: 'Alice',
        },
      },
    };

    const unresolvedOptions = {
      content: 'Incoming transfer of {trigger.data.amount} SOL',
      username: '{trigger.data.user} Alerts',
      embed: {
        title: 'TX {trigger.data.txHash}',
        description: 'Transferred {trigger.data.amount} SOL by {trigger.data.user}',
        fields: [
          { name: 'Recipient', value: '{trigger.data.user}', inline: true },
        ],
      },
    };

    const resolved = resolveDiscordPlaceholders(unresolvedOptions, zapRunMetadata);

    expect(resolved.content).toBe('Incoming transfer of 2.5 SOL');
    expect(resolved.username).toBe('Alice Alerts');
    expect(resolved.embed?.title).toBe('TX 5K2b...9a1');
    expect(resolved.embed?.description).toBe('Transferred 2.5 SOL by Alice');
    expect(resolved.embed?.fields?.[0].value).toBe('Alice');
  });

  it('respects HTTP 429 retry_after response and retries dynamically until success', async () => {
    // Attempt 1: 429 Rate limited with retry_after = 0.02s (20ms)
    post.mockRejectedValueOnce({
      response: {
        status: 429,
        data: { message: 'You are being rate limited.', retry_after: 0.02, global: false },
        headers: { 'retry-after': '0.02' },
      },
    });

    // Attempt 2: 200 Success
    post.mockResolvedValueOnce({
      data: { id: 'msg-after-429' },
    });

    const result = await sendDiscordMessage(validWebhookUrl, {
      content: 'Rate limit recovery test',
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('msg-after-429');
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('fails with rate limit error and flags isFatal if HTTP 429 persists through all retry attempts', async () => {
    // 3 successive 429s
    for (let i = 0; i < 3; i++) {
      post.mockRejectedValueOnce({
        response: {
          status: 429,
          data: { message: 'You are being rate limited.', retry_after: 0.01 },
        },
      });
    }

    const result = await sendDiscordMessage(validWebhookUrl, {
      content: 'Persistent rate limit',
    });

    expect(result.success).toBe(false);
    expect(result.isFatal).toBe(true);
    expect(result.error).toContain('You are being rate limited');
    expect(post).toHaveBeenCalledTimes(3);
  });

  it('masks the sensitive webhook token in Discord webhook URLs', () => {
    const raw = 'https://discord.com/api/webhooks/123456789/abcdef_secret-token';
    const masked = maskDiscordWebhookUrl(raw);
    expect(masked).toBe('https://discord.com/api/webhooks/123456789/****');
  });
});
