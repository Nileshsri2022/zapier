const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
function acknowledgement() {
  assert.equal(process.env.AI_E2E_ACK_TEST_ENV, 'I_ACCEPT_TEST_ONLY');
}

test(
  'real Redis atomic reservation under competing owners and shared global cap',
  { skip: process.env.RUN_AI_REDIS_E2E !== '1', timeout: 30000 },
  async () => {
    acknowledgement();
    assert.ok(
      process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
      'Use a dedicated test Redis instance'
    );
    const { Redis } = require('@upstash/redis');
    const { RESERVE_AI_CALL_LUA } = require('@repo/ai');
    const redis = Redis.fromEnv();
    const prefix = `ai:e2e:${randomUUID()}`;
    const keys = [`${prefix}:ownerA`, `${prefix}:ownerB`, `${prefix}:global`];
    try {
      const results = await Promise.all(
        Array.from({ length: 40 }, (_, i) =>
          redis.eval(RESERVE_AI_CALL_LUA, [keys[i % 2], keys[2]], [3, 5])
        )
      );
      assert.equal(results.filter((value) => value === 1).length, 5);
      const a = Number(await redis.get(keys[0]));
      const b = Number(await redis.get(keys[1]));
      assert.ok(a <= 3 && b <= 3);
      assert.equal(a + b, 5);
      assert.equal(Number(await redis.get(keys[2])), 5);
      for (const key of keys) {
        const ttl = await redis.ttl(key);
        assert.ok(ttl > 0 && ttl <= 172800);
      }
    } finally {
      await redis.del(...keys);
    }
  }
);

test(
  'real migrated PostgreSQL encrypted CRUD, ownership, rotation and revocation',
  { skip: process.env.RUN_AI_DB_E2E !== '1', timeout: 30000 },
  async (t) => {
    acknowledgement();
    assert.ok(
      process.env.DATABASE_URL && /test|e2e/i.test(new URL(process.env.DATABASE_URL).pathname),
      'Use a disposable test/e2e database'
    );
    const { PrismaClient } = require('@prisma/client');
    const { CredentialVault, createPrismaConnectionRepository } = require('@repo/ai-connections');
    const db = new PrismaClient();
    t.after(() => db.$disconnect());
    const migration =
      await db.$queryRaw`SELECT "finished_at" FROM "_prisma_migrations" WHERE "migration_name" = '20261019130000_ai_connections' AND "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL`;
    assert.equal(
      migration.length,
      1,
      'Apply the reviewed migration using prisma migrate deploy first'
    );
    const users = [];
    try {
      for (let i = 0; i < 2; i++)
        users.push(
          await db.user.create({
            data: {
              name: 'AI E2E disposable',
              email: `ai-e2e-${randomUUID()}@example.invalid`,
              password: '!disabled-e2e-login',
            },
          })
        );
      const keyring = JSON.stringify({
        old: randomBytes(32).toString('base64'),
        next: randomBytes(32).toString('base64'),
      });
      const vault = (key) =>
        CredentialVault.fromEnv({
          AI_CONNECTION_ENCRYPTION_KEYS: keyring,
          AI_CONNECTION_ACTIVE_KEY_ID: key,
        });
      const identity = { id: randomUUID(), userId: users[0].id, provider: 'openai_compatible' };
      const secret = `fake-e2e-${randomUUID()}`;
      const repo = createPrismaConnectionRepository(db);
      const row = await repo.create({
        ...identity,
        ...vault('old').encrypt(secret, identity),
        name: 'E2E only',
        baseUrl: 'https://api.example.com/v1',
        capabilityProfileId: 'chat_prompt_json',
        createdAt: new Date(),
        updatedAt: new Date(),
        revokedAt: null,
      });
      assert.equal(vault('old').decrypt(row), secret);
      assert.ok(!JSON.stringify(row).includes(secret));
      assert.equal(await repo.findActive(row.id, users[1].id), null);
      assert.equal(
        await repo.replace(row.id, users[1].id, row.updatedAt, { name: 'forbidden' }),
        false
      );
      assert.equal(await repo.revoke(row.id, users[1].id), false);
      assert.equal(
        await repo.replace(row.id, users[0].id, row.updatedAt, vault('next').rotate(row)),
        true
      );
      const rotated = await repo.findActive(row.id, users[0].id);
      assert.equal(rotated.keyId, 'next');
      assert.equal(vault('next').decrypt(rotated), secret);
      await assert.rejects(
        db.user.delete({ where: { id: users[0].id } }),
        'Migration must restrict deletion of a referenced owner'
      );
      await assert.rejects(
        db.aiConnection.create({ data: { ...row, id: randomUUID(), provider: 'openai' } }),
        'Migration must enforce the compatible-provider check'
      );
      assert.equal(await repo.revoke(row.id, users[0].id), true);
      assert.equal(await repo.findActive(row.id, users[0].id), null);
      assert.ok((await repo.list(users[0].id))[0].revokedAt);
    } finally {
      for (const user of users) {
        await db.aiConnection.deleteMany({ where: { userId: user.id } });
        await db.user.delete({ where: { id: user.id } });
      }
    }
  }
);
