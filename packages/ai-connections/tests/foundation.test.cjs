const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const {
  CredentialVault,
  AiConnectionService,
  AiConnectionError,
  normalizeBaseUrl,
  parseAllowedHosts,
  isPublicAddress,
  resolvePublicAddress,
} = require('../dist');

const secret = 'test-key<&>"123';
const identity = { id: 'connection-1', userId: 1, provider: 'openai_compatible' };
const key = () => randomBytes(32).toString('base64');
const env = (keys = { v1: key() }, active = 'v1') => ({
  AI_CONNECTION_ENCRYPTION_KEYS: JSON.stringify(keys),
  AI_CONNECTION_ACTIVE_KEY_ID: active,
});
const hosts = ['api.example.com'];
const input = {
  name: 'My service',
  baseUrl: 'https://api.example.com/v1/',
  apiKey: secret,
  capabilityProfileId: 'chat_json_schema',
};

test('vault authenticates identity, randomizes nonce, and supports key rotation', () => {
  const keys = { v1: key(), v2: key() };
  const vault = CredentialVault.fromEnv(env(keys));
  const encrypted = vault.encrypt(secret, identity);
  assert.notEqual(encrypted.credentialNonce, vault.encrypt(secret, identity).credentialNonce);
  assert.equal(vault.decrypt({ ...identity, ...encrypted }), secret);
  for (const patch of [
    { userId: 2 },
    { id: 'other' },
    { credentialTag: randomBytes(16).toString('base64') },
    { keyId: 'unknown' },
  ]) {
    assert.throws(() => vault.decrypt({ ...identity, ...encrypted, ...patch }), AiConnectionError);
  }
  const next = CredentialVault.fromEnv(env(keys, 'v2'));
  const rotated = next.rotate({ ...identity, ...encrypted });
  assert.equal(rotated.keyId, 'v2');
  assert.equal(
    CredentialVault.fromEnv(env({ v2: keys.v2 }, 'v2')).decrypt({ ...identity, ...rotated }),
    secret
  );
});

test('vault rejects missing, malformed, short or unresolvable keyrings without echoing input', () => {
  for (const value of [
    {},
    env({}, 'v1'),
    env({ v1: 'secret' }),
    { ...env(), AI_CONNECTION_ENCRYPTION_KEYS: '{bad' },
    env({ v1: key() }, 'missing'),
  ]) {
    assert.throws(() => CredentialVault.fromEnv(value), /not configured correctly/);
  }
});

test('base URL uses exact host and bounded canonical API path', () => {
  assert.equal(normalizeBaseUrl(input.baseUrl, hosts), 'https://api.example.com/v1');
  assert.equal(
    normalizeBaseUrl('https://API.EXAMPLE.COM:443/api/v1/', hosts),
    'https://api.example.com/api/v1'
  );
  assert.equal(normalizeBaseUrl('https://api.example.com', hosts), 'https://api.example.com');
  for (const url of [
    'http://api.example.com/v1',
    'https://api.example.com:8443/v1',
    'https://user:password@api.example.com/v1',
    'https://api.example.com/v1?key=x',
    'https://api.example.com/v1#fragment',
    'https://api.example.com/v1?',
    'https://api.example.com.attacker.com/v1',
    'https://sub.api.example.com/v1',
    'https://127.0.0.1/v1',
    'https://2130706433/v1',
    'https://[::1]/v1',
    'https://api.example.com./v1',
    'https://api.example.com/../v1',
    'https://api.example.com/%2e%2e/v1',
    'https://api.example.com/v1%2fchat',
    'https://api.example.com/v1/chat/completions',
    ' https://api.example.com/v1',
    'https://api.example.com\\@attacker.com/v1',
  ])
    assert.throws(() => normalizeBaseUrl(url, hosts), AiConnectionError, url);
  assert.throws(() => normalizeBaseUrl(input.baseUrl, []), AiConnectionError);
  assert.throws(() => parseAllowedHosts('*.example.com'), AiConnectionError);
  assert.deepEqual(parseAllowedHosts('api.example.com, API.EXAMPLE.COM'), hosts);
});

test('addresses reject private, reserved, mapped, transition and documentation ranges', () => {
  for (const ip of [
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.0.1',
    '169.254.169.254',
    '0.0.0.0',
    '100.64.0.1',
    '192.0.0.1',
    '192.0.2.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '240.0.0.1',
    '::',
    '::1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '::ffff:8.8.8.8',
    '::ffff:127.0.0.1',
    '2001:db8::1',
    '2002::1',
    '2001::1',
    '64:ff9b::1',
    '3fff::1',
    'not an IP',
  ]) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});

test('DNS rejects empty, mixed, wrong-family and failed resolution', async () => {
  for (const answers of [
    [],
    [
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ],
    [{ address: '8.8.8.8', family: 6 }],
  ]) {
    await assert.rejects(
      resolvePublicAddress('api.example.com', async () => answers),
      AiConnectionError
    );
  }
  await assert.rejects(
    resolvePublicAddress('api.example.com', async () => {
      throw Error('sensitive DNS error');
    }),
    /not permitted/
  );
});

function fixture() {
  const rows = new Map();
  const repository = {
    async list(userId) {
      return [...rows.values()].filter((r) => r.userId === userId);
    },
    async findActive(id, userId) {
      const row = rows.get(id);
      return row?.userId === userId && !row.revokedAt ? row : null;
    },
    async create(row) {
      rows.set(row.id, row);
      return row;
    },
    async replace(id, userId, updatedAt, changes) {
      const row = await this.findActive(id, userId);
      if (!row || row.updatedAt.getTime() !== updatedAt.getTime()) return false;
      rows.set(id, { ...row, ...changes });
      return true;
    },
    async revoke(id, userId) {
      const row = await this.findActive(id, userId);
      if (!row) return false;
      rows.set(id, { ...row, revokedAt: new Date() });
      return true;
    },
  };
  const service = new AiConnectionService(
    repository,
    CredentialVault.fromEnv(env()),
    hosts,
    async () => {}
  );
  return { rows, service, repository };
}

test('service stores encrypted keys, returns allowlisted DTOs, and scopes all operations to owner', async () => {
  const { service, rows } = fixture();
  const created = await service.create(1, input);
  assert.equal(created.configured, true);
  const stored = rows.get(created.id);
  assert.ok(!JSON.stringify(stored).includes(secret));
  for (const forbidden of [
    'credentialCiphertext',
    'credentialNonce',
    'credentialTag',
    'keyId',
    'apiKey',
    'userId',
  ]) {
    assert.equal(Object.hasOwn(created, forbidden), false);
  }
  assert.equal((await service.resolve(created.id, 1)).apiKey, secret);
  assert.deepEqual(await service.list(2), []);
  for (const action of [
    () => service.resolve(created.id, 2),
    () => service.update(created.id, 2, { apiKey: 'other' }),
    () => service.revoke(created.id, 2),
  ]) {
    await assert.rejects(action(), /not found or unavailable/);
  }
  await service.update(created.id, 1, { name: 'Renamed' });
  assert.equal((await service.resolve(created.id, 1)).apiKey, secret);
  await service.update(created.id, 1, { apiKey: 'replacement' });
  assert.equal((await service.resolve(created.id, 1)).apiKey, 'replacement');
  await service.revoke(created.id, 1);
  await assert.rejects(service.resolve(created.id, 1), /not found or unavailable/);
  await assert.rejects(service.update(created.id, 1, { name: 'No' }), /not found or unavailable/);
});

test('service rejects unsafe inputs, foreign repository records and concurrent edits', async () => {
  const { service, repository } = fixture();
  for (const patch of [
    { apiKey: '' },
    { apiKey: 'line\nbreak' },
    { name: '' },
    { capabilityProfileId: 'made-up' },
  ]) {
    await assert.rejects(service.create(1, { ...input, ...patch }), AiConnectionError);
  }
  const created = await service.create(1, input);
  repository.replace = async () => false;
  await assert.rejects(service.update(created.id, 1, { name: 'race' }), /not found/);
  const originalFind = repository.findActive;
  repository.findActive = async (id) => originalFind.call(repository, id, 1);
  await assert.rejects(service.resolve(created.id, 2), /not found/);
});
