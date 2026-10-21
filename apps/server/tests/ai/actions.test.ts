import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import client from '@repo/db';
import redis from '@repo/redis';
import { AiActionMetaDataSchema } from '@repo/types';
import AiActionsRouter from '../../src/routes/AiActionsRoutes';
import { getAiCsrf } from '../../src/middlewares/aiCsrf';
import { createZap, updateZapWithId } from '../../src/controllers/ZapController';
import { sanitizeInput } from '../../src/middlewares/sanitize';

jest.mock('@repo/redis', () => ({
  __esModule: true,
  default: { eval: jest.fn().mockResolvedValue(1) },
}));
jest.mock('../../src/middlewares', () => ({
  authMiddleware: (req: any, res: any, next: any) => {
    if (req.cookies?.auth_token || req.headers.authorization === 'Bearer valid') {
      req.id = 1;
      next();
    } else res.status(403).json({ message: 'Unauthorized' });
  },
}));
const { authMiddleware } = require('../../src/middlewares');
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(sanitizeInput);
app.get('/api/ai/csrf', authMiddleware, getAiCsrf);
app.use('/api/actions/ai', AiActionsRouter);
app.post('/api/zaps', authMiddleware, createZap);
app.put('/api/zaps/:zapId', authMiddleware, updateZapWithId);
const db = client as any;
const env = { ...process.env };
const config = { provider: 'openai', mode: 'classify', input: '{text}', categories: ['yes', 'no'] };
let originalFetch: typeof fetch;
beforeEach(() => {
  process.env.OPENAI_API_KEY = 'PRIVATE_API_KEY';
  process.env.AI_DEFAULT_MODEL_OPENAI = 'test-model';
  process.env.AI_MODEL_ALLOWLIST_OPENAI = 'test-model';
  process.env.JWT_SECRET = 'secret-for-ai-csrf-tests';
  originalFetch = global.fetch;
  global.fetch = jest.fn(
    async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"category":"yes"}' } }],
          usage: { prompt_tokens: 5, completion_tokens: 2 },
        })
      )
  );
  db.availableActions.findUnique.mockResolvedValue({ type: 'AI Transform' });
  (redis.eval as jest.Mock).mockResolvedValue(1);
});
afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...env };
});

test('metadata accept/reject matrix and secret stripping match runtime contract', () => {
  const parsed = AiActionMetaDataSchema.parse({
    ...config,
    apiKey: 'PRIVATE',
    baseUrl: 'https://example.com',
  });
  expect(parsed).not.toHaveProperty('apiKey');
  expect(parsed).not.toHaveProperty('baseUrl');
  for (const raw of [
    { ...config, categories: ['one'] },
    { ...config, categories: ['same', 'same'] },
    { ...config, mode: 'custom', instructions: '' },
    { ...config, mode: 'extract' },
    { ...config, temperature: 2 },
    { ...config, maxOutputTokens: 2001 },
    { ...config, provider: 'openai_compatible', connectionId: 'not-a-uuid', model: 'x' },
    {
      ...config,
      mode: 'extract',
      outputFields: [{ name: '__proto__', type: 'text', isRequired: true }],
    },
    {
      ...config,
      mode: 'extract',
      outputFields: [{ name: 'x', type: 'category_single', isRequired: true }],
    },
    {
      ...config,
      mode: 'extract',
      outputFields: [{ name: 'x', type: 'text', options: ['a', 'b'], isRequired: true }],
    },
  ])
    expect(AiActionMetaDataSchema.safeParse(raw).success).toBe(false);
});

test('models require auth and never leak key values; Puter defaults disabled', async () => {
  expect((await request(app).get('/api/actions/ai/models')).status).toBe(403);
  const res = await request(app).get('/api/actions/ai/models').set('Authorization', 'Bearer valid');
  expect(res.status).toBe(200);
  expect(JSON.stringify(res.body)).not.toContain('PRIVATE_API_KEY');
  expect(res.body.providers.find((p: any) => p.id === 'openai').configured).toBe(true);
  expect(res.body.providers.find((p: any) => p.id === 'puter').configured).toBe(false);
});

test('preview uses literal input, real shared normalization and budget without a ZapRun', async () => {
  const res = await request(app)
    .post('/api/actions/ai/test')
    .set('Authorization', 'Bearer valid')
    .send({ ...config, input: 'Literal {text} <tag>' });
  expect(res.status).toBe(200);
  expect(res.body.fields).toEqual({ category: 'yes' });
  expect(res.body.usage.inputTokens).toBe(5);
  const fetchOptions = (global.fetch as jest.Mock).mock.calls[0][1];
  expect(JSON.parse(fetchOptions.body).messages[1].content).toContain('Literal {text} &lt;tag&gt;');
  expect(redis.eval).toHaveBeenCalledTimes(1);
  expect(db.zapRun.create).not.toHaveBeenCalled();
});

test('preview rejects caps, unavailable models and exhausted budgets before dispatch', async () => {
  for (const raw of [
    { ...config, input: 'x'.repeat(50001) }, // Q-AI-04: sample input cap is 50,000 chars
    { ...config, model: 'not-allowed' },
    { ...config, maxOutputTokens: 2001 },
  ]) {
    expect(
      (
        await request(app)
          .post('/api/actions/ai/test')
          .set('Authorization', 'Bearer valid')
          .send(raw)
      ).status
    ).toBe(411);
  }
  (redis.eval as jest.Mock).mockResolvedValue(0);
  const res = await request(app)
    .post('/api/actions/ai/test')
    .set('Authorization', 'Bearer valid')
    .send(config);
  expect(res.status).toBe(400);
  expect(res.body.message).toMatch(/budget reached/);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('cookie auth requires session-bound CSRF; mixed Bearer does not bypass it', async () => {
  const token = await request(app).get('/api/ai/csrf').set('Cookie', 'auth_token=session-one');
  expect(token.status).toBe(200);
  expect(token.headers['cache-control']).toBe('no-store');
  expect(
    (
      await request(app)
        .post('/api/actions/ai/test')
        .set('Cookie', 'auth_token=session-one')
        .set('Authorization', 'Bearer valid')
        .send(config)
    ).status
  ).toBe(403);
  const ok = await request(app)
    .post('/api/actions/ai/test')
    .set('Cookie', 'auth_token=session-one')
    .set('X-AI-CSRF', token.body.csrfToken)
    .send(config);
  expect(ok.status).toBe(200);
  const wrongSession = await request(app)
    .post('/api/actions/ai/test')
    .set('Cookie', 'auth_token=session-two')
    .set('X-AI-CSRF', token.body.csrfToken)
    .send(config);
  expect(wrongSession.status).toBe(403);
});

test('create and update reject invalid AI metadata without writes', async () => {
  const body = {
    availableTriggerId: 'trigger',
    actions: [{ availableActionId: 'ai', actionMetaData: { ...config, categories: [] } }],
  };
  expect(
    (await request(app).post('/api/zaps').set('Authorization', 'Bearer valid').send(body)).status
  ).toBe(411);
  db.zap.findFirst.mockResolvedValue({ id: 'zap', userId: 1 });
  expect(
    (await request(app).put('/api/zaps/zap').set('Authorization', 'Bearer valid').send(body)).status
  ).toBe(411);
  expect(db.$transaction).not.toHaveBeenCalled();
});

test('create stores parsed metadata without credentials and preserves literal owner instructions', async () => {
  const create = jest.fn().mockResolvedValue({ id: 'zap' });
  // The trigger catalog is read before the transaction (zapComposition).
  db.availableTriggers.findUnique.mockResolvedValue({ id: 'trigger', type: 'Webhook' });
  db.$transaction.mockImplementation(async (fn: any) =>
    fn({
      availableTriggers: { findUnique: async () => ({ type: 'Webhook' }) },
      zap: { create, update: async () => ({}) },
      trigger: { create: async () => ({ id: 'trigger' }) },
    })
  );
  const res = await request(app)
    .post('/api/zaps')
    .set('Authorization', 'Bearer valid')
    .send({
      availableTriggerId: 'trigger',
      actions: [
        {
          availableActionId: 'ai',
          stepConditions: [
            { field: 'previousOutput.fields.category', operator: 'equals', value: 'negative' },
          ],
          actionMetaData: {
            ...config,
            instructions: 'Keep <tag> and {text}',
            apiKey: 'NEVER_STORE',
          },
        },
      ],
    });
  expect(res.status).toBe(201);
  const stored = create.mock.calls[0][0].data.actions.create[0].metadata;
  expect(stored).not.toHaveProperty('apiKey');
  expect(stored.instructions).toBe('Keep <tag> and {text}');
  expect(create.mock.calls[0][0].data.actions.create[0].stepConditions).toEqual([
    { field: 'previousOutput.fields.category', operator: 'equals', value: 'negative' },
  ]);
});

test('compatible connection ownership checked on save; foreign Zap cannot be updated', async () => {
  const compatible = {
    ...config,
    provider: 'openai_compatible',
    model: 'user-model',
    connectionId: '47116642-58b9-4b97-aa21-f92454711ff3',
  };
  process.env.AI_COMPATIBLE_ALLOWED_HOSTS = 'api.example.com';
  db.availableTriggers.findUnique.mockResolvedValue({ id: 'trigger', type: 'Webhook' });
  db.aiConnection.findFirst.mockResolvedValue(null);
  expect(
    (
      await request(app)
        .post('/api/zaps')
        .set('Authorization', 'Bearer valid')
        .send({
          availableTriggerId: 'trigger',
          actions: [{ availableActionId: 'ai', actionMetaData: compatible }],
        })
    ).status
  ).toBe(411);
  expect(db.aiConnection.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({ where: expect.objectContaining({ userId: 1, revokedAt: null }) })
  );
  db.zap.findFirst.mockResolvedValue(null);
  expect(
    (
      await request(app)
        .put('/api/zaps/foreign')
        .set('Authorization', 'Bearer valid')
        .send({ actions: [] })
    ).status
  ).toBe(404);
  expect(db.$transaction).not.toHaveBeenCalled();
});

test('step condition schema rejects unsupported operators and prototype paths', () => {
  const { StepConditionSchema } = require('@repo/types');
  expect(
    StepConditionSchema.safeParse({
      field: 'previousOutput.fields.category',
      operator: 'equals',
      value: 'negative',
    }).success
  ).toBe(true);
  expect(
    StepConditionSchema.safeParse({ field: 'x', operator: 'made_up', value: 'negative' }).success
  ).toBe(false);
  expect(
    StepConditionSchema.safeParse({ field: '__proto__.x', operator: 'equals', value: 'negative' })
      .success
  ).toBe(false);
});

test('model discovery does not invent a default when only an explicit allowlist is configured', async () => {
  delete process.env.AI_DEFAULT_MODEL_OPENAI;
  const response = await request(app)
    .get('/api/actions/ai/models')
    .set('Authorization', 'Bearer valid');
  expect(response.body.providers.find((p: any) => p.id === 'openai')).toEqual(
    expect.objectContaining({ configured: true, defaultModel: '', models: ['test-model'] })
  );
  expect(
    (
      await request(app)
        .post('/api/actions/ai/test')
        .set('Authorization', 'Bearer valid')
        .send({ ...config, model: 'test-model' })
    ).status
  ).toBe(200);
});

test('update stores canonical AI metadata and step conditions after ownership validation', async () => {
  db.zap.findFirst.mockResolvedValue({ id: 'zap', userId: 1 });
  const update = jest.fn().mockResolvedValue({ id: 'zap' });
  const deleteMany = jest.fn();
  db.$transaction.mockImplementation(async (fn: any) =>
    fn({ action: { deleteMany }, zap: { update } })
  );
  const conditions = [
    { field: 'previousOutput.fields.category', operator: 'equals', value: 'yes' },
  ];
  const response = await request(app)
    .put('/api/zaps/zap')
    .set('Authorization', 'Bearer valid')
    .send({
      actions: [
        {
          availableActionId: 'ai',
          actionMetaData: { ...config, apiKey: 'NEVER_STORE' },
          stepConditions: conditions,
        },
      ],
    });
  expect(response.status).toBe(201);
  expect(update.mock.calls[0][0].data.actions.create[0].stepConditions).toEqual(conditions);
  expect(update.mock.calls[0][0].data.actions.create[0].metadata).not.toHaveProperty('apiKey');
  expect(deleteMany).toHaveBeenCalledWith({ where: { zapId: 'zap' } });
});
