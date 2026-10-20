jest.mock('axios', () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));

import axios from 'axios';
import { executeActionWithRetry } from '../src/index';

const post = axios.post as jest.Mock;

describe('Worker Action Execution Seam: Discord Send Message', () => {
  const validWebhookUrl = 'https://discord.com/api/webhooks/123456789/secret-token-abc';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('transforms metadata and trigger placeholders into Discord webhook payload and returns masked output', async () => {
    post.mockResolvedValueOnce({
      data: {
        id: 'discord-msg-999',
        timestamp: '2026-10-20T05:30:00.000Z',
      },
    });

    const metadata = {
      webhookUrl: validWebhookUrl,
      content: 'Payment of {trigger.data.amount} SOL received',
      username: '{trigger.data.user} Alerts',
      embed: {
        title: 'Transaction {trigger.data.txHash}',
        description: 'Details for {trigger.data.user}',
        color: '#5865F2',
        fields: [{ name: 'Amount', value: '{trigger.data.amount}', inline: true }],
      },
    };

    const zapRunMetadata = {
      trigger: {
        data: {
          amount: '5.0',
          user: 'Bob',
          txHash: '0x999abc',
        },
      },
    };

    const result = await executeActionWithRetry('Discord Send Message', metadata, zapRunMetadata);

    expect(result.success).toBe(true);
    expect(result.data?.success).toBe(true);
    expect(result.data?.message).toBe('Discord message delivered');
    expect(result.data?.output.messageId).toBe('discord-msg-999');
    expect(result.data?.output.timestamp).toBe('2026-10-20T05:30:00.000Z');
    expect(result.data?.output.sentAt).toBeDefined();
    expect(result.data?.output.webhookUrl).toBeUndefined();

    const [, calledBody] = post.mock.calls[0];
    expect(calledBody.content).toBe('Payment of 5.0 SOL received');
    expect(calledBody.username).toBe('Bob Alerts');
    expect(calledBody.embeds[0].title).toBe('Transaction 0x999abc');
    expect(calledBody.embeds[0].description).toBe('Details for Bob');
    expect(calledBody.embeds[0].fields[0].value).toBe('5.0');
  });

  it('fails with fatal error and halts retries after 1 attempt when webhook URL is invalid', async () => {
    const metadata = {
      webhookUrl: 'https://not-discord.com/webhook',
      content: 'Hello',
    };

    const result = await executeActionWithRetry('Discord Send Message', metadata, {});

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(1); // Halts immediately
    expect(result.error?.message).toMatch(/Discord send failed.*FATAL/);
    expect(post).not.toHaveBeenCalled();
  });

  it('fails immediately and halts retries after 1 attempt when Discord returns HTTP 404 (Unknown Webhook)', async () => {
    post.mockRejectedValueOnce({
      response: {
        status: 404,
        data: { message: 'Unknown Webhook' },
      },
    });

    const metadata = {
      webhookUrl: validWebhookUrl,
      content: 'Test message',
    };

    const result = await executeActionWithRetry('Discord Send Message', metadata, {});

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(1); // Only 1 attempt due to fatal status 404
    expect(result.error?.message).toContain('Unknown Webhook');
    expect(post).toHaveBeenCalledTimes(1);
  });


  it('retries dynamic backoff on HTTP 429 rate limit and succeeds within execution seam', async () => {
    // Attempt 1: 429 Rate limited with retry_after = 0.01s
    post.mockRejectedValueOnce({
      response: {
        status: 429,
        data: { message: 'Rate limited', retry_after: 0.01 },
      },
    });

    // Attempt 2: 200 Success
    post.mockResolvedValueOnce({
      data: {
        id: 'msg-recovered-429',
        timestamp: '2026-10-20T06:00:00.000Z',
      },
    });

    const metadata = {
      webhookUrl: validWebhookUrl,
      content: 'Testing 429 retry at worker seam',
    };

    const result = await executeActionWithRetry('Discord Send Message', metadata, {});

    expect(result.success).toBe(true);
    expect(result.data?.output.messageId).toBe('msg-recovered-429');
    expect(post).toHaveBeenCalledTimes(2);
  });
});