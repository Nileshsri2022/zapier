const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDailyBudget, RESERVE_AI_CALL_LUA } = require('../dist');

test('budget sends one atomic reservation with owner/global UTC keys and TTL script', async () => {
  let args;
  const reserve = createDailyBudget(
    async (...values) => {
      args = values;
      return 1;
    },
    42,
    {},
    () => new Date('2026-10-19T23:59:59Z')
  );
  await reserve();
  assert.equal(args[0], RESERVE_AI_CALL_LUA);
  assert.deepEqual(args[1], ['ai:calls:user:42:2026-10-19', 'ai:calls:global:2026-10-19']);
  assert.deepEqual(args[2], [200, 0]);
  assert.match(args[0], /172800/);
  assert.ok(args[0].indexOf('return 0') < args[0].indexOf("redis.call('INCR'"));
});

test('budget exhaustion and Redis outage fail closed; opt-in fail-open warns without details', async () => {
  await assert.rejects(createDailyBudget(async () => 0, 1)(), /budget reached/);
  await assert.rejects(
    createDailyBudget(
      async () => {
        throw Error('SECRET');
      },
      1,
      {}
    )(),
    (e) => !e.retryable && !e.message.includes('SECRET')
  );
  let warning;
  await createDailyBudget(
    async () => {
      throw Error('SECRET');
    },
    1,
    { AI_BUDGET_FAIL_OPEN: 'true' },
    undefined,
    (message) => {
      warning = message;
    }
  )();
  assert.match(warning, /fail-open/);
  assert.ok(!warning.includes('SECRET'));
});

test('explicitly disabled budgets do not require Redis; invalid owner/policy fails', async () => {
  await createDailyBudget(
    async () => {
      throw Error('must not call');
    },
    1,
    { AI_DAILY_CALL_CAP_PER_USER: '0', AI_DAILY_CALL_CAP_GLOBAL: '0' }
  )();
  assert.throws(() => createDailyBudget(async () => 1, 0));
  assert.throws(() => createDailyBudget(async () => 1, 1, { AI_DAILY_CALL_CAP_GLOBAL: '-1' }));
});
