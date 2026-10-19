import type { AiConnection, PrismaClient } from '@prisma/client';
import { AiConnectionService, ConnectionRecord, ConnectionRepository } from './service';
import { AiConnectionError } from './errors';
import { CredentialVault } from './crypto';
import { parseAllowedHosts } from './policy';

function record(row: AiConnection): ConnectionRecord {
  if (row.provider !== 'openai_compatible') {
    throw new AiConnectionError('CONFIGURATION', 'Unsupported AI connection type');
  }
  return { ...row, provider: 'openai_compatible' };
}

export function createPrismaConnectionRepository(
  client: Pick<PrismaClient, 'aiConnection'>
): ConnectionRepository {
  return {
    async list(userId) {
      return (
        await client.aiConnection.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } })
      ).map(record);
    },
    async findActive(id, userId) {
      const row = await client.aiConnection.findFirst({ where: { id, userId, revokedAt: null } });
      return row ? record(row) : null;
    },
    async create(data) {
      return record(await client.aiConnection.create({ data }));
    },
    async replace(id, userId, updatedAt, changes) {
      const result = await client.aiConnection.updateMany({
        where: { id, userId, revokedAt: null, updatedAt },
        data: changes,
      });
      return result.count === 1;
    },
    async revoke(id, userId) {
      const result = await client.aiConnection.updateMany({
        where: { id, userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return result.count === 1;
    },
  };
}

export function createAiConnectionService(
  client: Pick<PrismaClient, 'aiConnection'>,
  env: NodeJS.ProcessEnv = process.env
): AiConnectionService {
  return new AiConnectionService(
    createPrismaConnectionRepository(client),
    CredentialVault.fromEnv(env),
    parseAllowedHosts(env.AI_COMPATIBLE_ALLOWED_HOSTS)
  );
}

/** Called at startup; optional integrations stay off unless explicitly configured. */
export function validateAiConnectionEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  parseAllowedHosts(env.AI_COMPATIBLE_ALLOWED_HOSTS);
  if (
    env.AI_CONNECTION_ENCRYPTION_KEYS ||
    env.AI_CONNECTION_ACTIVE_KEY_ID ||
    env.AI_COMPATIBLE_ALLOWED_HOSTS?.trim()
  ) {
    CredentialVault.fromEnv(env);
  }
}
