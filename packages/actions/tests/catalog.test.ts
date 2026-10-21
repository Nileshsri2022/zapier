import {
  ACTION_CATALOG,
  APP_META,
  acceptedActionTypes,
  actionAppMeta,
  findAction,
  offeredActions,
  offeredActionTypes,
} from '../src';

/**
 * The catalog is the one place "which actions exist?" is answered. These tests
 * pin the data invariants; the worker's actionRegistry suite proves the executor
 * table covers this one (and vice versa).
 */

describe('catalog shape', () => {
  it('has unique, non-empty, case-sensitive types', () => {
    const types = ACTION_CATALOG.map((entry) => entry.type);
    expect(new Set(types).size).toBe(types.length);
    for (const type of types) {
      expect(type.trim()).toBe(type);
      expect(type.length).toBeGreaterThan(0);
    }
  });

  it('gives every entry an app with display data and a form', () => {
    for (const entry of ACTION_CATALOG) {
      expect(APP_META[entry.app]).toBeDefined();
      expect(actionAppMeta(entry).image).toMatch(/^\/apps\/.+\.svg$/);
      expect(entry.formKey === 'none' || entry.formKey === entry.app).toBe(true);
      expect(entry.executorKey.length).toBeGreaterThan(0);
    }
  });
});

describe('aliases', () => {
  const aliases = ACTION_CATALOG.filter((entry) => entry.aliasOf);

  it('are accepted but never offered', () => {
    expect(aliases.map((entry) => entry.type)).toEqual(['WhatsApp', 'Telegram']);
    for (const alias of aliases) {
      expect(offeredActionTypes()).not.toContain(alias.type);
      expect(acceptedActionTypes()).toContain(alias.type);
      expect(findAction(alias.type)).toBe(alias);
    }
  });

  it('dispatch exactly like the canonical entry they name', () => {
    for (const alias of aliases) {
      const canonical = findAction(alias.aliasOf as string);
      expect(canonical).toBeDefined();
      expect(canonical?.aliasOf).toBeUndefined();
      expect(canonical?.app).toBe(alias.app);
      expect(canonical?.executorKey).toBe(alias.executorKey);
      expect(canonical?.formKey).toBe(alias.formKey);
    }
  });
});

describe('lookup', () => {
  it('offers the seven canonical actions in seed order', () => {
    expect(offeredActionTypes()).toEqual([
      'AI Transform',
      'Email',
      'Solana',
      'WhatsApp Send Message',
      'Telegram Send Message',
      'Discord Send Message',
      'Webhook',
    ]);
    expect(offeredActions()).toHaveLength(7);
  });

  it('does not accept prefixes of a real type', () => {
    expect(findAction('WhatsApp Sendd')).toBeUndefined();
    expect(findAction('WhatsApp Anything')).toBeUndefined();
    expect(findAction('Discord Alert')).toBeUndefined();
  });

  it('is case-sensitive', () => {
    expect(findAction('email')).toBeUndefined();
    expect(findAction('WEBHOOK')).toBeUndefined();
    expect(findAction('Email')).toBeDefined();
  });
});
