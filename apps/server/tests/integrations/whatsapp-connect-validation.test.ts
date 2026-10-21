import { ConnectWhatsAppSchema } from '@repo/types';

/**
 * #41 — `WhatsAppServer.phoneNumberId` is `@unique` in Prisma. When the editor
 * posted `phoneNumberId: ''` the schema accepted it, the first user won the
 * empty-string row, and every later connect failed with "This phone number ID
 * is already registered". The column also drives trigger matching
 * (`server: { phoneNumberId }`), so `''` could never match a Meta payload.
 *
 * These tests pin the validation layer that used to let it through.
 */
describe('ConnectWhatsAppSchema WhatsApp identifiers', () => {
  const valid = {
    displayName: 'Acme Support',
    accessToken: 'EAAB-token',
    businessId: '123456789012345',
  };

  it('rejects an empty phone number id', () => {
    const parsed = ConnectWhatsAppSchema.safeParse({ ...valid, phoneNumberId: '' });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].path).toEqual(['phoneNumberId']);
    }
  });

  it('rejects a missing phone number id', () => {
    expect(ConnectWhatsAppSchema.safeParse(valid).success).toBe(false);
  });

  it('rejects whitespace-only ids that would trim to empty', () => {
    // A whitespace id can never match a Meta payload either, so the schema
    // trims before the length check.
    expect(ConnectWhatsAppSchema.safeParse({ ...valid, phoneNumberId: '   ' }).success).toBe(false);
  });

  it('requires a WhatsApp Business Account ID (WABA ID)', () => {
    const missing = ConnectWhatsAppSchema.safeParse({
      displayName: valid.displayName,
      accessToken: valid.accessToken,
      phoneNumberId: '123456789012345',
    });
    const blank = ConnectWhatsAppSchema.safeParse({
      ...valid,
      phoneNumberId: '123456789012345',
      businessId: '   ',
    });

    expect(missing.success).toBe(false);
    expect(blank.success).toBe(false);
    if (!blank.success) {
      expect(blank.error.issues[0].path).toEqual(['businessId']);
    }
  });

  it('accepts real phone number and WABA ids', () => {
    const parsed = ConnectWhatsAppSchema.safeParse({
      ...valid,
      phoneNumberId: '123456789012345',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.phoneNumberId).toBe('123456789012345');
      expect(parsed.data.businessId).toBe('123456789012345');
    }
  });
});
