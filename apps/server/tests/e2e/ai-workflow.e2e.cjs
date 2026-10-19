/** Explicitly gated: uses a running API/processor/worker, real test DB, Redis and paid AI.
 * No Jest setup/mocks. Never run against production. See reports/ai-connection-operations.md.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { randomUUID, createHmac } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const enabled = process.env.RUN_E2E === '1';

for (const provider of (process.env.AI_E2E_PROVIDERS || 'openai')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)) {
  test(
    `real Webhook → ${provider} classify → conditional Webhook`,
    { skip: !enabled, timeout: 600000 },
    async (t) => {
      assert.equal(
        process.env.AI_E2E_ACK_TEST_ENV,
        'I_ACCEPT_TEST_ONLY',
        'Explicit test-environment acknowledgement required'
      );
      const api = new URL(process.env.AI_E2E_API_URL || 'http://127.0.0.1:5000');
      assert.match(
        api.hostname,
        /(?:localhost|127\.0\.0\.1|staging|e2e|e2b|test)/i,
        'API must be an explicitly named test/staging host'
      );
      assert.ok(
        process.env.DATABASE_URL && /test|e2e/i.test(new URL(process.env.DATABASE_URL).pathname),
        'DATABASE_URL must name a test/e2e database'
      );
      assert.ok(process.env.AI_E2E_TOKEN, 'AI_E2E_TOKEN must belong to a disposable test user');
      assert.ok(['openai', 'anthropic', 'puter', 'openai_compatible'].includes(provider));
      // Lazy load: skipped tests do not instantiate Prisma or contact anything.
      const { PrismaClient } = require('@prisma/client');
      const db = new PrismaClient();
      t.after(() => db.$disconnect());
      const receiverSecret = randomUUID();
      const hits = [];
      const receiver = createServer(async (req, res) => {
        if (
          req.url !== `/receiver/${receiverSecret}` ||
          req.headers['x-ai-test'] !== receiverSecret
        ) {
          res.writeHead(404);
          res.end();
          return;
        }
        let bytes = 0;
        const chunks = [];
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 65536) {
            res.writeHead(413);
            res.end();
            return;
          }
          chunks.push(chunk);
        }
        try {
          hits.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          res.setHeader('Content-Type', 'application/json');
          res.end('{"received":true}');
        } catch {
          res.writeHead(400);
          res.end();
        }
      });
      await new Promise((resolve) =>
        receiver.listen(Number(process.env.AI_E2E_RECEIVER_PORT || 19095), '0.0.0.0', resolve)
      );
      t.after(() => new Promise((resolve) => receiver.close(resolve)));
      const port = receiver.address().port;
      const receiverUrl = `${(process.env.AI_E2E_RECEIVER_URL || `http://127.0.0.1:${port}`).replace(/\/$/, '')}/receiver/${receiverSecret}`;
      const headers = {
        Authorization: `Bearer ${process.env.AI_E2E_TOKEN}`,
        'Content-Type': 'application/json',
      };
      async function apiCall(path, method = 'GET', body) {
        const response = await fetch(new URL(path, api), {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(150000),
        });
        assert.ok(
          response.ok,
          `Test API ${method} ${path.split('/').slice(0, 4).join('/')} returned ${response.status}`
        );
        return response.status === 204 ? {} : response.json();
      }
      const actions = (await apiCall('/api/actions')).availableActions;
      const triggers = (await apiCall('/api/triggers')).avialableTriggers;
      const aiAction = actions.find((a) => a.type === 'AI Transform');
      const webhookAction = actions.find((a) => a.type === 'Webhook');
      const webhookTrigger = triggers.find((a) => a.type === 'Webhook');
      assert.ok(
        aiAction && webhookAction && webhookTrigger,
        'Seed the test catalog before running'
      );
      assert.equal(
        (await db.availableActions.findUnique({ where: { id: aiAction.id } }))?.type,
        'AI Transform',
        'API and test DB must match'
      );
      const settings = (await apiCall('/api/actions/ai/models')).providers.find(
        (p) => p.id === provider
      );
      assert.ok(settings?.configured, `Configure ${provider} consistently on API and worker`);
      const model =
        process.env[`AI_E2E_MODEL_${provider.toUpperCase()}`] ||
        settings.defaultModel ||
        settings.models[0];
      assert.ok(model, 'Choose a verified test model');
      const metadata = {
        provider,
        model,
        mode: 'classify',
        input: '{message}',
        categories: ['positive', 'negative'],
        instructions:
          'Classify sentiment. Complaints and refund requests are negative; praise and thanks are positive.',
        maxOutputTokens: 100,
      };
      if (provider === 'openai_compatible') {
        assert.ok(process.env.AI_E2E_CONNECTION_ID, 'Use a preconfigured, owned test connection');
        metadata.connectionId = process.env.AI_E2E_CONNECTION_ID;
      }
      let zapId;
      try {
        zapId = (
          await apiCall('/api/zaps', 'POST', {
            availableTriggerId: webhookTrigger.id,
            actions: [
              { availableActionId: aiAction.id, actionMetaData: metadata },
              {
                availableActionId: webhookAction.id,
                actionMetaData: {
                  url: receiverUrl,
                  method: 'POST',
                  headers: { 'X-AI-Test': receiverSecret },
                  body: { eventId: '{event_id}', category: '{previousOutput.fields.category}' },
                },
                stepConditions: [
                  {
                    field: 'previousOutput.fields.category',
                    operator: 'equals',
                    value: 'negative',
                  },
                ],
              },
            ],
          })
        ).zapId;
        assert.ok(zapId);
        assert.ok(
          await db.zap.findUnique({ where: { id: zapId } }),
          'Created Zap must exist in test DB'
        );
        await apiCall(`/api/zaps/${zapId}/enable`, 'PATCH', { isActive: true });
        for (const [category, message] of [
          ['negative', 'This service is terrible. I want a refund.'],
          ['positive', 'Your service is excellent. Thank you for the wonderful help.'],
        ]) {
          const eventId = `ai-e2e-${randomUUID()}`;
          const payload = {
            event_id: eventId,
            message,
            stepOutputs: {
              1: {
                provider: 'spoofed-ingress',
                fields: { category: category === 'negative' ? 'positive' : 'negative' },
              },
            },
          };
          const triggerHeaders = { 'Content-Type': 'application/json' };
          if (process.env.AI_E2E_WEBHOOK_SECRET)
            triggerHeaders['x-webhook-signature'] =
              `sha256=${createHmac('sha256', process.env.AI_E2E_WEBHOOK_SECRET).update(JSON.stringify(payload)).digest('hex')}`;
          const response = await fetch(new URL(`/api/triggers/webhook/${zapId}`, api), {
            method: 'POST',
            headers: triggerHeaders,
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(10000),
          });
          assert.equal(response.status, 200);
          if (process.env.AI_E2E_PROCESSOR_URL) {
            assert.ok(process.env.CRON_SECRET, 'CRON_SECRET required for explicit outbox drain');
            const drain = await fetch(
              `${process.env.AI_E2E_PROCESSOR_URL.replace(/\/$/, '')}/process`,
              {
                method: 'POST',
                headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
                signal: AbortSignal.timeout(30000),
              }
            );
            assert.ok(drain.ok);
          }
          let run;
          const deadline = Date.now() + 240000;
          do {
            run = await db.zapRun.findFirst({
              where: { zapId, metadata: { path: ['event_id'], equals: eventId } },
            });
            if (run?.status === 'failed')
              assert.fail('AI workflow failed; inspect the sanitized test run error in staging');
            if (run?.status === 'completed') break;
            await delay(500);
          } while (Date.now() < deadline);
          assert.equal(
            run?.status,
            'completed',
            'Outbox/worker must complete the run, including skipped final steps'
          );
          assert.equal(run.metadata.stepOutputs['1'].fields.category, category);
          assert.equal(run.metadata.stepOutputs['1'].provider, provider);
          const usage = run.metadata.stepOutputs['1'].usage;
          if (usage?.inputTokens !== undefined) assert.ok(Number.isInteger(usage.inputTokens));
          assert.equal(
            hits.filter((hit) => hit.eventId === eventId).length,
            category === 'negative' ? 1 : 0
          );
        }
      } finally {
        if (zapId) {
          await apiCall(`/api/zaps/${zapId}/enable`, 'PATCH', { isActive: false });
          await apiCall(`/api/zaps/${zapId}`, 'DELETE');
          assert.equal(
            await db.zap.findUnique({ where: { id: zapId } }),
            null,
            'Test Zap cleanup must complete'
          );
        }
      }
    }
  );
}
