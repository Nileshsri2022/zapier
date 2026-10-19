import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AiConnectionError } from './errors';

export interface CredentialIdentity {
  id: string;
  userId: number;
  provider: 'openai_compatible';
}
export interface EncryptedCredential {
  credentialCiphertext: string;
  credentialNonce: string;
  credentialTag: string;
  keyId: string;
}

function configurationError(): never {
  throw new AiConnectionError(
    'CONFIGURATION',
    'AI connection encryption is not configured correctly'
  );
}

/** JSON object of key IDs to canonical base64-encoded 32-byte keys. */
export class CredentialVault {
  private constructor(
    private readonly keys: ReadonlyMap<string, Buffer>,
    readonly activeKeyId: string
  ) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): CredentialVault {
    try {
      const parsed: unknown = JSON.parse(env.AI_CONNECTION_ENCRYPTION_KEYS || 'null');
      const active = env.AI_CONNECTION_ACTIVE_KEY_ID;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !active) {
        return configurationError();
      }
      const keys = new Map<string, Buffer>();
      for (const [id, value] of Object.entries(parsed)) {
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || typeof value !== 'string') {
          return configurationError();
        }
        const key = Buffer.from(value, 'base64');
        if (key.length !== 32 || key.toString('base64') !== value) return configurationError();
        keys.set(id, key);
      }
      if (!keys.has(active)) return configurationError();
      return new CredentialVault(keys, active);
    } catch {
      return configurationError();
    }
  }

  private aad(identity: CredentialIdentity): Buffer {
    return Buffer.from(
      JSON.stringify(['zapmate-ai-credential-v1', identity.id, identity.userId, identity.provider])
    );
  }

  encrypt(secret: string, identity: CredentialIdentity): EncryptedCredential {
    if (
      !secret ||
      secret.length > 8192 ||
      /[\r\n]/.test(secret) ||
      secret.includes(String.fromCharCode(0))
    ) {
      throw new AiConnectionError(
        'INVALID_INPUT',
        'API key must be non-empty and contain no control line breaks'
      );
    }
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys.get(this.activeKeyId)!, nonce);
    cipher.setAAD(this.aad(identity));
    return {
      credentialCiphertext: Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]).toString(
        'base64'
      ),
      credentialNonce: nonce.toString('base64'),
      credentialTag: cipher.getAuthTag().toString('base64'),
      keyId: this.activeKeyId,
    };
  }

  decrypt(record: EncryptedCredential & CredentialIdentity): string {
    try {
      const key = this.keys.get(record.keyId);
      if (!key) return configurationError();
      const nonce = Buffer.from(record.credentialNonce, 'base64');
      const tag = Buffer.from(record.credentialTag, 'base64');
      if (nonce.length !== 12 || tag.length !== 16) throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', key, nonce);
      decipher.setAAD(this.aad(record));
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(Buffer.from(record.credentialCiphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new AiConnectionError(
        'CONFIGURATION',
        'AI connection credential could not be decrypted'
      );
    }
  }

  /** Persist with a compare-and-swap on updatedAt/keyId to avoid overwriting replacement keys. */
  rotate(record: EncryptedCredential & CredentialIdentity): EncryptedCredential {
    return this.encrypt(this.decrypt(record), record);
  }
}
