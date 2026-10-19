jest.mock('axios', () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));

import axios from 'axios';
import { sendWhatsAppMessage } from '../src/sendWhatsApp';
import { sendTelegramMessage } from '../src/sendTelegram';

const post = axios.post as jest.Mock;

describe('outbound WhatsApp/Telegram requests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    post.mockResolvedValue({
      data: { messages: [{ id: 'wamid.1' }], result: { message_id: 1 } },
    });
  });

  it('sets a timeout on WhatsApp sends', async () => {
    await sendWhatsAppMessage('phone-id', 'token', '15551234567', 'hello');

    expect(post).toHaveBeenCalledWith(
      expect.stringContaining('/messages'),
      expect.any(Object),
      expect.objectContaining({ timeout: expect.any(Number) })
    );
    const options = post.mock.calls[0][2];
    expect(options.timeout).toBeGreaterThan(0);
    expect(options.timeout).toBeLessThanOrEqual(30_000);
  });

  it('sets a timeout on Telegram sends', async () => {
    await sendTelegramMessage('bot-token', 123, 'hello');

    expect(post).toHaveBeenCalledWith(
      expect.stringContaining('/sendMessage'),
      expect.any(Object),
      expect.objectContaining({ timeout: expect.any(Number) })
    );
    const options = post.mock.calls[0][2];
    expect(options.timeout).toBeGreaterThan(0);
    expect(options.timeout).toBeLessThanOrEqual(30_000);
  });
});
