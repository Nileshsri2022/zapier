import { randomUUID } from 'node:crypto';
import { CredentialIdentity, CredentialVault, EncryptedCredential } from './crypto';
import { AiConnectionError } from './errors';
import {
  CAPABILITY_PROFILES,
  CapabilityProfileId,
  normalizeBaseUrl,
  resolvePublicAddress,
} from './policy';

export interface ConnectionRecord extends CredentialIdentity, EncryptedCredential {
  name: string;
  baseUrl: string;
  capabilityProfileId: string;
  createdAt: Date;
  updatedAt: Date;
  revokedAt: Date | null;
}
export interface ConnectionInput {
  name: string;
  baseUrl: string;
  capabilityProfileId: CapabilityProfileId;
  apiKey: string;
}
/** Persistence is injected so the same owner checks are used by server and future worker. */
export interface ConnectionRepository {
  list(userId: number): Promise<ConnectionRecord[]>;
  findActive(id: string, userId: number): Promise<ConnectionRecord | null>;
  create(record: ConnectionRecord): Promise<ConnectionRecord>;
  replace(
    id: string,
    userId: number,
    expectedUpdatedAt: Date,
    changes: Partial<ConnectionRecord>
  ): Promise<boolean>;
  revoke(id: string, userId: number): Promise<boolean>;
}

function notFound(): never {
  throw new AiConnectionError('NOT_FOUND', 'AI connection not found or unavailable');
}
function assertOwner(userId: number): void {
  if (!Number.isSafeInteger(userId) || userId <= 0) notFound();
}
function validateInput(input: ConnectionInput): void {
  if (
    typeof input.name !== 'string' ||
    !input.name.trim() ||
    input.name.length > 100 ||
    typeof input.baseUrl !== 'string' ||
    !CAPABILITY_PROFILES.includes(input.capabilityProfileId) ||
    typeof input.apiKey !== 'string' ||
    !input.apiKey ||
    input.apiKey.length > 8192 ||
    !/^[!-~]+$/.test(input.apiKey)
  ) {
    throw new AiConnectionError('INVALID_INPUT', 'Invalid AI connection settings');
  }
}
export function redactConnection(record: ConnectionRecord) {
  return {
    id: record.id,
    name: record.name,
    provider: record.provider,
    baseUrl: record.baseUrl,
    capabilityProfileId: record.capabilityProfileId,
    configured: true,
    revoked: record.revokedAt !== null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export class AiConnectionService {
  constructor(
    private readonly repository: ConnectionRepository,
    private readonly vault: CredentialVault,
    private readonly allowedHosts: readonly string[],
    private readonly validateDestination = async (hostname: string) => {
      await resolvePublicAddress(hostname);
    }
  ) {}

  async list(userId: number) {
    assertOwner(userId);
    return (await this.repository.list(userId))
      .filter((row) => row.userId === userId)
      .map(redactConnection);
  }

  private async owned(id: string, userId: number): Promise<ConnectionRecord> {
    assertOwner(userId);
    const row = await this.repository.findActive(id, userId);
    if (
      !row ||
      row.id !== id ||
      row.userId !== userId ||
      row.revokedAt ||
      row.provider !== 'openai_compatible'
    ) {
      return notFound();
    }
    return row;
  }

  private async endpoint(raw: string): Promise<string> {
    const baseUrl = normalizeBaseUrl(raw, this.allowedHosts);
    await this.validateDestination(new URL(baseUrl).hostname);
    return baseUrl;
  }

  async create(userId: number, input: ConnectionInput) {
    assertOwner(userId);
    validateInput(input);
    const baseUrl = await this.endpoint(input.baseUrl);
    const identity: CredentialIdentity = {
      id: randomUUID(),
      userId,
      provider: 'openai_compatible',
    };
    const now = new Date();
    const record = await this.repository.create({
      ...identity,
      ...this.vault.encrypt(input.apiKey, identity),
      name: input.name.trim(),
      baseUrl,
      capabilityProfileId: input.capabilityProfileId,
      createdAt: now,
      updatedAt: now,
      revokedAt: null,
    });
    return redactConnection(record);
  }

  async update(id: string, userId: number, patch: Partial<ConnectionInput>) {
    const row = await this.owned(id, userId);
    const input: ConnectionInput = {
      name: patch.name ?? row.name,
      baseUrl: patch.baseUrl ?? row.baseUrl,
      capabilityProfileId:
        patch.capabilityProfileId ?? (row.capabilityProfileId as CapabilityProfileId),
      apiKey: patch.apiKey ?? this.vault.decrypt(row),
    };
    validateInput(input);
    const baseUrl = await this.endpoint(input.baseUrl);
    // A replacement or endpoint change must never race another edit/revocation.
    const changes = {
      name: input.name.trim(),
      baseUrl,
      capabilityProfileId: input.capabilityProfileId,
      ...this.vault.encrypt(input.apiKey, row),
      updatedAt: new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1)),
    };
    if (!(await this.repository.replace(id, userId, row.updatedAt, changes))) return notFound();
    return redactConnection({ ...row, ...changes });
  }

  async revoke(id: string, userId: number): Promise<void> {
    await this.owned(id, userId);
    if (!(await this.repository.revoke(id, userId))) return notFound();
  }

  /** Server/worker only. Never return this result from an HTTP handler. */
  async resolve(id: string, userId: number) {
    const row = await this.owned(id, userId);
    const baseUrl = await this.endpoint(row.baseUrl);
    if (!CAPABILITY_PROFILES.includes(row.capabilityProfileId as CapabilityProfileId)) {
      throw new AiConnectionError(
        'CONFIGURATION',
        'AI connection capability profile is unavailable'
      );
    }
    return {
      baseUrl,
      apiKey: this.vault.decrypt(row),
      capabilityProfileId: row.capabilityProfileId as CapabilityProfileId,
    };
  }
}
