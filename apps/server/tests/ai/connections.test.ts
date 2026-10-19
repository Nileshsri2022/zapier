import express from 'express';
import request from 'supertest';
import client from '@repo/db';
import router from '../../src/routes/AiConnectionsRoutes';
import { sanitizeInput } from '../../src/middlewares/sanitize';

jest.mock('../../src/middlewares', () => ({
  authMiddleware: (req: any, res: any, next: any) => {
    if (req.headers.authorization === 'Bearer user-one') {
      req.id = 1;
      next();
    } else res.status(403).json({ message: 'Not authenticated' });
  },
}));
jest.mock('node:dns/promises', () => ({
  lookup: jest.fn().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]),
}));

const db = client as any;
const app = express();
app.use(express.json());
app.use(sanitizeInput);
app.use('/api/ai/connections', router);
const endpoint = '/api/ai/connections';
const valid = {
  name: 'Example',
  baseUrl: 'https://api.example.com/v1',
  capabilityProfileId: 'chat_json_schema',
  apiKey: 'test-secret<&>"',
};
const id = '47116642-58b9-4b97-aa21-f92454711ff3';
function row(overrides = {}) {
  return {
    id,
    userId: 1,
    provider: 'openai_compatible',
    name: 'Example',
    baseUrl: valid.baseUrl,
    capabilityProfileId: valid.capabilityProfileId,
    credentialCiphertext: 'ciphertext',
    credentialNonce: 'nonce',
    credentialTag: 'tag',
    keyId: 'v1',
    revokedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  process.env.AI_COMPATIBLE_ALLOWED_HOSTS = 'api.example.com';
  process.env.AI_CONNECTION_ACTIVE_KEY_ID = 'v1';
  process.env.AI_CONNECTION_ENCRYPTION_KEYS = JSON.stringify({
    v1: Buffer.alloc(32, 1).toString('base64'),
  });
});
afterAll(() => {
  delete process.env.AI_COMPATIBLE_ALLOWED_HOSTS;
  delete process.env.AI_CONNECTION_ACTIVE_KEY_ID;
  delete process.env.AI_CONNECTION_ENCRYPTION_KEYS;
});

test('requires Bearer auth, rejects unauthenticated and invalid token requests', async () => {
  expect((await request(app).get(endpoint)).status).toBe(403);
  expect((await request(app).get(endpoint).set('Authorization', 'Bearer invalid')).status).toBe(
    403
  );
  expect(db.aiConnection.findMany).not.toHaveBeenCalled();
});

test('create encrypts opaque API key without XSS rewriting and returns no secrets', async () => {
  db.aiConnection.create.mockImplementation(async ({ data }: any) => data);
  const res = await request(app).post(endpoint).set('Authorization', 'Bearer user-one').send(valid);
  expect(res.status).toBe(201);
  const stored = db.aiConnection.create.mock.calls[0][0].data;
  expect(stored.userId).toBe(1);
  expect(stored.credentialCiphertext).not.toBe(valid.apiKey);
  expect(res.body.connection.configured).toBe(true);
  expect(res.body.connection).not.toHaveProperty('credentialCiphertext');
  expect(res.body.connection).not.toHaveProperty('apiKey');
  const { CredentialVault } = require('@repo/ai-connections');
  expect(CredentialVault.fromEnv().decrypt(stored)).toBe(valid.apiKey);
});

test('list scopes owner and returns redacted DTO only', async () => {
  db.aiConnection.findMany.mockResolvedValue([row()]);
  const res = await request(app).get(endpoint).set('Authorization', 'Bearer user-one');
  expect(res.status).toBe(200);
  expect(db.aiConnection.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { userId: 1 } })
  );
  expect(JSON.stringify(res.body)).not.toContain('ciphertext');
  expect(res.body.connections[0]).not.toHaveProperty('keyId');
});

test('foreign/missing connection is indistinguishable on update and revoke', async () => {
  db.aiConnection.findFirst.mockResolvedValue(null);
  expect(
    (
      await request(app)
        .patch(`${endpoint}/${id}`)
        .set('Authorization', 'Bearer user-one')
        .send({ name: 'new' })
    ).status
  ).toBe(404);
  expect(
    (await request(app).delete(`${endpoint}/${id}`).set('Authorization', 'Bearer user-one')).status
  ).toBe(404);
  expect(db.aiConnection.findFirst).toHaveBeenCalledWith({
    where: { id, userId: 1, revokedAt: null },
  });
  expect(db.aiConnection.updateMany).not.toHaveBeenCalled();
});

test('replacement is owner-scoped and revocation is soft', async () => {
  db.aiConnection.findFirst.mockResolvedValue(row());
  db.aiConnection.updateMany.mockResolvedValue({ count: 1 });
  const updated = await request(app)
    .patch(`${endpoint}/${id}`)
    .set('Authorization', 'Bearer user-one')
    .send({ apiKey: 'replacement' });
  expect(updated.status).toBe(200);
  expect(db.aiConnection.updateMany.mock.calls[0][0].where).toEqual(
    expect.objectContaining({ id, userId: 1, revokedAt: null })
  );
  const revoked = await request(app)
    .delete(`${endpoint}/${id}`)
    .set('Authorization', 'Bearer user-one');
  expect(revoked.status).toBe(204);
  expect(db.aiConnection.updateMany.mock.calls[1][0].data.revokedAt).toBeInstanceOf(Date);
});

test('rejects malformed settings and blocked endpoints without persisting', async () => {
  for (const input of [
    { ...valid, apiKey: '' },
    { ...valid, userId: 99 },
    { ...valid, capabilityProfileId: 'arbitrary' },
  ]) {
    expect(
      (await request(app).post(endpoint).set('Authorization', 'Bearer user-one').send(input)).status
    ).toBe(411);
  }
  expect(
    (
      await request(app)
        .post(endpoint)
        .set('Authorization', 'Bearer user-one')
        .send({ ...valid, baseUrl: 'http://localhost/v1' })
    ).status
  ).toBe(400);
  expect(db.aiConnection.create).not.toHaveBeenCalled();
});

test('sanitizes internal failures instead of echoing DB/crypto details', async () => {
  db.aiConnection.findMany.mockRejectedValue(new Error(`database failure: ${valid.apiKey}`));
  const res = await request(app).get(endpoint).set('Authorization', 'Bearer user-one');
  expect(res.status).toBe(500);
  expect(res.body).toEqual({ message: 'AI connection operation failed' });
  process.env.AI_CONNECTION_ENCRYPTION_KEYS = 'malformed secret';
  const unconfigured = await request(app).get(endpoint).set('Authorization', 'Bearer user-one');
  expect(unconfigured.status).toBe(503);
  expect(JSON.stringify(unconfigured.body)).not.toContain('malformed secret');
});
